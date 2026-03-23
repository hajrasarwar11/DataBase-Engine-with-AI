// Cross-platform TCP server for the UQL engine
#ifdef _WIN32
  #define WIN32_LEAN_AND_MEAN
  #ifndef NOMINMAX
    #define NOMINMAX
  #endif
  #include <winsock2.h>
  #include <ws2tcpip.h>
  #pragma comment(lib, "ws2_32.lib")
  typedef SOCKET socket_t;
  typedef int    ssize_t;
  #define CLOSE_SOCKET(s) closesocket(s)
  #define INVALID_SOCK    INVALID_SOCKET
  #define MSG_NOSIGNAL    0
#else
  #include <sys/socket.h>
  #include <netinet/in.h>
  #include <arpa/inet.h>
  #include <unistd.h>
  typedef int socket_t;
  #define CLOSE_SOCKET(s) close(s)
  #define INVALID_SOCK    (-1)
#endif

#include "storage.h"
#include <thread>
#include <iostream>
#include <sstream>
#include <atomic>
#include <csignal>

static const int ENGINE_PORT = 5544;
static StorageEngine* g_engine = nullptr;
static std::atomic<bool> g_running{true};

void handle_signal(int) { g_running = false; }

// ── Command dispatcher ────────────────────────────────────────────────────────
json dispatch(const json& cmd) {
    std::string c = cmd.value("cmd", "");
    try {
        if (c == "PING") return {{"ok",true},{"pong",true}};

        // ── Database commands ──────────────────────────────────────────────
        if (c == "CREATE_DB") return g_engine->create_db(cmd["name"], cmd.value("txn",0));
        if (c == "DROP_DB")   return g_engine->drop_db(cmd["name"], cmd.value("txn",0));
        if (c == "LIST_DBS")  return g_engine->list_dbs();

        // ── Collection commands ────────────────────────────────────────────
        if (c == "CREATE_COL") {
            json schema = cmd.contains("schema") ? cmd["schema"] : json(nullptr);
            return g_engine->create_collection(
                cmd["db"], cmd["name"],
                cmd.value("type","document"), schema,
                cmd.value("txn",0));
        }
        if (c == "DROP_COL")   return g_engine->drop_collection(cmd["db"], cmd["name"], cmd.value("txn",0));
        if (c == "LIST_COLS")  return g_engine->list_collections(cmd["db"]);

        // ── Secondary Index commands ───────────────────────────────────────
        if (c == "CREATE_INDEX")
            return g_engine->create_index(cmd["db"], cmd["col"], cmd["field"], cmd.value("txn",0));
        if (c == "DROP_INDEX")
            return g_engine->drop_index(cmd["db"], cmd["col"], cmd["field"], cmd.value("txn",0));
        if (c == "LIST_INDEXES")
            return g_engine->list_indexes(cmd["db"], cmd["col"]);

        // ── Record commands ────────────────────────────────────────────────
        if (c == "INSERT") {
            json data = cmd.contains("data") ? cmd["data"] : json::object();
            return g_engine->insert(cmd["db"], cmd["col"], data, cmd.value("txn",0));
        }
        if (c == "FIND") {
            json where     = cmd.contains("where")   ? cmd["where"]   : json(nullptr);
            int  limit     = cmd.value("limit", 1000);
            std::string ob = cmd.value("order_by", "");
            bool oa        = cmd.value("order_asc", true);
            std::string gb = cmd.value("group_by", "");
            std::string af = cmd.value("agg_func", "");
            std::string aff= cmd.value("agg_field", "");
            return g_engine->find(cmd["db"], cmd["col"], where, limit, ob, oa, gb, af, aff);
        }
        if (c == "MODIFY") {
            json where   = cmd.contains("where") ? cmd["where"]   : json(nullptr);
            json set_val = cmd.contains("set")   ? cmd["set"]     : json::object();
            return g_engine->modify(cmd["db"], cmd["col"], where, set_val, cmd.value("txn",0));
        }
        if (c == "REMOVE") {
            json where = cmd.contains("where") ? cmd["where"] : json(nullptr);
            return g_engine->remove(cmd["db"], cmd["col"], where, cmd.value("txn",0));
        }

        // ── Graph commands ─────────────────────────────────────────────────
        if (c == "FIND_PATH") {
            return g_engine->find_path(
                cmd["db"], cmd["col"],
                cmd["from"].get<int64_t>(), cmd["to"].get<int64_t>());
        }

        // ── Statistics ─────────────────────────────────────────────────────
        if (c == "STATS") return g_engine->stats();

        // ── Transaction commands ───────────────────────────────────────────
        if (c == "BEGIN")    return g_engine->begin_txn();
        if (c == "COMMIT")   return g_engine->commit_txn(cmd["txn"].get<uint32_t>());
        if (c == "ROLLBACK") return g_engine->rollback_txn(cmd["txn"].get<uint32_t>());

        return {{"ok",false},{"error","Unknown command: " + c}};

    } catch (std::exception& e) {
        return {{"ok",false},{"error",std::string(e.what())}};
    } catch (...) {
        return {{"ok",false},{"error","Internal engine error"}};
    }
}

