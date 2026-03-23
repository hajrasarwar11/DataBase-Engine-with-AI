import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { spawnSync, spawn } from "child_process";
import net from "net";
import app from "./app";

const __dirname      = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR     = join(__dirname, "..", "engine");
const IS_WINDOWS     = process.platform === "win32";
const ENGINE_BIN_NAME = IS_WINDOWS ? "uqlengine.exe" : "uqlengine";
const ENGINE_BIN     = join(ENGINE_DIR, "build", ENGINE_BIN_NAME);
const ENGINE_HOST    = "127.0.0.1";
const ENGINE_PORT    = 5544;

// ── Build engine if binary missing ───────────────────────────────────────────
function buildEngine() {
  if (existsSync(ENGINE_BIN)) return;
  console.log("[engine] Binary not found — building…");

  if (IS_WINDOWS) {
    // On Windows try make first (MSYS2/MinGW), fallback to direct g++ invocation
    let r = spawnSync("make", ["-C", ENGINE_DIR], { stdio: "inherit", shell: true });
    if (r.status !== 0) {
      console.log("[engine] make failed, trying g++ directly…");
      const outBin = join(ENGINE_DIR, "build", ENGINE_BIN_NAME);
      const mkdirR = spawnSync("cmd", ["/c", `if not exist "${join(ENGINE_DIR, "build")}" mkdir "${join(ENGINE_DIR, "build")}"`], { stdio: "inherit" });
      r = spawnSync("g++", [
        "-std=c++17", "-O2", "-pthread",
        `-I${join(ENGINE_DIR, "include")}`,
        join(ENGINE_DIR, "src", "main.cpp"),
        "-o", outBin,
        "-lws2_32",
      ], { stdio: "inherit" });
      if (r.status !== 0) throw new Error("C++ engine build failed. Install g++ via MSYS2/MinGW or Git for Windows.");
    }
  } else {
    const r = spawnSync("make", ["-C", ENGINE_DIR], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("C++ engine build failed. Install g++ and make.");
  }

  console.log("[engine] Build complete.");
}

// ── Poll until TCP port accepts connections ───────────────────────────────────
function waitForPort(host: string, port: number, timeoutMs = 12_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tryConnect = () => {
      const s = net.createConnection({ host, port }, () => { s.destroy(); resolve(); });
      s.on("error", () => {
        s.destroy();
        if (Date.now() > deadline) { reject(new Error(`Engine did not bind port ${port}`)); return; }
        setTimeout(tryConnect, 250);
      });
    };
    tryConnect();
  });
}

// ── Spawn engine subprocess ───────────────────────────────────────────────────
function spawnEngine() {
  const child = spawn(ENGINE_BIN, [], { detached: false, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (d: Buffer) => process.stdout.write(`[engine] ${d}`));
  child.stderr?.on("data", (d: Buffer) => process.stderr.write(`[engine] ${d}`));
  child.on("exit", (code) => { console.error(`[engine] Exited with code ${code}`); process.exit(1); });
  console.log(`[engine] Spawned PID ${child.pid}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const rawPort = process.env["PORT"];
  if (!rawPort) throw new Error("PORT environment variable is required");
  const port = Number(rawPort);
  if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT: "${rawPort}"`);

  // Check if engine already running
  let alreadyUp = false;
  try { await waitForPort(ENGINE_HOST, ENGINE_PORT, 500); alreadyUp = true; } catch {}

  if (!alreadyUp) {
    buildEngine();
    spawnEngine();
    console.log("[engine] Waiting for engine to be ready…");
    await waitForPort(ENGINE_HOST, ENGINE_PORT, 15_000);
    console.log("[engine] Engine ready.");
  } else {
    console.log("[engine] Already running on port " + ENGINE_PORT);
  }

  app.listen(port, () => console.log(`[api] Listening on port ${port}`));
}

main().catch((err) => { console.error("[startup] Fatal:", err); process.exit(1); });
