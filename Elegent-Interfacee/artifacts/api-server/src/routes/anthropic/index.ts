import { Router, type IRouter } from "express";
import { store } from "../../store.js";
import OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";

// Anthropic
let anthropic: Anthropic | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  anthropic = require("@workspace/integrations-anthropic-ai").anthropic;
} catch {
  // Not available locally
}

const router: IRouter = Router();

// ── Ollama helpers ────────────────────────────────────────────────────────────

const OLLAMA_BASE = "http://localhost:11434";
const PHI_CANDIDATES = ["phi4:latest", "phi4", "phi3.5", "phi3:mini", "phi3", "phi:latest", "phi"];
const VISION_CANDIDATES = ["llava:latest", "llava", "bakllava", "moondream", "llava-phi3"];

interface OllamaModel { name: string }

async function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getOllamaStatus(): Promise<{
  available: boolean; model: string | null; models: string[]; visionModel: string | null;
}> {
  try {
    const res = await fetchWithTimeout(`${OLLAMA_BASE}/api/tags`, {}, 15000);
    if (!res.ok) return { available: false, model: null, models: [], visionModel: null };
    const data = (await res.json()) as { models: OllamaModel[] };
    const modelNames = (data.models ?? []).map((m) => m.name);
    console.log("[Ollama] Available models:", modelNames);
    if (modelNames.length === 0) {
      console.warn("[Ollama] No models installed. Run: ollama pull phi3:mini");
      return { available: false, model: null, models: [], visionModel: null };
    }
    const pick =
      PHI_CANDIDATES.find((c) => modelNames.some((n) => n === c)) ??
      PHI_CANDIDATES.find((c) => modelNames.some((n) => n.startsWith(c.split(":")[0]))) ??
      modelNames[0];
    const visionModel =
      VISION_CANDIDATES.find((c) => modelNames.some((n) => n === c)) ??
      VISION_CANDIDATES.find((c) => modelNames.some((n) => n.startsWith(c.split(":")[0]))) ??
      null;
    console.log("[Ollama] Selected model:", pick, "| Vision model:", visionModel);
    return { available: true, model: pick, models: modelNames, visionModel };
  } catch (err) {
    console.warn("[Ollama] Not reachable:", err);
    return { available: false, model: null, models: [], visionModel: null };
  }
}

const OLLAMA_STREAM_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for slow CPU inference

async function streamOllama(
  model: string,
  messages: Array<{ role: string; content: string; images?: string[] }>,
  onChunk: (text: string) => void
): Promise<string> {
  console.log("[Ollama] Streaming with model:", model);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    console.warn("[Ollama] Stream timed out after", OLLAMA_STREAM_TIMEOUT_MS / 1000, "s");
  }, OLLAMA_STREAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: {
          num_ctx: 4096,    // FIX 3: increased from 1024 so file content fits in context
          num_predict: 300, // Prevent rambling
        },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }

  if (!res.ok) {
    clearTimeout(timer);
    const text = await res.text();
    console.error("[Ollama] Stream error:", res.status, text);
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          const chunk = data.message?.content ?? "";
          if (chunk) { full += chunk; onChunk(chunk); }
        } catch { /* skip malformed */ }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return full;
}

// ── System prompts ─────────────────────────────────────────────────────────────
//
// KEY DESIGN DECISIONS:
//   1. All queries MUST be wrapped in ```uql blocks — this triggers the Run/Insert
//      button UI in the frontend (ai-assistant.tsx parseContent function).
//   2. Correct UQL syntax is explicitly taught with working examples.
//   3. Wrong SQL syntax is explicitly forbidden.
//   4. Phi2 identity override prevents "I'm a Microsoft AI" responses.
// ─────────────────────────────────────────────────────────────────────────────

