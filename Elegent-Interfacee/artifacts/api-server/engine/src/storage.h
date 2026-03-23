#pragma once
#include "types.h"
#include "page_manager.h"
#include "wal.h"
#include "btree.h"
#include "transaction.h"
#include <filesystem>
#include <fstream>
#include <unordered_map>
#include <vector>
#include <mutex>
#include <iostream>
#include <chrono>
#include <functional>
#include <algorithm>
#include <cmath>

namespace fs = std::filesystem;

// ── Secondary Index ───────────────────────────────────────────────────────────
// Maps arbitrary field values → set of record IDs.
// Persisted as JSON alongside page files.
struct SecondaryIndex {
    std::string field_name;
    std::string persist_path;

    // Key = JSON-serialized field value (handles string/number/bool uniformly)
    std::unordered_map<std::string, std::vector<int64_t>> map;

    void load() {
        std::ifstream f(persist_path);
        if (!f) return;
        try {
            json j = json::parse(f);
            map.clear();
            for (auto& [k, ids] : j.items())
                map[k] = ids.get<std::vector<int64_t>>();
        } catch (...) {}
    }

    void save() const {
        json j = json::object();
        for (auto& [k, ids] : map) j[k] = ids;
        std::ofstream f(persist_path);
        f << j.dump(2);
    }

    void add(const json& field_val, int64_t id) {
        std::string key = field_val.dump();
        auto& vec = map[key];
        if (std::find(vec.begin(), vec.end(), id) == vec.end())
            vec.push_back(id);
    }

    void remove_id(const json& field_val, int64_t id) {
        std::string key = field_val.dump();
        auto it = map.find(key);
        if (it == map.end()) return;
        auto& vec = it->second;
        vec.erase(std::remove(vec.begin(), vec.end(), id), vec.end());
        if (vec.empty()) map.erase(it);
    }

    // Exact-match lookup
    std::vector<int64_t> lookup(const json& field_val) const {
        auto it = map.find(field_val.dump());
        if (it == map.end()) return {};
        return it->second;
    }

    // Range lookup for $gt/$lt/$gte/$lte on numeric keys
    std::vector<int64_t> range_lookup(const json& op_obj) const {
        std::vector<int64_t> result;
        for (auto& [k, ids] : map) {
            try {
                json kv = json::parse(k);
                if (!kv.is_number()) continue;
                double knum = kv.get<double>();
                bool pass = true;
                if (op_obj.contains("$gt"))  pass = pass && knum >  op_obj["$gt"].get<double>();
                if (op_obj.contains("$lt"))  pass = pass && knum <  op_obj["$lt"].get<double>();
                if (op_obj.contains("$gte")) pass = pass && knum >= op_obj["$gte"].get<double>();
                if (op_obj.contains("$lte")) pass = pass && knum <= op_obj["$lte"].get<double>();
                if (op_obj.contains("$ne"))  pass = pass && knum != op_obj["$ne"].get<double>();
                if (pass) result.insert(result.end(), ids.begin(), ids.end());
            } catch (...) {}
        }
        return result;
    }
};

// ── Collection State ──────────────────────────────────────────────────────────
struct CollectionState {
    CollectionMeta              meta;
    std::unique_ptr<PageManager> pages;
    BPlusTree<int64_t,int64_t>  index; // primary: id → location
    std::unordered_map<std::string, SecondaryIndex> sec_indexes; // field → secondary index
};

// ── Storage Engine ────────────────────────────────────────────────────────────
class StorageEngine {
public:
    explicit StorageEngine(const std::string& data_dir)
        : data_dir_(data_dir), txn_mgr_() {}

    void open() {
        fs::create_directories(data_dir_);
        load_meta();
        for (auto& [dname, dbmeta] : databases_) {
            auto wal = make_wal(dname);
            wal->open();
            wal->replay([&](const WalEntry& e){ apply_wal_entry(e); });
            wals_[dname] = std::move(wal);
        }
    }

    // ── Database operations ─────────────────────────────────────────────────
    json create_db(const std::string& name, uint32_t txn_id = 0) {
        std::lock_guard<std::mutex> lk(mu_);
        if (databases_.count(name)) throw std::runtime_error("Database already exists: " + name);
        DatabaseMeta dm; dm.name = name;
        databases_[name] = dm;
        fs::create_directories(db_path(name));
        auto wal = make_wal(name);
        wal->open();
        wals_[name] = std::move(wal);
        log(name, "", WalOp::CREATE_DB, {{"name", name}}, txn_id);
        save_meta();
        return {{"ok", true}, {"name", name}};
    }

