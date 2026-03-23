#pragma once
#include "types.h"
#include <unordered_map>
#include <vector>
#include <mutex>
#include <atomic>
#include <chrono>
#include <stdexcept>

enum class TxnState { ACTIVE, COMMITTED, ROLLED_BACK };

struct TxnUndoEntry {
    WalOp         original_op;
    std::string   db;
    std::string   collection;
    json          before; // data before the operation (for undo)
    uint32_t      record_id;
};

struct Transaction {
    uint32_t              id;
    TxnState              state{TxnState::ACTIVE};
    std::vector<TxnUndoEntry> undo_log;
    uint64_t              started_at;
};

class TransactionManager {
public:
    TransactionManager() : next_id_(1) {}

    uint32_t begin() {
        std::lock_guard<std::mutex> lk(mu_);
        uint32_t id = next_id_++;
        auto& t = txns_[id];
        t.id = id;
        t.state = TxnState::ACTIVE;
        t.started_at = now_ms();
        return id;
    }

    void commit(uint32_t txn_id) {
        std::lock_guard<std::mutex> lk(mu_);
        auto& t = get_active(txn_id);
        t.state = TxnState::COMMITTED;
    }

    // Returns undo log entries to reverse, then marks rolled back
    std::vector<TxnUndoEntry> rollback(uint32_t txn_id) {
        std::lock_guard<std::mutex> lk(mu_);
        auto& t = get_active(txn_id);
        auto undo = t.undo_log;
        std::reverse(undo.begin(), undo.end()); // reverse order
        t.state = TxnState::ROLLED_BACK;
        return undo;
    }

    void add_undo(uint32_t txn_id, TxnUndoEntry entry) {
        if (txn_id == 0) return; // auto-commit, no undo needed
        std::lock_guard<std::mutex> lk(mu_);
        auto it = txns_.find(txn_id);
        if (it == txns_.end()) return;
        if (it->second.state != TxnState::ACTIVE) return;
        it->second.undo_log.push_back(std::move(entry));
    }

    bool is_active(uint32_t txn_id) {
        if (txn_id == 0) return true; // auto-commit always "active"
        std::lock_guard<std::mutex> lk(mu_);
        auto it = txns_.find(txn_id);
        return it != txns_.end() && it->second.state == TxnState::ACTIVE;
    }

    void cleanup() {
        // Remove old committed/rolled-back txns
        std::lock_guard<std::mutex> lk(mu_);
        for (auto it = txns_.begin(); it != txns_.end();) {
            if (it->second.state != TxnState::ACTIVE) it = txns_.erase(it);
            else ++it;
        }
    }

private:
    std::unordered_map<uint32_t, Transaction> txns_;
    std::atomic<uint32_t> next_id_;
    std::mutex mu_;

    Transaction& get_active(uint32_t id) {
        auto it = txns_.find(id);
        if (it == txns_.end()) throw std::runtime_error("Unknown transaction: " + std::to_string(id));
        if (it->second.state != TxnState::ACTIVE) throw std::runtime_error("Transaction not active: " + std::to_string(id));
        return it->second;
    }

    static uint64_t now_ms() {
        using namespace std::chrono;
        return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
    }
};
