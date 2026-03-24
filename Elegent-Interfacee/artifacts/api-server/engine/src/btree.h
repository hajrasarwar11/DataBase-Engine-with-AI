#pragma once
#include <vector>
#include <algorithm>
#include <stdexcept>
#include <optional>
#include <functional>

// B+ Tree: int64 key → int64 value (record_id → page:slot packed)
// ORDER = min degree (each node has 2t-1 keys max, t keys min)
// Leaf nodes form a linked list for range scans.

template<typename K, typename V>
class BPlusTree {
    static const int T = 4; // min degree → max keys = 2T-1 = 7

    struct Node {
        bool is_leaf;
        std::vector<K> keys;
        std::vector<V> vals;          // only in leaves
        std::vector<Node*> children;  // only in internal
        Node* next_leaf{nullptr};     // leaf chaining

        explicit Node(bool leaf) : is_leaf(leaf) {}
        ~Node() { if (!is_leaf) for (auto* c : children) delete c; }
    };

    Node* root_{nullptr};

public:
    BPlusTree()  { root_ = new Node(true); }
    ~BPlusTree() { delete root_; }

    // Move semantics — transfer ownership of the tree
    BPlusTree(BPlusTree&& o) noexcept : root_(o.root_) { o.root_ = new Node(true); }
    BPlusTree& operator=(BPlusTree&& o) noexcept {
        if (this != &o) { delete root_; root_ = o.root_; o.root_ = new Node(true); }
        return *this;
    }
    // Disable copies (tree owns its nodes)
    BPlusTree(const BPlusTree&) = delete;
    BPlusTree& operator=(const BPlusTree&) = delete;

    // Insert or update
    void insert(K key, V val) {
        auto [promoted_key, new_node] = insert_rec(root_, key, val);
        if (new_node) {
            // Root was split
            Node* new_root = new Node(false);
            new_root->keys.push_back(promoted_key);
            new_root->children.push_back(root_);
            new_root->children.push_back(new_node);
            root_ = new_root;
        }
    }

    // Search — returns value or nullopt
    std::optional<V> search(K key) const {
        Node* node = root_;
        while (!node->is_leaf) {
            int i = (int)(std::lower_bound(node->keys.begin(), node->keys.end(), key) - node->keys.begin());
            if (i < (int)node->keys.size() && node->keys[i] == key) i++;
            node = node->children[i];
        }
        auto it = std::lower_bound(node->keys.begin(), node->keys.end(), key);
        if (it != node->keys.end() && *it == key) {
            return node->vals[it - node->keys.begin()];
        }
        return std::nullopt;
    }

    // Remove key
    void remove(K key) { remove_rec(root_, key); }

    // Range scan [lo, hi] — calls cb for each found (key, value)
    void range(K lo, K hi, std::function<void(K,V)> cb) const {
        Node* node = root_;
        while (!node->is_leaf) {
            int i = (int)(std::lower_bound(node->keys.begin(), node->keys.end(), lo) - node->keys.begin());
            node = node->children[i];
        }
        while (node) {
            for (int i = 0; i < (int)node->keys.size(); i++) {
                if (node->keys[i] > hi) return;
                if (node->keys[i] >= lo) cb(node->keys[i], node->vals[i]);
            }
            node = node->next_leaf;
        }
    }

    // Iterate all leaves in order
    void scan(std::function<void(K,V)> cb) const {
        Node* node = root_;
        while (!node->is_leaf) node = node->children[0];
        while (node) {
            for (int i=0; i<(int)node->keys.size(); i++) cb(node->keys[i], node->vals[i]);
            node = node->next_leaf;
        }
    }

    size_t size() const {
        size_t n=0;
        scan([&](K,V){ n++; });
        return n;
    }

private:
    // Returns {promoted_key, new_node} — new_node non-null if split happened
    std::pair<K, Node*> insert_rec(Node* node, K key, V val) {
        if (node->is_leaf) {
            auto pos = std::lower_bound(node->keys.begin(), node->keys.end(), key);
            int idx = (int)(pos - node->keys.begin());
            if (pos != node->keys.end() && *pos == key) {
                node->vals[idx] = val; // update
                return {K{}, nullptr};
            }
            node->keys.insert(pos, key);
            node->vals.insert(node->vals.begin() + idx, val);
        } else {
            auto pos = std::upper_bound(node->keys.begin(), node->keys.end(), key);
            int child_idx = (int)(pos - node->keys.begin());
            auto [pk, new_child] = insert_rec(node->children[child_idx], key, val);
            if (new_child) {
                node->keys.insert(node->keys.begin() + child_idx, pk);
                node->children.insert(node->children.begin() + child_idx + 1, new_child);
            } else {
                return {K{}, nullptr};
            }
        }
        if ((int)node->keys.size() >= 2*T - 1) return split(node);
        return {K{}, nullptr};
    }

    std::pair<K, Node*> split(Node* node) {
        int mid = T - 1;
        Node* right = new Node(node->is_leaf);
        K promoted = node->keys[mid];

        if (node->is_leaf) {
            right->keys.assign(node->keys.begin() + mid, node->keys.end());
            right->vals.assign(node->vals.begin() + mid, node->vals.end());
            node->keys.resize(mid);
            node->vals.resize(mid);
            right->next_leaf = node->next_leaf;
            node->next_leaf  = right;
        } else {
            right->keys.assign(node->keys.begin() + mid + 1, node->keys.end());
            right->children.assign(node->children.begin() + mid + 1, node->children.end());
            node->keys.resize(mid);
            node->children.resize(mid + 1);
        }
        return {promoted, right};
    }

    void remove_rec(Node* node, K key) {
        if (node->is_leaf) {
            auto it = std::lower_bound(node->keys.begin(), node->keys.end(), key);
            if (it != node->keys.end() && *it == key) {
                int i = (int)(it - node->keys.begin());
                node->keys.erase(it);
                node->vals.erase(node->vals.begin() + i);
            }
        } else {
            auto pos = std::upper_bound(node->keys.begin(), node->keys.end(), key);
            int i = (int)(pos - node->keys.begin());
            if (i > 0 && node->keys[i-1] == key) i--;
            remove_rec(node->children[i], key);
            // Simple approach: no rebalancing for FYP scope
        }
    }
};

// Convenience: pack (page_id, slot) into int64
inline int64_t pack_loc(uint32_t page, uint32_t slot) {
    return ((int64_t)page << 32) | slot;
}
inline void unpack_loc(int64_t loc, uint32_t& page, uint32_t& slot) {
    page = (uint32_t)(loc >> 32);
    slot = (uint32_t)(loc & 0xFFFFFFFF);
}