    json drop_db(const std::string& name, uint32_t txn_id = 0) {
        std::lock_guard<std::mutex> lk(mu_);
        if (!databases_.count(name)) throw std::runtime_error("Database not found: " + name);
        log(name, "", WalOp::DROP_DB, {{"name", name}}, txn_id);
        databases_.erase(name);
        collections_.erase(name);
        wals_.erase(name);
        fs::remove_all(db_path(name));
        save_meta();
        return {{"ok", true}};
    }

    json list_dbs() {
        std::lock_guard<std::mutex> lk(mu_);
        json arr = json::array();
        for (auto& [name, _] : databases_) arr.push_back(name);
        return {{"databases", arr}};
    }

    // ── Collection operations ────────────────────────────────────────────────
    json create_collection(const std::string& db, const std::string& col,
                           const std::string& type_str, const json& schema_json,
                           uint32_t txn_id = 0) {
        std::lock_guard<std::mutex> lk(mu_);
        auto& dbmeta = get_db(db);
        if (dbmeta.collections.count(col)) throw std::runtime_error("Collection exists: " + col);

        CollectionMeta cm;
        cm.name = col;
        cm.type = parse_col_type(type_str);
        if (!schema_json.is_null() && schema_json.is_array()) {
            for (auto& f : schema_json) {
                FieldDef fd;
                fd.name     = f.value("name", "");
                fd.type     = f.value("type", "any");
                fd.required = f.value("required", false);
                if (!fd.name.empty()) cm.schema.push_back(fd);
            }
        }
        cm.next_id = 1;
        dbmeta.collections[col] = cm;

        auto pm = make_pm(db, col);
        pm->create();
        uint8_t buf[PAGE_SIZE];
        init_page(buf, 0, PageType::HEADER);
        pm->write_page(0, buf);
        collections_[db][col] = {cm, std::move(pm), {}};

        json payload = {{"name",col},{"type",type_str}};
        log(db, col, WalOp::CREATE_COL, payload, txn_id);
        save_meta();
        return {{"ok", true}, {"name", col}, {"type", type_str}};
    }

    json drop_collection(const std::string& db, const std::string& col, uint32_t txn_id = 0) {
        std::lock_guard<std::mutex> lk(mu_);
        auto& dbmeta = get_db(db);
        if (!dbmeta.collections.count(col)) throw std::runtime_error("Collection not found: " + col);
        log(db, col, WalOp::DROP_COL, {{"name",col}}, txn_id);
        dbmeta.collections.erase(col);
        if (collections_.count(db)) {
            // Remove secondary index files
            if (collections_[db].count(col)) {
                for (auto& [field, sidx] : collections_[db][col].sec_indexes)
                    fs::remove(sidx.persist_path);
            }
            auto pm = make_pm(db, col);
            pm->remove_file();
            collections_[db].erase(col);
        }
        save_meta();
        return {{"ok", true}};
    }

    json list_collections(const std::string& db) {
        std::lock_guard<std::mutex> lk(mu_);
        auto& dbmeta = get_db(db);
        json arr = json::array();
        for (auto& [col, meta] : dbmeta.collections) {
            std::string tstr = col_type_str(meta.type);
            json schema_arr = json::array();
            for (auto& f : meta.schema)
                schema_arr.push_back({{"name",f.name},{"type",f.type},{"required",f.required}});
            // List secondary indexes for this collection
            json idx_arr = json::array();
            if (collections_.count(db) && collections_[db].count(col))
                for (auto& [field, _] : collections_[db][col].sec_indexes)
                    idx_arr.push_back(field);
            else {
                // Load from disk if not in memory
                for (auto& entry : fs::directory_iterator(db_path(db))) {
                    auto stem = entry.path().stem().string();
                    auto ext  = entry.path().extension().string();
                    if (ext == ".sidx" && stem.rfind(col + ".", 0) == 0)
                        idx_arr.push_back(stem.substr(col.size() + 1));
                }
            }
            arr.push_back({{"name",col},{"type",tstr},
                           {"count",(int64_t)col_state(db,col).index.size()},
                           {"schema",schema_arr},
                           {"indexes",idx_arr}});
        }
        return {{"collections", arr}};
    }

    // ── Secondary Index operations ────────────────────────────────────────────
    json create_index(const std::string& db, const std::string& col, const std::string& field,
                      uint32_t /*txn_id*/ = 0) {
        std::lock_guard<std::mutex> lk(mu_);
        auto& cs = col_state(db, col);
        if (cs.sec_indexes.count(field))
            throw std::runtime_error("Index already exists on field: " + field);

        SecondaryIndex sidx;
        sidx.field_name   = field;
        sidx.persist_path = sidx_path(db, col, field);

        // Build index by scanning all existing records
        cs.index.scan([&](int64_t id, int64_t loc){
            uint32_t pg, sl; unpack_loc(loc, pg, sl);
            std::string s = read_record(*cs.pages, pg, sl);
            if (s.empty()) return;
            try {
                json rec = json::parse(s);
                if (rec.contains(field)) sidx.add(rec[field], id);
            } catch (...) {}
        });

        sidx.save();
        cs.sec_indexes[field] = std::move(sidx);
        return {{"ok", true}, {"field", field}, {"entries", (int64_t)cs.sec_indexes[field].map.size()}};
    }

