#ifdef _WIN32
#ifdef DELETE
#undef DELETE
#endif
#ifdef BEGIN
#undef BEGIN
#endif
#ifdef COMMIT
#undef COMMIT
#endif
#ifdef ROLLBACK
#undef ROLLBACK
#endif
#endif
#pragma once
#include <string>
#include <vector>
#include <unordered_map>
#include <cstdint>
#include "../include/json.hpp"

using json = nlohmann::json;

static const uint32_t PAGE_SIZE      = 4096;
static const uint32_t PAGE_MAGIC     = 0x55514C46; // "UQLF"
static const int32_t  NO_PAGE        = -1;
static const uint32_t MAX_RECORD_LEN = PAGE_SIZE - 64;

enum class PageType : uint32_t { HEADER = 0, DATA = 1, OVERFLOW = 2 };

#pragma pack(push, 1)
struct PageHeader {
    uint32_t magic;
    uint32_t page_id;
    PageType page_type;
    uint32_t num_slots;
    uint32_t free_offset;  // next write position in data area
    int32_t  next_page;    // linked list of overflow pages
    uint8_t  _reserved[16];
};
static const uint32_t HEADER_SIZE  = sizeof(PageHeader);
static const uint32_t DATA_AREA    = PAGE_SIZE - HEADER_SIZE;

struct SlotEntry {
    uint32_t offset;  // byte offset within data area
    uint32_t length;
    uint8_t  deleted; // tombstone flag
    uint8_t  _pad[3];
};
#pragma pack(pop)

struct Record {
    uint32_t page_id;
    uint32_t slot;
    json     data;
};

enum class ColType { TABLE, DOCUMENT, GRAPH };

struct FieldDef {
    std::string name;
    std::string type;   // "string" | "number" | "boolean" | "any"
    bool        required{false};
};

struct CollectionMeta {
    std::string              name;
    ColType                  type{ColType::DOCUMENT};
    std::vector<FieldDef>    schema;
    uint32_t                 next_id{1};
};

struct DatabaseMeta {
    std::string                                    name;
    std::unordered_map<std::string, CollectionMeta> collections;
};

enum class WalOp : uint8_t {
    CREATE_DB=0, DROP_DB=1, CREATE_COL=2, DROP_COL=3,
    INSERT=4, UPDATE=5, DELETE_OP=6,
    BEGIN_OP=7, COMMIT_OP=8, ROLLBACK_OP=9,
    CHECKPOINT=10
};

struct WalEntry {
    uint64_t lsn;
    uint32_t txn_id;
    WalOp    op;
    std::string db;
    std::string collection;
    json     payload;
};
