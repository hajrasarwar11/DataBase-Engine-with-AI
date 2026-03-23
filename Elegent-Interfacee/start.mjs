/**
 * UQL Studio — Cross-platform startup script
 * Works on Windows, macOS, and Linux.
 * Usage: node start.mjs  (from inside Elegent-Interfacee/)
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IS_WIN    = process.platform === "win32";
const ROOT      = __dirname;

const colors = {
  reset:  "\x1b[0m",
  cyan:   "\x1b[36m",
  purple: "\x1b[35m",
  yellow: "\x1b[33m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
};

function log(prefix, color, msg) {
  process.stdout.write(`${color}[${prefix}]${colors.reset} ${msg}\n`);
}

function prefixedPipe(proc, prefix, color) {
  const tag = `${color}[${prefix}]${colors.reset} `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        out.write(tag + buf.slice(0, nl) + "\n");
        buf = buf.slice(nl + 1);
      }
    });
    stream.on("end", () => { if (buf) out.write(tag + buf + "\n"); });
  };
  pipe(proc.stdout, process.stdout);
  pipe(proc.stderr, process.stderr);
}

function runProcess(label, color, cmd, args, opts = {}) {
  const proc = spawn(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
    shell: IS_WIN,
    stdio: ["ignore", "pipe", "pipe"],
  });
  prefixedPipe(proc, label, color);
  proc.on("error", (err) => {
    log(label, colors.red, `Failed to start: ${err.message}`);
    if (err.code === "ENOENT") {
      log(label, colors.red, `Command not found: "${cmd}". Make sure Node.js, pnpm, and g++ are installed.`);
    }
  });
  proc.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      log(label, colors.red, `Exited with code ${code}`);
      process.exit(code ?? 1);
    }
  });
  return proc;
}

// ── Banner ────────────────────────────────────────────────────────────────────
console.log(`
${colors.cyan}┌────────────────────────────────────────┐
│          UQL Studio — Dev Server       │
│                                        │
│  Frontend : http://localhost:5000      │
│  API      : http://localhost:3000      │
└────────────────────────────────────────┘${colors.reset}
`);

log("start", colors.green, "Starting UQL Studio…");

const pnpm = IS_WIN ? "pnpm.cmd" : "pnpm";

// ── API Server (port 3000) ────────────────────────────────────────────────────
const api = runProcess("api", colors.purple, pnpm, [
  "--filter", "@workspace/api-server", "run", "dev",
], { env: { PORT: "3000" } });

// ── Frontend Vite dev server (port 5000) ──────────────────────────────────────
const frontend = runProcess("web", colors.cyan, pnpm, [
  "--filter", "@workspace/uql-studio", "run", "dev",
], { env: { PORT: "5000", BASE_PATH: "/" } });

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown() {
  log("start", colors.yellow, "Shutting down…");
  api.kill();
  frontend.kill();
  process.exit(0);
}

process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP",  shutdown);