    json drop_index(const std::string& db, const std::string& col, const std::string& field,
                    uint32_t /*txn_id*/ = 0) {
        std::lock_guard<std::mutex> lk(mu_);
        auto& cs = col_state(db, col);
        auto it = cs.sec_indexes.find(field);
        if (it == cs.sec_indexes.end())
            throw std::runtime_error("No index on field: " + field);
        fs::remove(it->second.persist_path);
        cs.sec_indexes.erase(it);
        return {{"ok", true}};
    }

    json list_indexes(const std::string& db, const std::string& col) {
        std::lock_guard<std::mutex> lk(mu_);
        auto& cs = col_state(db, col);
        json arr = json::array();
        for (auto& [field, sidx] : cs.sec_indexes) {
            int64_t total = 0;
            for (auto& [k, ids] : sidx.map) total += (int64_t)ids.size();
            arr.push_back({{"field", field}, {"unique_values", (int64_t)sidx.map.size()}, {"total_entries", total}});
        }
        return {{"ok", true}, {"indexes", arr}};
    }

    // ── Record operations ─────────────────────────────────────────────────────
    json insert(const std::string& db, const std::string& col,
                json record, uint32_t txn_id = 0) {
        std::lock_guard<std::mutex> lk(mu_);
        auto& cs = col_state(db, col);

        if (cs.meta.type == ColType::TABLE && !cs.meta.schema.empty())
            validate_schema(cs.meta.schema, record);

        int64_t id = cs.meta.next_id++;
        record["id"] = id;
        record["_created"] = (int64_t)now_ms();

        std::string rstr = record.dump();
        auto [page_id, slot] = find_space_unlocked(db, col, rstr);
        cs.index.insert(id, pack_loc(page_id, slot));

        // Update secondary indexes
        for (auto& [field, sidx] : cs.sec_indexes)
            if (record.contains(field)) sidx.add(record[field], id);
        flush_sec_indexes(cs);

        // Track undo entry so ROLLBACK can delete this inserted record
        if (txn_id) txn_mgr_.add_undo(txn_id, {WalOp::INSERT, db, col, record, (uint32_t)id});
        log(db, col, WalOp::INSERT, record, txn_id);
        save_col_meta(db, col);
        return {{"ok",true},{"id",id}};
    }