// Full prompt for capable models (Anthropic claude, GitHub gpt-4o, phi3+)
const SYSTEM_PROMPT = `You are UQL Copilot, the built-in AI assistant for UQL Studio.
UQL Studio is a custom database IDE with its own query language called UQL.
You were created by the UQL Studio team. You are NOT ChatGPT, NOT a Microsoft AI, NOT any other product.

YOUR ONLY JOB: Help users write and understand UQL queries for their database.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MANDATORY OUTPUT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. ALWAYS wrap every query inside a \`\`\`uql code block. Never output raw queries.
2. NEVER use SQL syntax: no SELECT, no INSERT INTO, no UPDATE, no DELETE FROM.
3. Answer only what was asked. Be brief (1-3 sentences + the query).
4. Do NOT say "I cannot execute queries" — just give the query for the user to run.
5. Do NOT invent commands that are not in the UQL reference below.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  COMPLETE UQL LANGUAGE REFERENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DATABASE COMMANDS:
  CREATE DB <name>              -- no IN needed, just the name
  SHOW STATS
  SHOW STATS IN <db>

CREATE COLLECTIONS:
  CREATE TABLE    <name> IN <db>
  CREATE GRAPH    <name> IN <db>
  CREATE DOCUMENT <name> IN <db>

INSERT (keyword is ADD, never INSERT INTO):
  ADD <collection> VALUES { field: "value", num: 123 } IN <db>

QUERY (keyword is FIND, never SELECT):
  FIND <collection> IN <db>
  FIND <collection> WHERE <field> = "value" IN <db>
  FIND <collection> WHERE <field> > 10 IN <db>
  FIND <collection> WHERE <field> = "x" AND <field2> = "y" IN <db>
  FIND <collection> WHERE id = 1 IN <db>
  FIND <collection> LIMIT 10 IN <db>
  FIND <collection> ORDER BY <field> ASC IN <db>
  FIND <collection> ORDER BY <field> DESC LIMIT 5 IN <db>

JOIN:
  FIND <col1> JOIN <col2> ON id = <col2>.<field> IN <db>

AGGREGATES:
  FIND <collection> AGGREGATE COUNT(*) IN <db>
  FIND <collection> AGGREGATE AVG(<field>) IN <db>
  FIND <collection> AGGREGATE SUM(<field>) IN <db>
  FIND <collection> AGGREGATE MIN(<field>) IN <db>
  FIND <collection> AGGREGATE MAX(<field>) IN <db>
  FIND <collection> GROUP BY <field> AGGREGATE COUNT(*) IN <db>
  FIND <collection> GROUP BY <field> AGGREGATE SUM(<field>) IN <db>

UPDATE (keyword is MODIFY, never UPDATE):
  MODIFY <collection> SET <field> = "value" WHERE <field2> = "x" IN <db>
  MODIFY <collection> SET <f1> = "a", <f2> = 30 WHERE id = 1 IN <db>

DELETE (keyword is REMOVE, never DELETE):
  REMOVE <collection> WHERE <field> = "value" IN <db>

INDEXES:
  CREATE INDEX ON <collection>(<field>) IN <db>
  SHOW INDEXES FOR <collection> IN <db>
  DROP INDEX ON <collection>(<field>) IN <db>

EXPLAIN:
  EXPLAIN FIND <collection> WHERE <field> = "value" IN <db>

DROP:
  DROP TABLE    <name> IN <db>
  DROP GRAPH    <name> IN <db>
  DROP DOCUMENT <name> IN <db>

GRAPH / PATH:
  ADD <edgeCollection> VALUES { from: <id>, to: <id>, relation_type: "LABEL" } IN <db>
  FIND PATH FROM <edgeCollection>(<startId>) TO <edgeCollection>(<endId>) IN <db>

TRANSACTIONS:
  BEGIN
  ADD <collection> VALUES { ... } IN <db>
  COMMIT
  (or ROLLBACK)

WHERE OPERATORS: =  !=  >  >=  <  <=  AND

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CORRECT EXAMPLES (always follow this format)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Q: How do I create a new database?
A: Use CREATE DB followed by your database name.
\`\`\`uql
CREATE DB MyDatabase
\`\`\`

Q: How do I create a table called users?
A: Use CREATE TABLE with your database name.
\`\`\`uql
CREATE TABLE users IN MyDatabase
\`\`\`

Q: How do I insert a user?
A: Use ADD with curly-brace field syntax.
\`\`\`uql
ADD users VALUES { name: "Alice", age: 28, role: "admin" } IN MyDatabase
\`\`\`

Q: How do I find all users?
A: Use FIND with your collection and database.
\`\`\`uql
FIND users IN MyDatabase
\`\`\`

Q: How do I find a user named Alice?
A:
\`\`\`uql
FIND users WHERE name = "Alice" IN MyDatabase
\`\`\`

Q: How do I find all users older than 25?
A:
\`\`\`uql
FIND users WHERE age > 25 IN MyDatabase
\`\`\`

Q: How do I update a user's role?
A: Use MODIFY with SET and WHERE.
\`\`\`uql
MODIFY users SET role = "admin" WHERE name = "Alice" IN MyDatabase
\`\`\`

Q: How do I delete a user?
A: Use REMOVE with a WHERE condition.
\`\`\`uql
REMOVE users WHERE name = "Alice" IN MyDatabase
\`\`\`

Q: How do I count all users?
A:
\`\`\`uql
FIND users AGGREGATE COUNT(*) IN MyDatabase
\`\`\`

Q: How do I find the path between two nodes?
A: Use FIND PATH on your graph (edge) collection.
\`\`\`uql
FIND PATH FROM follows(1) TO follows(4) IN MyDatabase
\`\`\`

Q: How do I see all my databases?
A:
\`\`\`uql
SHOW STATS
\`\`\``;

