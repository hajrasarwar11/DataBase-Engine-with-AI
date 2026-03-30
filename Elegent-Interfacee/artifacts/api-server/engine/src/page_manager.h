#pragma once
#include "types.h"
#include <fstream>
#include <stdexcept>
#include <cstring>
#include <list>
#include <unordered_map>
#include <array>
#include <atomic>

// ── LRU Page Cache ────────────────────────────────────────────────────────────
// 64-frame write-through LRU cache per collection.
// Avoids repeated disk I/O for hot pages (e.g. last data page during bulk INSERTs).
class LRUPageCache {
    static const size_t CAPACITY = 64;

    struct Frame {
        uint32_t page_id{0};
        std::array<uint8_t, PAGE_SIZE> data{};
    };

    std::list<Frame>                                         lru_list_; // front = MRU
    std::unordered_map<uint32_t, std::list<Frame>::iterator> index_;

    std::atomic<uint64_t> hits_{0};
    std::atomic<uint64_t> misses_{0};

public:
    // Return pointer to cached page, or nullptr if not present
    const uint8_t* get(uint32_t pg) {
        auto it = index_.find(pg);
        if (it == index_.end()) { misses_++; return nullptr; }
        // Move to front (most recently used)
        lru_list_.splice(lru_list_.begin(), lru_list_, it->second);
        hits_++;
        return it->second->data.data();
    }

    // Insert/update a page in cache (write-through: caller already wrote to disk)
    void put(uint32_t pg, const uint8_t* data) {
        auto it = index_.find(pg);
        if (it != index_.end()) {
            lru_list_.splice(lru_list_.begin(), lru_list_, it->second);
            memcpy(it->second->data.data(), data, PAGE_SIZE);
            return;
        }
        // Evict LRU frame if at capacity
        if (lru_list_.size() >= CAPACITY) {
            auto& evicted = lru_list_.back();
            index_.erase(evicted.page_id);
            lru_list_.pop_back();
        }
        lru_list_.push_front({pg, {}});
        memcpy(lru_list_.front().data.data(), data, PAGE_SIZE);
        index_[pg] = lru_list_.begin();
    }

    void invalidate(uint32_t pg) {
        auto it = index_.find(pg);
        if (it != index_.end()) { lru_list_.erase(it->second); index_.erase(it); }
    }

    void clear() { lru_list_.clear(); index_.clear(); }

    uint64_t hits()   const { return hits_.load(); }
    uint64_t misses() const { return misses_.load(); }
    size_t   size()   const { return index_.size(); }
    double   hit_rate() const {
        auto h = hits_.load(), m = misses_.load();
        return (h + m == 0) ? 0.0 : (double)h / (h + m);
    }
};

// ── Page Manager ──────────────────────────────────────────────────────────────
class PageManager {
public:
    explicit PageManager(const std::string& filepath) : path_(filepath) {}

    // Read a page into buf (must be PAGE_SIZE bytes). Checks cache first.
    void read_page(uint32_t page_id, uint8_t* buf) {
        const uint8_t* cached = cache_.get(page_id);
        if (cached) {
            memcpy(buf, cached, PAGE_SIZE);
            return;
        }
        // Cache miss — read from disk
        // FIX 1: if file doesn't exist, return zeroed page instead of throwing.
        // This prevents rebuild_index from crashing on a missing .pages file.
        std::fstream f(path_, std::ios::in | std::ios::binary);
        if (!f) {
            memset(buf, 0, PAGE_SIZE);
            return;
        }
        f.seekg((uint64_t)page_id * PAGE_SIZE);
        if (!f.read(reinterpret_cast<char*>(buf), PAGE_SIZE)) {
            memset(buf, 0, PAGE_SIZE);
        }
        cache_.put(page_id, buf);
    }

    // Write a page from buf. Write-through: updates both disk and cache.
    void write_page(uint32_t page_id, const uint8_t* buf) {
        auto f = open_rw();
        f.seekp((uint64_t)page_id * PAGE_SIZE);
        f.write(reinterpret_cast<const char*>(buf), PAGE_SIZE);
        f.flush();
        cache_.put(page_id, buf);
    }

    // Allocate a new page at end of file, return its id
    uint32_t alloc_page() {
        auto f = open_rw();
        f.seekp(0, std::ios::end);
        auto pos = f.tellp();
        uint32_t page_id = (uint32_t)(pos / PAGE_SIZE);
        uint8_t empty[PAGE_SIZE] = {};
        f.write(reinterpret_cast<const char*>(empty), PAGE_SIZE);
        f.flush();
        return page_id;
    }

    uint32_t num_pages() {
        std::ifstream f(path_, std::ios::binary | std::ios::ate);
        if (!f) return 0;
        auto sz = f.tellg();
        if (sz <= 0) return 0;
        return (uint32_t)(sz / PAGE_SIZE);
    }

    bool exists() { std::ifstream f(path_); return f.good(); }