    // Extended FIND with ORDER BY and GROUP BY / Aggregate support
    json find(const std::string& db, const std::string& col,
              const json& where, int limit = 1000,
              const std::string& order_by = "", bool order_asc = true,
              const std::string& group_by = "",
              const std::string& agg_func = "", const std::string& agg_field = "") {
        std::lock_guard<std::mutex> lk(mu_);
        auto& cs = col_state(db, col);
        json rows = json::array();

        // ── Query planner ───────────────────────────────────────────────────
        std::string plan_strategy = "FULL_SCAN";

        // Strategy 1: exact primary-key lookup
        if (!where.is_null() && where.contains("id") && where["id"].is_number()) {
            plan_strategy = "PRIMARY_INDEX_LOOKUP";
            int64_t id = where["id"].get<int64_t>();
            auto loc = cs.index.search(id);
            if (loc) {
                uint32_t pg, sl; unpack_loc(*loc, pg, sl);
                std::string rec_str = read_record(*cs.pages, pg, sl);
                if (!rec_str.empty()) {
                    try {
                        json rec = json::parse(rec_str);
                        if (matches(rec, where)) rows.push_back(rec);
                    } catch (...) {}
                }
            }
        }
        // Strategy 2: secondary index lookup for exact-match on indexed field
        else if (!where.is_null()) {
            bool used_secondary = false;
            for (auto& [k, v] : where.items()) {
                auto sit = cs.sec_indexes.find(k);
                if (sit == cs.sec_indexes.end()) continue;
                if (v.is_object()) {
                    // Range query on secondary index
                    plan_strategy = "SECONDARY_INDEX_RANGE_SCAN";
                    auto ids = sit->second.range_lookup(v);
                    for (int64_t id : ids) {
                        auto loc = cs.index.search(id);
                        if (!loc) continue;
                        uint32_t pg, sl; unpack_loc(*loc, pg, sl);
                        std::string s = read_record(*cs.pages, pg, sl);
                        if (s.empty()) continue;
                        try {
                            json rec = json::parse(s);
                            if (matches(rec, where)) { rows.push_back(rec); }
                        } catch (...) {}
                    }
                    used_secondary = true;
                    break;
                } else {
                    // Exact match on secondary index
                    plan_strategy = "SECONDARY_INDEX_LOOKUP";
                    auto ids = sit->second.lookup(v);
                    for (int64_t id : ids) {
                        auto loc = cs.index.search(id);
                        if (!loc) continue;
                        uint32_t pg, sl; unpack_loc(*loc, pg, sl);
                        std::string s = read_record(*cs.pages, pg, sl);
                        if (s.empty()) continue;
                        try {
                            json rec = json::parse(s);
                            if (matches(rec, where)) rows.push_back(rec);
                        } catch (...) {}
                    }
                    used_secondary = true;
                    break;
                }
            }
            if (!used_secondary) {
                // Full scan
                int count = 0;
                cs.index.scan([&](int64_t, int64_t loc){
                    if (count >= limit) return;
                    uint32_t pg, sl; unpack_loc(loc, pg, sl);
                    std::string s = read_record(*cs.pages, pg, sl);
                    if (s.empty()) return;
                    try {
                        json rec = json::parse(s);
                        if (where.is_null() || matches(rec, where)) { rows.push_back(rec); count++; }
                    } catch (...) {}
                });
            }
        } else {
            // No where — full scan
            int count = 0;
            cs.index.scan([&](int64_t, int64_t loc){
                if (count >= limit) return;
                uint32_t pg, sl; unpack_loc(loc, pg, sl);
                std::string s = read_record(*cs.pages, pg, sl);
                if (s.empty()) return;
                try {
                    json rec = json::parse(s);
                    rows.push_back(rec); count++;
                } catch (...) {}
            });
        }

        // ── ORDER BY ────────────────────────────────────────────────────────
        if (!order_by.empty() && rows.size() > 1) {
            std::stable_sort(rows.begin(), rows.end(), [&](const json& a, const json& b) {
                if (!a.contains(order_by) || !b.contains(order_by)) return false;
                auto& av = a[order_by]; auto& bv = b[order_by];
                if (av.is_number() && bv.is_number()) {
                    double ad = av.get<double>(), bd = bv.get<double>();
                    return order_asc ? ad < bd : ad > bd;
                }
                std::string as = av.is_string() ? av.get<std::string>() : av.dump();
                std::string bs = bv.is_string() ? bv.get<std::string>() : bv.dump();
                return order_asc ? as < bs : as > bs;
            });
        }

        // Apply limit after sort
        if ((int)rows.size() > limit)
            rows.erase(rows.begin() + limit, rows.end());

        // ── GROUP BY + Aggregate ─────────────────────────────────────────────
        if (!group_by.empty() && !agg_func.empty()) {
            // Group rows
            std::unordered_map<std::string, std::vector<json>> groups;
            std::vector<std::string> group_order;
            for (auto& row : rows) {
                std::string gk = row.contains(group_by) ? row[group_by].dump() : "null";
                if (!groups.count(gk)) group_order.push_back(gk);
                groups[gk].push_back(row);
            }

            json agg_rows = json::array();
            for (auto& gk : group_order) {
                auto& grp = groups[gk];
                json result_row;
                result_row[group_by] = grp[0].contains(group_by) ? grp[0][group_by] : nullptr;

                std::string func = agg_func;
                for (auto& c : func) c = (char)toupper(c);

                if (func == "COUNT") {
                    result_row["COUNT(*)"] = (int64_t)grp.size();
                } else {
                    double accum = 0; bool first = true; int cnt = 0;
                    double mn = 0, mx = 0;
                    for (auto& row : grp) {
                        if (!row.contains(agg_field) || !row[agg_field].is_number()) continue;
                        double v = row[agg_field].get<double>();
                        if (first) { mn = mx = v; first = false; }
                        accum += v; cnt++;
                        mn = std::min(mn, v); mx = std::max(mx, v);
                    }
                    if (func == "SUM") result_row["SUM(" + agg_field + ")"] = accum;
                    else if (func == "AVG") result_row["AVG(" + agg_field + ")"] = cnt > 0 ? accum/cnt : 0.0;
                    else if (func == "MIN") result_row["MIN(" + agg_field + ")"] = mn;
                    else if (func == "MAX") result_row["MAX(" + agg_field + ")"] = mx;
                    result_row["_count"] = cnt;
                }
                agg_rows.push_back(result_row);
            }
            return {{"rows",agg_rows},{"count",(int)agg_rows.size()},
                    {"plan",plan_strategy},{"grouped",true}};
        }

        return {{"rows",rows},{"count",(int)rows.size()},{"plan",plan_strategy}};
    }

