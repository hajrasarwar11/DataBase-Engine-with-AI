import net from "net";

const ENGINE_HOST = "127.0.0.1";
const ENGINE_PORT = 5544;

// Persistent connection pool (one connection reused per request)
class EngineClient {
  private socket: net.Socket | null = null;
  private buffer = "";
  private queue: Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }> = [];
  private connecting = false;

  private async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) {
      await new Promise<void>((r) => setTimeout(r, 50));
      return this.connect();
    }
    this.connecting = true;
    return new Promise((resolve, reject) => {
      const s = net.createConnection({ host: ENGINE_HOST, port: ENGINE_PORT }, () => {
        this.socket = s;
        this.connecting = false;
        resolve();
      });
      s.setEncoding("utf8");
      s.on("data", (chunk: string) => {
        this.buffer += chunk;
        let nl: number;
        while ((nl = this.buffer.indexOf("\n")) !== -1) {
          const line = this.buffer.slice(0, nl).trim();
          this.buffer = this.buffer.slice(nl + 1);
          if (!line) continue;
          const waiter = this.queue.shift();
          if (!waiter) continue;
          try {
            waiter.resolve(JSON.parse(line));
          } catch (e) {
            waiter.reject(new Error("Bad JSON from engine: " + line));
          }
        }
      });
      s.on("error", (err) => {
        this.connecting = false;
        this.socket = null;
        reject(err);
        // Drain pending queue
        for (const w of this.queue) w.reject(err);
        this.queue = [];
      });
      s.on("close", () => {
        this.socket = null;
        this.connecting = false;
      });
      setTimeout(() => {
        if (this.connecting) {
          this.connecting = false;
          reject(new Error("Engine connection timeout"));
        }
      }, 5000);
    });
  }

  async send(cmd: Record<string, unknown>): Promise<unknown> {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      const line = JSON.stringify(cmd) + "\n";
      this.socket!.write(line);
    });
  }

  destroy() {
    this.socket?.destroy();
    this.socket = null;
  }
}

const client = new EngineClient();

export async function engineCmd(cmd: Record<string, unknown>): Promise<unknown> {
  const result = await client.send(cmd);
  const r = result as { ok: boolean; error?: string };
  if (r.ok === false) throw new Error(r.error || "Engine error");
  return result;
}

export async function pingEngine(): Promise<boolean> {
  try {
    await engineCmd({ cmd: "PING" });
    return true;
  } catch {
    return false;
  }
}