// ── Short prompt for Phi2 (phi:latest) ───────────────────────────────────────
// Phi2 has only 2048 token context. This prompt must stay under ~250 tokens.
// It MUST include the identity override and the ```uql block requirement.
const PHI_SYSTEM_PROMPT = `You are UQL Copilot, the AI assistant inside UQL Studio app.
You are NOT a Microsoft AI. You are NOT ChatGPT. You were made by the UQL Studio team.
Your only job is to help users write UQL queries.

STRICT RULES:
- Always put queries in \`\`\`uql blocks. NEVER output raw queries.
- NEVER say "I cannot execute". Just give the query.
- NEVER use SQL (no SELECT, INSERT INTO, UPDATE, DELETE).
- Answer in 1-3 sentences then the query.

UQL COMMANDS (use ONLY these):
  CREATE DB <name>
  CREATE TABLE <name> IN <db>
  CREATE GRAPH <name> IN <db>
  CREATE DOCUMENT <name> IN <db>
  ADD <collection> VALUES { field: "val", num: 1 } IN <db>
  FIND <collection> IN <db>
  FIND <collection> WHERE <field> = "val" IN <db>
  FIND <collection> WHERE <field> > 10 IN <db>
  FIND <collection> LIMIT 10 IN <db>
  FIND <collection> ORDER BY <field> ASC IN <db>
  FIND <collection> AGGREGATE COUNT(*) IN <db>
  FIND <collection> AGGREGATE AVG(<field>) IN <db>
  FIND <collection> AGGREGATE SUM(<field>) IN <db>
  MODIFY <collection> SET <field> = "val" WHERE id = 1 IN <db>
  REMOVE <collection> WHERE <field> = "val" IN <db>
  FIND PATH FROM <graph>(<id>) TO <graph>(<id>) IN <db>
  SHOW STATS
  DROP TABLE <name> IN <db>

EXAMPLES:
Q: create database → \`\`\`uql\nCREATE DB MyDatabase\n\`\`\`
Q: create table users → \`\`\`uql\nCREATE TABLE users IN MyDatabase\n\`\`\`
Q: find all users → \`\`\`uql\nFIND users IN MyDatabase\n\`\`\`
Q: insert user → \`\`\`uql\nADD users VALUES { name: "Alice", age: 28 } IN MyDatabase\n\`\`\`
Q: update user → \`\`\`uql\nMODIFY users SET role = "admin" WHERE name = "Alice" IN MyDatabase\n\`\`\`
Q: delete user → \`\`\`uql\nREMOVE users WHERE name = "Alice" IN MyDatabase\n\`\`\``;