    json modify(const std::string& db, const std::string& col,
                const json& where, const json& set_vals, uint32_t txn_id = 0) {
        std::lock_guard<std::mutex> lk(mu_);
        auto& cs = col_state(db, col);
        int updated = 0;

        cs.index.scan([&](int64_t id, int64_t loc){
            uint32_t pg, sl;
            unpack_loc(loc, pg, sl);
            std::string rec_str = read_record(*cs.pages, pg, sl);
            if (rec_str.empty()) return;
            try {
                json rec = json::parse(rec_str);
                if (!where.is_null() && !matches(rec, where)) return;

                if (txn_id) txn_mgr_.add_undo(txn_id, {WalOp::UPDATE, db, col, rec, (uint32_t)id});

                // Update secondary indexes: remove old values
                for (auto& [field, sidx] : cs.sec_indexes)
                    if (rec.contains(field)) sidx.remove_id(rec[field], id);

                for (auto& [k,v] : set_vals.items()) rec[k] = v;
                rec["_updated"] = (int64_t)now_ms();

                // Add new values to secondary indexes
                for (auto& [field, sidx] : cs.sec_indexes)
                    if (rec.contains(field)) sidx.add(rec[field], id);

                std::string new_str = rec.dump();
                uint8_t buf[PAGE_SIZE];
                cs.pages->read_page(pg, buf);
                if (!page_update(buf, sl, new_str)) {
                    page_delete(buf, sl);
                    cs.pages->write_page(pg, buf);
                    auto [npg, nsl] = find_space_unlocked(db, col, new_str);
                    cs.index.insert(id, pack_loc(npg, nsl));
                } else {
                    cs.pages->write_page(pg, buf);
                }
                log(db, col, WalOp::UPDATE, rec, txn_id);
                updated++;
            } catch (...) {}
        });
        flush_sec_indexes(cs);
        return {{"ok",true},{"updated",updated}};
    }

    json remove(const std::string& db, const std::string& col,
                const json& where, uint32_t txn_id = 0) {
        std::lock_guard<std::mutex> lk(mu_);
        auto& cs = col_state(db, col);
        int deleted = 0;

        std::vector<std::pair<int64_t,json>> to_delete;
        cs.index.scan([&](int64_t id, int64_t loc){
            uint32_t pg, sl;
            unpack_loc(loc, pg, sl);
            std::string rec_str = read_record(*cs.pages, pg, sl);
            if (rec_str.empty()) return;
            try {
                json rec = json::parse(rec_str);
                if (!where.is_null() && !matches(rec, where)) return;
                to_delete.push_back({id, rec});
                if (txn_id) txn_mgr_.add_undo(txn_id, {WalOp::DELETE, db, col, rec, (uint32_t)id});
            } catch (...) {}
        });

        for (auto& [id, rec] : to_delete) {
            // Update secondary indexes
            for (auto& [field, sidx] : cs.sec_indexes)
                if (rec.contains(field)) sidx.remove_id(rec[field], id);

            auto loc = cs.index.search(id);
            if (!loc) continue;
            uint32_t pg, sl;
            unpack_loc(*loc, pg, sl);
            uint8_t buf[PAGE_SIZE];
            cs.pages->read_page(pg, buf);
            page_delete(buf, sl);
            cs.pages->write_page(pg, buf);
            cs.index.remove(id);
            log(db, col, WalOp::DELETE, {{"id",id}}, txn_id);
            deleted++;
        }
        flush_sec_indexes(cs);
        return {{"ok",true},{"deleted",deleted}};
    }