    // FIX 2: create() uses truncate flag so it always starts fresh —
    // but ONLY call this for brand-new collections, never when loading existing ones.
    void create() {
        std::ofstream f(path_, std::ios::binary | std::ios::trunc);
        if (!f) throw std::runtime_error("Cannot create page file: " + path_);
        // Write one zeroed page so the file is never empty (prevents num_pages() == 0 issues)
        uint8_t empty[PAGE_SIZE] = {};
        f.write(reinterpret_cast<const char*>(empty), PAGE_SIZE);
        f.flush();
    }

    void remove_file() { cache_.clear(); std::remove(path_.c_str()); }

    const std::string& path() const { return path_; }

    // Cache statistics for STATS command
    uint64_t cache_hits()    const { return cache_.hits(); }
    uint64_t cache_misses()  const { return cache_.misses(); }
    double   cache_hit_rate() const { return cache_.hit_rate(); }
    size_t   cache_size()    const { return cache_.size(); }

private:
    std::string   path_;
    LRUPageCache  cache_;

    // FIX 3: open_rw() — if file doesn't exist, do NOT silently create a blank
    // file (that would wipe data). Throw a clear error instead so the caller knows.
    std::fstream open_rw() {
        std::fstream f(path_, std::ios::in | std::ios::out | std::ios::binary);
        if (!f) {
            // File genuinely missing (e.g. first write after create()) — make it
            std::ofstream c(path_, std::ios::binary | std::ios::trunc);
            if (!c) throw std::runtime_error("Cannot create page file: " + path_);
            c.close();
            f.open(path_, std::ios::in | std::ios::out | std::ios::binary);
        }
        if (!f) throw std::runtime_error("Cannot open for rw: " + path_);
        return f;
    }
};

// ── Slot-based page operations ────────────────────────────────────────────────

inline PageHeader* page_header(uint8_t* buf) {
    return reinterpret_cast<PageHeader*>(buf);
}

inline void init_page(uint8_t* buf, uint32_t page_id, PageType pt = PageType::DATA) {
    memset(buf, 0, PAGE_SIZE);
    auto* h = page_header(buf);
    h->magic       = PAGE_MAGIC;
    h->page_id     = page_id;
    h->page_type   = pt;
    h->num_slots   = 0;
    h->free_offset = 0;
    h->next_page   = NO_PAGE;
}

// Returns slot index or -1 if no space
inline int page_insert(uint8_t* buf, const std::string& json_str) {
    auto* h = page_header(buf);
    uint8_t* data_area = buf + HEADER_SIZE;

    uint32_t rec_len      = (uint32_t)json_str.size() + 1;
    uint32_t slot_area_size = (h->num_slots + 1) * sizeof(SlotEntry);

    if (slot_area_size + h->free_offset + rec_len > DATA_AREA) return -1;

    uint32_t rec_offset = DATA_AREA - h->free_offset - rec_len;
    memcpy(data_area + rec_offset, json_str.c_str(), rec_len);
    h->free_offset += rec_len;

    auto* slots = reinterpret_cast<SlotEntry*>(data_area);
    uint32_t slot_idx       = h->num_slots;
    slots[slot_idx].offset  = rec_offset;
    slots[slot_idx].length  = rec_len;
    slots[slot_idx].deleted = 0;
    h->num_slots++;

    return (int)slot_idx;
}

// Read record at slot (returns empty string if deleted)
inline std::string page_read(const uint8_t* buf, uint32_t slot) {
    auto* h = reinterpret_cast<const PageHeader*>(buf);
    if (slot >= h->num_slots) return "";
    const uint8_t* data_area = buf + HEADER_SIZE;
    auto* slots = reinterpret_cast<const SlotEntry*>(data_area);
    if (slots[slot].deleted) return "";
    return std::string(reinterpret_cast<const char*>(data_area + slots[slot].offset));
}

// Mark slot as deleted
inline void page_delete(uint8_t* buf, uint32_t slot) {
    auto* h = page_header(buf);
    if (slot >= h->num_slots) return;
    uint8_t* data_area = buf + HEADER_SIZE;
    auto* slots = reinterpret_cast<SlotEntry*>(data_area);
    slots[slot].deleted = 1;
}

// Update slot with new json (in-place only if same or smaller size)
inline bool page_update(uint8_t* buf, uint32_t slot, const std::string& new_json) {
    auto* h = page_header(buf);
    if (slot >= h->num_slots) return false;
    uint8_t* data_area = buf + HEADER_SIZE;
    auto* slots = reinterpret_cast<SlotEntry*>(data_area);
    if (slots[slot].deleted) return false;

    uint32_t new_len = (uint32_t)new_json.size() + 1;
    if (new_len <= slots[slot].length) {
        memset(data_area + slots[slot].offset, 0, slots[slot].length);
        memcpy(data_area + slots[slot].offset, new_json.c_str(), new_len);
        return true;
    }
    return false;
}