// ── Attachment type ───────────────────────────────────────────────────────────

type AttachmentPayload = {
  name: string; mediaType: string; fileType: "image" | "text" | "document"; data: string;
};

const buildLastContent = (
  hasAttachments: boolean,
  savedContent: string,
  attachments: AttachmentPayload[] | undefined,
  trimmedContent: string
): string | ContentBlockParam[] => {
  if (!hasAttachments) return savedContent;
  const blocks: ContentBlockParam[] = [];
  const allowedImageTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  for (const att of attachments ?? []) {
    if (att.fileType === "image" && allowedImageTypes.includes(att.mediaType)) {
      blocks.push({ type: "image", source: { type: "base64", media_type: att.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: att.data } });
    } else if (att.fileType === "document" && att.mediaType === "application/pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: att.data } });
    } else {
      // FIX 1: increased from 500 to 4000 chars so the model can actually read the file
      blocks.push({ type: "text", text: `[File: ${att.name}]\n${att.data.slice(0, 4000)}` });
    }
  }
  blocks.push({ type: "text", text: trimmedContent || "What do you see?" });
  return blocks;
};

const toOpenAIContent = (raw: ReturnType<typeof buildLastContent>): OpenAI.ChatCompletionContentPart[] | string => {
  if (typeof raw === "string") return raw;
  return raw.map((block): OpenAI.ChatCompletionContentPart => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "image" && block.source.type === "base64") {
      const src = block.source;
      return { type: "image_url", image_url: { url: `data:${src.media_type};base64,${src.data}` } };
    }
    return { type: "text", text: "[PDF attachment]" };
  });
};

// ── Build Ollama messages — trim history to fit Phi2's tiny 2048-token context ─
function buildOllamaMessages(
  systemPrompt: string,
  history: Array<{ role: string; content: string }>,
  trimmedContent: string,
  hasAttachments: boolean,
  attachments?: AttachmentPayload[]
): Array<{ role: string; content: string; images?: string[] }> {
  const imageAttachments = attachments?.filter((a) => a.fileType === "image") ?? [];
  const textAttachments = attachments?.filter((a) => a.fileType === "text") ?? [];

  // Keep only the last 4 messages (2 turns) to prevent "truncating input prompt"
  const MAX_MSGS = 4;
  const recentHistory = history.length > MAX_MSGS ? history.slice(-MAX_MSGS) : history;

  const msgs: Array<{ role: string; content: string; images?: string[] }> = [
    { role: "system", content: systemPrompt },
  ];

  for (let i = 0; i < recentHistory.length; i++) {
    const m = recentHistory[i];
    const isLast = i === recentHistory.length - 1;

    if (isLast && hasAttachments) {
      let contentText = trimmedContent || "Look at this image.";
      if (textAttachments.length > 0) {
        contentText = "Answer using the file content below.\n\n" +
        textAttachments.map((a) => `[File: ${a.name}]\n${a.data.slice(0, 3000)}`).join("\n\n") +
        "\n\nUser question: " + (trimmedContent || "What is in this file?");
      }
      const msg: { role: string; content: string; images?: string[] } = { role: m.role, content: contentText };
      if (imageAttachments.length > 0) msg.images = imageAttachments.map((a) => a.data);
      msgs.push(msg);
    } else {
      const content = m.content.length > 300 ? m.content.slice(0, 300) + "…" : m.content;
      msgs.push({ role: m.role, content });
    }
  }

  return msgs;
}