    // ── Graph traversal (BFS) ─────────────────────────────────────────────────
    json find_path(const std::string& db, const std::string& col,
                   int64_t from_id, int64_t to_id) {
        std::lock_guard<std::mutex> lk(mu_);
        auto& cs = col_state(db, col);

        std::unordered_map<int64_t, std::vector<int64_t>> adj;
        std::unordered_map<int64_t, json> nodes;

        cs.index.scan([&](int64_t id, int64_t loc){
            uint32_t pg, sl;
            unpack_loc(loc, pg, sl);
            std::string s = read_record(*cs.pages, pg, sl);
            if (s.empty()) return;
            try {
                json r = json::parse(s);
                nodes[id] = r;
                if (r.contains("from") && r.contains("to")) {
                    int64_t f = r["from"].get<int64_t>();
                    int64_t t = r["to"].get<int64_t>();
                    adj[f].push_back(t);
                    adj[t].push_back(f);
                } else {
                    adj[id];
                }
            } catch (...) {}
        });

        // BFS
        std::unordered_map<int64_t, int64_t> parent;
        std::vector<int64_t> queue = {from_id};
        parent[from_id] = -1;
        bool found = false;

        while (!queue.empty() && !found) {
            std::vector<int64_t> next;
            for (int64_t cur : queue) {
                if (cur == to_id) { found = true; break; }
                for (int64_t nb : adj[cur]) {
                    if (!parent.count(nb)) {
                        parent[nb] = cur;
                        next.push_back(nb);
                    }
                }
            }
            queue = next;
        }

        if (!found) {
            // Return all nodes + edges for visualization even if no path
            json all_nodes = json::array();
            json all_edges = json::array();
            for (auto& [id, r] : nodes) {
                if (r.contains("from") && r.contains("to"))
                    all_edges.push_back(r);
                else
                    all_nodes.push_back(r);
            }
            return {{"ok",false},{"path",json::array()},{"message","No path found"},
                    {"nodes",all_nodes},{"edges",all_edges}};
        }

        json path = json::array();
        int64_t cur = to_id;
        while (cur != -1) {
            if (nodes.count(cur)) path.insert(path.begin(), nodes[cur]);
            cur = parent.count(cur) ? parent[cur] : -1;
        }

        // Also return full graph for visualization
        json all_nodes = json::array();
        json all_edges = json::array();
        for (auto& [id, r] : nodes) {
            if (r.contains("from") && r.contains("to")) all_edges.push_back(r);
            else all_nodes.push_back(r);
        }

        return {{"ok",true},{"path",path},{"length",(int)path.size()},
                {"nodes",all_nodes},{"edges",all_edges}};
    }

    // ── Statistics ────────────────────────────────────────────────────────────
    json stats() {
        std::lock_guard<std::mutex> lk(mu_);
        json dbs = json::array();
        uint64_t total_records = 0;
        for (auto& [dname, dm] : databases_) {
            json cols = json::array();
            for (auto& [cname, cm] : dm.collections) {
                auto& cs = col_state_unlocked(dname, cname);
                int64_t rc = (int64_t)cs.index.size();
                total_records += rc;
                // Cache stats
                uint64_t ch = cs.pages->cache_hits();
                uint64_t cm2 = cs.pages->cache_misses();
                double hr = cs.pages->cache_hit_rate();
                json idx_list = json::array();
                for (auto& [f, _] : cs.sec_indexes) idx_list.push_back(f);
                cols.push_back({
                    {"name",cname},
                    {"type",col_type_str(cm.type)},
                    {"record_count",rc},
                    {"page_count",(int64_t)cs.pages->num_pages()},
                    {"next_id",(int64_t)cm.next_id},
                    {"cache_hits",(int64_t)ch},
                    {"cache_misses",(int64_t)cm2},
                    {"cache_hit_rate", std::round(hr*1000)/10.0},
                    {"secondary_indexes", idx_list}
                });
            }
            dbs.push_back({{"name",dname},{"collections",cols}});
        }
        return {{"ok",true},{"databases",dbs},{"total_records",(int64_t)total_records}};
    }

    // ── Transactions ─────────────────────────────────────────────────────────
    json begin_txn() {
        uint32_t id = txn_mgr_.begin();
        log("", "", WalOp::BEGIN, {{"txn",id}}, id);
        return {{"ok",true},{"txn_id",id}};
    }

    json commit_txn(uint32_t txn_id) {
        txn_mgr_.commit(txn_id);
        log("", "", WalOp::COMMIT, {{"txn",txn_id}}, txn_id);
        return {{"ok",true}};
    }

    json rollback_txn(uint32_t txn_id) {
        auto undo = txn_mgr_.rollback(txn_id);
        log("", "", WalOp::ROLLBACK, {{"txn",txn_id}}, txn_id);
        for (auto& u : undo) {
            try {
                if (u.original_op == WalOp::INSERT) {
                    json w = {{"id", u.record_id}};
                    remove(u.db, u.collection, w, 0);
                } else if (u.original_op == WalOp::UPDATE || u.original_op == WalOp::DELETE) {
                    insert(u.db, u.collection, u.before, 0);
                }
            } catch (...) {}
        }
        return {{"ok",true}};
    }

    TransactionManager& txn_manager() { return txn_mgr_; }

private:
    std::string data_dir_;
    std::unordered_map<std::string, DatabaseMeta>   databases_;
    std::unordered_map<std::string, std::unordered_map<std::string, CollectionState>> collections_;
    std::unordered_map<std::string, std::unique_ptr<WAL>> wals_;
    TransactionManager txn_mgr_;
    std::mutex mu_;

    std::string db_path(const std::string& db)   { return data_dir_ + "/db/" + db; }
    std::string col_file(const std::string& db, const std::string& col) {
        return db_path(db) + "/" + col + ".pages";
    }
    std::string sidx_path(const std::string& db, const std::string& col, const std::string& field) {
        return db_path(db) + "/" + col + "." + field + ".sidx";
    }
    std::string wal_path(const std::string& db)  { return db_path(db) + "/wal.log"; }
    std::string meta_path()                       { return data_dir_ + "/meta.json"; }