// ── Client handler ────────────────────────────────────────────────────────────
void handle_client(socket_t client_fd) {
    char buf[131072];
    std::string incoming;

    while (true) {
        ssize_t n = recv(client_fd, buf, sizeof(buf)-1, 0);
        if (n <= 0) break;
        buf[n] = '\0';
        incoming += buf;

        size_t pos;
        while ((pos = incoming.find('\n')) != std::string::npos) {
            std::string line = incoming.substr(0, pos);
            incoming.erase(0, pos+1);
            if (line.empty() || line == "\r") continue;

            json response;
            try {
                json cmd = json::parse(line);
                response = dispatch(cmd);
            } catch (std::exception& e) {
                response = {{"ok",false},{"error","Parse error: " + std::string(e.what())}};
            }

            std::string resp_str = response.dump() + "\n";
            send(client_fd, resp_str.c_str(), (int)resp_str.size(), MSG_NOSIGNAL);
        }
    }
    CLOSE_SOCKET(client_fd);
}

// ── Main ──────────────────────────────────────────────────────────────────────
int main(int argc, char* argv[]) {
    std::string data_dir = ".uql-data";
    if (argc > 1) data_dir = argv[1];

#ifdef _WIN32
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2,2), &wsa) != 0) {
        std::cerr << "[UQL Engine] WSAStartup failed\n";
        return 1;
    }
#else
    std::signal(SIGPIPE, SIG_IGN);
#endif

    std::signal(SIGINT,  handle_signal);
    std::signal(SIGTERM, handle_signal);

    std::cout << "[UQL Engine] Starting — data dir: " << data_dir << "\n";

    g_engine = new StorageEngine(data_dir);
    try {
        g_engine->open();
        std::cout << "[UQL Engine] Storage engine opened\n";
    } catch (std::exception& e) {
        std::cerr << "[UQL Engine] Failed to open storage: " << e.what() << "\n";
        return 1;
    }

    socket_t server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd == INVALID_SOCK) { perror("socket"); return 1; }

    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

    sockaddr_in addr{};
    addr.sin_family      = AF_INET;
    addr.sin_addr.s_addr = inet_addr("127.0.0.1");
    addr.sin_port        = htons(ENGINE_PORT);

    if (bind(server_fd, (sockaddr*)&addr, sizeof(addr)) < 0) { perror("bind"); return 1; }
    if (listen(server_fd, 64) < 0) { perror("listen"); return 1; }

    std::cout << "[UQL Engine] Listening on port " << ENGINE_PORT << "\n";
    std::cout.flush();

    while (g_running) {
        sockaddr_in client_addr{};
        socklen_t client_len = sizeof(client_addr);
        socket_t client_fd = accept(server_fd, (sockaddr*)&client_addr, &client_len);
        if (client_fd == INVALID_SOCK) {
            if (!g_running) break;
            continue;
        }
        std::thread([client_fd]{ handle_client(client_fd); }).detach();
    }

    CLOSE_SOCKET(server_fd);
    delete g_engine;

#ifdef _WIN32
    WSACleanup();
#endif

    std::cout << "[UQL Engine] Shutdown complete\n";
    return 0;
}