// ── Post-process AI response ──────────────────────────────────────────────────
// If the AI (especially Phi2) outputs a query WITHOUT a ```uql block,
// detect it and wrap it automatically so the Run/Insert buttons appear.
function ensureUqlBlocks(response: string): string {
  // If already has a uql block, don't touch it
  if (response.includes("```uql")) return response;

  // Detect lines that look like UQL commands
  const UQL_KEYWORDS = /^(CREATE|FIND|ADD|MODIFY|REMOVE|DROP|SHOW|BEGIN|COMMIT|ROLLBACK|EXPLAIN)\s/i;
  const lines = response.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // If this line looks like a UQL command and it's not already in a code block
    if (UQL_KEYWORDS.test(line) && !line.startsWith("```")) {
      // Collect consecutive UQL-looking lines as one block
      const block: string[] = [];
      while (i < lines.length) {
        const current = lines[i].trim();
        if (current === "" && block.length > 0) break;
        if (!current.startsWith("```")) {
          block.push(lines[i]);
          i++;
        } else {
          break;
        }
      }
      if (block.length > 0) {
        result.push("```uql");
        result.push(...block.map(l => l.trim()));
        result.push("```");
      }
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join("\n");
}

// ── Conversation routes ───────────────────────────────────────────────────────

router.get("/anthropic/conversations", (_req, res) => {
  try { res.json(store.listConversations()); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

router.post("/anthropic/conversations", (req, res) => {
  try {
    const { title } = req.body as { title?: string };
    const created = store.createConversation(title || "New Chat");
    res.status(201).json(created);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get("/anthropic/conversations/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    const conversation = store.getConversation(id);
    if (!conversation) { res.status(404).json({ error: "Conversation not found" }); return; }
    res.json({ ...conversation, messages: store.listMessages(id) });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.delete("/anthropic/conversations/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!store.deleteConversation(id)) { res.status(404).json({ error: "Conversation not found" }); return; }
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get("/anthropic/conversations/:id/messages", (req, res) => {
  try {
    const id = Number(req.params.id);
    res.json(store.listMessages(id));
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ── Local model status + model list ──────────────────────────────────────────

router.get("/ai/local/status", async (_req, res) => {
  try { res.json(await getOllamaStatus()); }
  catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get("/ai/local/models", async (_req, res) => {
  try {
    const status = await getOllamaStatus();
    res.json({ available: status.available, models: status.models, defaultModel: status.model, visionModel: status.visionModel });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ── Message streaming ─────────────────────────────────────────────────────────

router.post("/anthropic/conversations/:id/messages", async (req, res) => {
  const conversationId = Number(req.params.id);
  const { content, databaseName, schema: schemaCtx, attachments, lastQuery, lastResult, selectedModel }: {
    content?: string; databaseName?: string; schema?: string;
    attachments?: AttachmentPayload[]; lastQuery?: string; lastResult?: unknown; selectedModel?: string;
  } = req.body;

  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  const trimmedContent = content?.trim() ?? "";
  const hasImages = hasAttachments && attachments!.some((a) => a.fileType === "image");

  if (!trimmedContent && !hasAttachments) { res.status(400).json({ error: "Content or attachments are required" }); return; }

  const conversation = store.getConversation(conversationId);
  if (!conversation) { res.status(404).json({ error: "Conversation not found" }); return; }

  const attachmentSummary = hasAttachments ? ` [Attached: ${attachments!.map((a) => a.name).join(", ")}]` : "";
  const savedContent = (trimmedContent || "(file attachment)") + attachmentSummary;
  store.insertMessage({ conversationId, role: "user", content: savedContent });

  const history = store.listMessages(conversationId);

  // ── Determine provider ────────────────────────────────────────────────────
  const githubToken: string | undefined =
    (req as unknown as { session?: { github_token?: string } }).session?.github_token;

  const ollamaStatus = await getOllamaStatus();
  const useLocal = ollamaStatus.available && !!ollamaStatus.model;
  const useGitHub = !useLocal && !!githubToken;
  const useAnthropic = !useLocal && !useGitHub && !!anthropic;

  console.log(`[AI Route] Provider: ${useLocal ? `Ollama(${ollamaStatus.model})` : useGitHub ? "GitHub" : useAnthropic ? "Anthropic" : "NONE"}`);

  // ── SSE headers ───────────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // Heartbeat — keeps SSE alive during slow Phi2 inference
  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { /* ignore */ }
  }, 15000);

  if (!useLocal && !useGitHub && !useAnthropic) {
    clearInterval(heartbeat);
    const noModelMsg = ollamaStatus.models.length === 0
      ? "Ollama is running but no models are installed.\n\nRun:\n  ollama pull phi3:mini\n\nThen click ↺ to refresh."
      : "No AI provider configured. Please install a model or sign in with GitHub.";
    store.insertMessage({ conversationId, role: "assistant", content: noModelMsg });
    res.write(`data: ${JSON.stringify({ content: noModelMsg })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    return;
  }

  // ── Build system prompt ───────────────────────────────────────────────────
  let systemPrompt = useLocal ? PHI_SYSTEM_PROMPT : SYSTEM_PROMPT;

  // Inject live schema context so AI uses real collection names
  if (useLocal) {
    // Phi2: additions must be very short (2048 token limit)
    if (databaseName) systemPrompt += `\nActive DB: ${databaseName}. Use "${databaseName}" as the <db> in all queries.`;
    if (schemaCtx) systemPrompt += `\nCollections: ${schemaCtx.slice(0, 120)}`;
    if (lastQuery) systemPrompt += `\nLast query: ${lastQuery.trim().slice(0, 80)}`;
  } else {
    // Capable models: full context
    if (databaseName || schemaCtx) {
      systemPrompt += "\n\n━━━ CURRENT DATABASE CONTEXT ━━━\n";
      if (databaseName) systemPrompt += `Active DB: "${databaseName}" — use this exact name in all queries.\n`;
      if (schemaCtx) systemPrompt += `Collections:\n${schemaCtx}\nUse these exact collection names in queries.\n`;
    }
    if (lastQuery || lastResult) {
      systemPrompt += "\n━━━ LAST EXECUTED QUERY + RESULT ━━━\n";
      if (lastQuery) systemPrompt += `Query: \`${lastQuery.trim()}\`\n`;
      if (lastResult !== undefined && lastResult !== null) {
        try { systemPrompt += `Result:\n${JSON.stringify(lastResult, null, 2).slice(0, 2000)}\n`; } catch { /* ignore */ }
      }
    }
  }

  // FIX 2: graceful message when image is attached but no vision model is available
  if (hasImages) {
    if (ollamaStatus.visionModel) {
      systemPrompt += "\nThe user attached an image. Describe only what you actually see in it.";
    } else {
      systemPrompt += "\nThe user attached an image but your current model cannot see images. Politely tell them that image viewing requires a vision model, and that they can enable it by running: ollama pull moondream (only ~800 MB, works on 8 GB RAM). Then click ↺ to refresh.";
    }
  }

  // ── Resolve model ─────────────────────────────────────────────────────────
  let ollamaModel: string = ollamaStatus.model ?? "";
  if (useLocal) {
    if (hasImages && ollamaStatus.visionModel) ollamaModel = ollamaStatus.visionModel;
    else if (selectedModel && ollamaStatus.models.includes(selectedModel)) ollamaModel = selectedModel;
    else ollamaModel = ollamaStatus.model!;
    console.log(`[Ollama] Using model: "${ollamaModel}"`);
  }

  let fullResponse = "";

  try {
    if (useLocal) {
      // ── Tier 1: Local Ollama ──────────────────────────────────────────────
      const ollamaMessages = buildOllamaMessages(systemPrompt, history, trimmedContent, hasAttachments, attachments);
      const rawResponse = await streamOllama(ollamaModel, ollamaMessages, (chunk) => {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      });

      // Post-process: wrap bare UQL queries in ```uql blocks if Phi2 forgot
      const processed = ensureUqlBlocks(rawResponse);
      if (processed !== rawResponse) {
        // If we added blocks, send a correction patch to replace the full content
        console.log("[Ollama] Post-processed response to add ```uql blocks");
        fullResponse = processed;
        res.write(`data: ${JSON.stringify({ replace: processed })}\n\n`);
      } else {
        fullResponse = rawResponse;
      }

    } else if (useGitHub) {
      // ── Tier 2: GitHub Models ─────────────────────────────────────────────
      const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...history.map((m, i): OpenAI.ChatCompletionMessageParam => ({
          role: m.role as "user" | "assistant",
          content: i === history.length - 1
            ? (toOpenAIContent(buildLastContent(hasAttachments, savedContent, attachments, trimmedContent)) as string)
            : m.content,
        })),
      ];
      const ghClient = new OpenAI({ baseURL: "https://models.inference.ai.azure.com", apiKey: githubToken });
      try {
        const stream = await ghClient.chat.completions.create({ model: "gpt-4o", max_tokens: 8192, messages: openaiMessages, stream: true });
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) { fullResponse += delta; res.write(`data: ${JSON.stringify({ content: delta })}\n\n`); }
        }
      } catch (err: unknown) {
        if ((err as { status?: number })?.status === 429) {
          res.write(`data: ${JSON.stringify({ error: "rate-limit", done: true })}\n\n`);
          res.end(); return;
        }
        throw err;
      }

    } else {
      // ── Tier 3: Anthropic ─────────────────────────────────────────────────
      const anthropicMessages = history.map((m, i) => ({
        role: m.role as "user" | "assistant",
        content: i === history.length - 1
          ? buildLastContent(hasAttachments, savedContent, attachments, trimmedContent)
          : m.content,
      }));
      const hasPdf = hasAttachments && attachments!.some((a) => a.fileType === "document");
      const stream = anthropic!.messages.stream(
        { model: "claude-sonnet-4-6", max_tokens: 8192, system: systemPrompt, messages: anthropicMessages },
        hasPdf ? { headers: { "anthropic-beta": "pdfs-2024-09-25" } } as never : undefined
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          fullResponse += event.delta.text;
          res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
        }
      }
    }

    store.insertMessage({ conversationId, role: "assistant", content: fullResponse });
    if (history.length === 1) {
      const titleBase = trimmedContent || attachments?.[0]?.name || "File attachment";
      store.updateConversationTitle(conversationId, titleBase.slice(0, 55) + (titleBase.length > 55 ? "…" : ""));
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();

  } catch (err: unknown) {
    console.error("AI stream error:", err);
    const errMsg = String(err);
    let friendlyMsg: string;

    if (errMsg.includes("UND_ERR_HEADERS_TIMEOUT") || errMsg.includes("HeadersTimeoutError") || errMsg.includes("abort") || errMsg.includes("AbortError")) {
      friendlyMsg =
        "⏱ Timed out — phi:latest (Phi2) is too slow on your machine.\n\n" +
        "Your PC has only ~1.8 GB free RAM and no GPU.\n\n" +
        "Fix: run this in your terminal:\n" +
        "  ollama pull phi3:mini\n\n" +
        "Then select phi3:mini in the model dropdown and try again.";
    } else if (errMsg.includes("model") && errMsg.includes("not found")) {
      friendlyMsg = `Model "${ollamaModel}" not found. Run: ollama pull ${ollamaModel}`;
    } else if (errMsg.includes("ECONNREFUSED") || errMsg.includes("fetch failed")) {
      friendlyMsg = "Cannot connect to Ollama. Make sure it is running.";
    } else {
      friendlyMsg = `Error: ${errMsg}`;
    }

    if (!res.headersSent) {
      res.status(500).json({ error: friendlyMsg });
    } else {
      res.write(`data: ${JSON.stringify({ content: friendlyMsg, done: true })}\n\n`);
      res.end();
    }
  } finally {
    clearInterval(heartbeat);
  }
});

export default router;