    std::string col_type_str(ColType t) {
        if (t == ColType::TABLE) return "table";
        if (t == ColType::GRAPH) return "graph";
        return "document";
    }

    DatabaseMeta& get_db(const std::string& name) {
        auto it = databases_.find(name);
        if (it == databases_.end()) throw std::runtime_error("Database not found: " + name);
        return it->second;
    }

    // col_state: loads if not in memory (thread-safe — caller holds mu_)
    CollectionState& col_state(const std::string& db, const std::string& col) {
        if (!collections_.count(db) || !collections_[db].count(col)) {
            auto& dbmeta = get_db(db);
            auto cit = dbmeta.collections.find(col);
            if (cit == dbmeta.collections.end()) throw std::runtime_error("Collection not found: " + col);
            auto pm = make_pm(db, col);
            CollectionState cs;
            cs.meta  = cit->second;
            cs.pages = std::move(pm);
            rebuild_index(cs);
            load_sec_indexes(db, col, cs);
            collections_[db][col] = std::move(cs);
        }
        return collections_[db][col];
    }

    CollectionState& col_state_unlocked(const std::string& db, const std::string& col) {
        return col_state(db, col);
    }

    void load_sec_indexes(const std::string& db, const std::string& col, CollectionState& cs) {
        // Discover *.sidx files for this collection
        try {
            for (auto& entry : fs::directory_iterator(db_path(db))) {
                if (entry.path().extension() != ".sidx") continue;
                std::string stem = entry.path().stem().string();
                std::string prefix = col + ".";
                if (stem.rfind(prefix, 0) != 0) continue;
                std::string field = stem.substr(prefix.size());
                SecondaryIndex sidx;
                sidx.field_name   = field;
                sidx.persist_path = entry.path().string();
                sidx.load();
                cs.sec_indexes[field] = std::move(sidx);
            }
        } catch (...) {}
    }

    void flush_sec_indexes(CollectionState& cs) {
        for (auto& [field, sidx] : cs.sec_indexes) sidx.save();
    }

    void rebuild_index(CollectionState& cs) {
        uint32_t npages = cs.pages->num_pages();
        for (uint32_t pg = 0; pg < npages; pg++) {
            uint8_t buf[PAGE_SIZE];
            cs.pages->read_page(pg, buf);
            auto* h = page_header(buf);
            if (h->magic != PAGE_MAGIC) continue;
            for (uint32_t sl = 0; sl < h->num_slots; sl++) {
                std::string s = page_read(buf, sl);
                if (s.empty()) continue;
                try {
                    json rec = json::parse(s);
                    if (rec.contains("id") && rec["id"].is_number()) {
                        int64_t id = rec["id"].get<int64_t>();
                        cs.index.insert(id, pack_loc(pg, sl));
                        if (id >= cs.meta.next_id) cs.meta.next_id = (uint32_t)(id + 1);
                    }
                } catch (...) {}
            }
        }
    }

    std::pair<uint32_t,uint32_t> find_space_unlocked(const std::string& db, const std::string& col,
                                                      const std::string& rstr) {
        auto& cs = collections_[db][col];
        uint32_t npages = cs.pages->num_pages();

        for (uint32_t pg = (npages > 1 ? npages-1 : 1); pg < npages; pg++) {
            uint8_t buf[PAGE_SIZE];
            cs.pages->read_page(pg, buf);
            int slot = page_insert(buf, rstr);
            if (slot >= 0) {
                cs.pages->write_page(pg, buf);
                return {pg, (uint32_t)slot};
            }
        }

        uint32_t new_pg = cs.pages->alloc_page();
        uint8_t buf[PAGE_SIZE];
        init_page(buf, new_pg, PageType::DATA);
        int slot = page_insert(buf, rstr);
        cs.pages->write_page(new_pg, buf);
        return {new_pg, (uint32_t)slot};
    }

    std::string read_record(PageManager& pm, uint32_t pg, uint32_t sl) {
        uint8_t buf[PAGE_SIZE];
        pm.read_page(pg, buf);
        return page_read(buf, sl);
    }

    bool matches(const json& rec, const json& where) {
        if (where.is_null()) return true;
        for (auto& [k,v] : where.items()) {
            if (!rec.contains(k)) return false;
            if (v.is_object()) {
                for (auto& [op, operand] : v.items()) {
                    auto& rv = rec[k];
                    if      (op=="$gt"  && !(rv > operand))  return false;
                    else if (op=="$lt"  && !(rv < operand))  return false;
                    else if (op=="$gte" && !(rv >= operand)) return false;
                    else if (op=="$lte" && !(rv <= operand)) return false;
                    else if (op=="$ne"  && rv == operand)    return false;
                }
            } else {
                if (rec[k] != v) return false;
            }
        }
        return true;
    }

