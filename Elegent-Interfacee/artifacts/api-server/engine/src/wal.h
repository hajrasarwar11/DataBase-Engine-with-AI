#pragma once
#include "types.h"
#include <fstream>
#include <vector>
#include <set>
#include <cstring>
#include <mutex>
#include <functional>

// WAL binary format per entry:
//   [uint32 entry_len][uint64 lsn][uint32 txn_id][uint8 op]
//   [uint32 db_len][char* db][uint32 col_len][char* col]
//   [uint32 payload_len][char* payload_json]

class WAL {
public:
    explicit WAL(const std::string& path) : path_(path), lsn_(0) {}

    void open() {
        std::ifstream test(path_, std::ios::binary);
        if (test) {
            test.close();
            replay([this](const WalEntry& e){ if(e.lsn >= lsn_) lsn_ = e.lsn + 1; });
        }
        out_.open(path_, std::ios::binary | std::ios::app);
        if (!out_) {
            out_.open(path_, std::ios::binary | std::ios::out);
        }
    }

    uint64_t append(uint32_t txn_id, WalOp op,
                    const std::string& db, const std::string& col,
                    const json& payload) {
        std::lock_guard<std::mutex> lk(mu_);
        uint64_t l = lsn_++;
        std::string pstr = payload.is_null() ? "null" : payload.dump();

        write_u64(l);
        write_u32(txn_id);
        write_u8((uint8_t)op);
        write_str(db);
        write_str(col);
        write_str(pstr);
        out_.flush();
        return l;
    }

    // Replay all committed entries, calling cb for each
    void replay(std::function<void(const WalEntry&)> cb) {
        std::ifstream f(path_, std::ios::binary);
        if (!f) return;

        // Collect all entries, then filter committed txns
        std::vector<WalEntry> entries;
        std::set<uint32_t> committed, rolled_back;

        while (f.peek() != EOF) {
            WalEntry e;
            if (!read_entry(f, e)) break;
            entries.push_back(e);
            if (e.op == WalOp::COMMIT_OP)   committed.insert(e.txn_id);
            if (e.op == WalOp::ROLLBACK_OP) rolled_back.insert(e.txn_id);
        }

        for (auto& e : entries) {
            bool data_op = (e.op==WalOp::INSERT || e.op==WalOp::UPDATE ||
                           e.op==WalOp::DELETE_OP || e.op==WalOp::CREATE_DB ||
                           e.op==WalOp::DROP_DB || e.op==WalOp::CREATE_COL ||
                           e.op==WalOp::DROP_COL);
            if (data_op) {
                // Only replay if committed (or auto-commit, txn_id == 0)
                if (e.txn_id == 0 || committed.count(e.txn_id)) {
                    cb(e);
                }
            }
        }
    }

    // Checkpoint: truncate WAL (call after full page flush)
    void checkpoint() {
        std::lock_guard<std::mutex> lk(mu_);
        out_.close();
        // Overwrite with empty file
        std::ofstream f(path_, std::ios::binary | std::ios::trunc);
        f.close();
        out_.open(path_, std::ios::binary | std::ios::app);
    }

private:
    std::string   path_;
    std::ofstream out_;
    uint64_t      lsn_;
    std::mutex    mu_;

    void write_u8(uint8_t v)  { out_.write(reinterpret_cast<char*>(&v), 1); }
    void write_u32(uint32_t v){ out_.write(reinterpret_cast<char*>(&v), 4); }
    void write_u64(uint64_t v){ out_.write(reinterpret_cast<char*>(&v), 8); }
    void write_str(const std::string& s) {
        uint32_t len = (uint32_t)s.size();
        write_u32(len);
        out_.write(s.c_str(), len);
    }

    bool read_u8(std::ifstream& f, uint8_t& v)  { return (bool)f.read(reinterpret_cast<char*>(&v),1); }
    bool read_u32(std::ifstream& f, uint32_t& v){ return (bool)f.read(reinterpret_cast<char*>(&v),4); }
    bool read_u64(std::ifstream& f, uint64_t& v){ return (bool)f.read(reinterpret_cast<char*>(&v),8); }
    bool read_str(std::ifstream& f, std::string& s) {
        uint32_t len=0;
        if (!read_u32(f,len)) return false;
        if (len > 1024*1024) return false;
        s.resize(len);
        return (bool)f.read(&s[0], len);
    }

    bool read_entry(std::ifstream& f, WalEntry& e) {
        uint8_t op8=0;
        if (!read_u64(f,e.lsn))   return false;
        if (!read_u32(f,e.txn_id)) return false;
        if (!read_u8(f,op8))       return false;
        e.op = (WalOp)op8;
        std::string pstr;
        if (!read_str(f,e.db))     return false;
        if (!read_str(f,e.collection)) return false;
        if (!read_str(f,pstr))     return false;
        try { e.payload = json::parse(pstr); } catch(...) { e.payload = nullptr; }
        return true;
    }
};