    void validate_schema(const std::vector<FieldDef>& schema, const json& rec) {
        for (auto& f : schema) {
            if (f.required && !rec.contains(f.name))
                throw std::runtime_error("Missing required field: " + f.name);
            if (rec.contains(f.name)) {
                auto& v = rec[f.name];
                if (f.type == "string"  && !v.is_string())  throw std::runtime_error("Field " + f.name + " must be string");
                if (f.type == "number"  && !v.is_number())  throw std::runtime_error("Field " + f.name + " must be number");
                if (f.type == "boolean" && !v.is_boolean()) throw std::runtime_error("Field " + f.name + " must be boolean");
            }
        }
    }

    void log(const std::string& db, const std::string& col, WalOp op,
             const json& payload, uint32_t txn_id) {
        if (db.empty()) return;
        auto it = wals_.find(db);
        if (it != wals_.end()) it->second->append(txn_id, op, db, col, payload);
    }

    std::unique_ptr<WAL> make_wal(const std::string& db) {
        return std::make_unique<WAL>(wal_path(db));
    }

    std::unique_ptr<PageManager> make_pm(const std::string& db, const std::string& col) {
        return std::make_unique<PageManager>(col_file(db, col));
    }

    ColType parse_col_type(const std::string& s) {
        if (s == "table") return ColType::TABLE;
        if (s == "graph") return ColType::GRAPH;
        return ColType::DOCUMENT;
    }

    void save_col_meta(const std::string& db, const std::string& col) {
        if (!collections_.count(db) || !collections_[db].count(col)) return;
        databases_[db].collections[col] = collections_[db][col].meta;
        save_meta();
    }

    void save_meta() {
        json root = json::object();
        for (auto& [dname, dm] : databases_) {
            json cols = json::object();
            for (auto& [cname, cm] : dm.collections) {
                std::string tstr = col_type_str(cm.type);
                json schema_arr = json::array();
                for (auto& f : cm.schema)
                    schema_arr.push_back({{"name",f.name},{"type",f.type},{"required",f.required}});
                cols[cname] = {{"type",tstr},{"next_id",(int64_t)cm.next_id},{"schema",schema_arr}};
            }
            root[dname] = cols;
        }
        std::ofstream f(meta_path());
        f << root.dump(2);
    }

    void load_meta() {
        std::ifstream f(meta_path());
        if (!f) return;
        try {
            json root = json::parse(f);
            for (auto& [dname, cols] : root.items()) {
                DatabaseMeta dm; dm.name = dname;
                for (auto& [cname, cdata] : cols.items()) {
                    CollectionMeta cm;
                    cm.name    = cname;
                    cm.type    = parse_col_type(cdata.value("type","document"));
                    cm.next_id = cdata.value("next_id", 1);
                    if (cdata.contains("schema") && cdata["schema"].is_array()) {
                        for (auto& fj : cdata["schema"]) {
                            FieldDef fd;
                            fd.name     = fj.value("name","");
                            fd.type     = fj.value("type","any");
                            fd.required = fj.value("required",false);
                            if (!fd.name.empty()) cm.schema.push_back(fd);
                        }
                    }
                    dm.collections[cname] = cm;
                }
                databases_[dname] = dm;
                fs::create_directories(db_path(dname));
            }
        } catch (std::exception& e) {
            std::cerr << "Meta load error: " << e.what() << "\n";
        }
    }

    void apply_wal_entry(const WalEntry& e) {
        if (e.op == WalOp::INSERT && !e.db.empty() && !e.collection.empty()) {
            try {
                auto& dbmeta = databases_[e.db];
                if (!dbmeta.collections.count(e.collection)) return;
                if (!collections_.count(e.db) || !collections_[e.db].count(e.collection)) {
                    auto pm = make_pm(e.db, e.collection);
                    CollectionState cs;
                    cs.meta  = dbmeta.collections[e.collection];
                    cs.pages = std::move(pm);
                    collections_[e.db][e.collection] = std::move(cs);
                }
            } catch (...) {}
        }
    }

    static int64_t pack_loc(uint32_t pg, uint32_t sl) {
        return ((int64_t)pg << 32) | sl;
    }

    static void unpack_loc(int64_t loc, uint32_t& pg, uint32_t& sl) {
        pg = (uint32_t)(loc >> 32);
        sl = (uint32_t)(loc & 0xFFFFFFFF);
    }

    static uint64_t now_ms() {
        using namespace std::chrono;
        return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
    }
};
