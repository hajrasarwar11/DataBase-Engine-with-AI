import { Router, type IRouter } from "express";
import { store } from "../../store.js";
import OpenAI from "openai";

// Anthropic is only available when the Replit integration is provisioned
let anthropic: ReturnType<typeof import("@workspace/integrations-anthropic-ai")["anthropic"]> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  anthropic = require("@workspace/integrations-anthropic-ai").anthropic;
} catch {
  // Not available locally
}

const router: IRouter = Router();

// ── Ollama local model helpers ────────────────────────────────────────────────

const OLLAMA_BASE = "http://localhost:11434";
const PHI_CANDIDATES = ["phi:latest", "phi4", "phi3.5", "phi3:mini", "phi3", "phi"];

interface OllamaModel { name: string }

async function getOllamaStatus(): Promise<{ available: boolean; model: string | null; models: string[] }> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { available: false, model: null, models: [] };
    const data = (await res.json()) as { models: OllamaModel[] };
    const modelNames = (data.models ?? []).map((m) => m.name);
    // Always prefer phi:latest if available
    const phiLatest = modelNames.find((n) => n === "phi:latest");
    const pick = phiLatest ?? PHI_CANDIDATES.find((c) => modelNames.some((n) => n.startsWith(c)));
    const anyModel = pick ?? (data.models[0]?.name ?? null);
    return { available: !!anyModel, model: anyModel, models: modelNames };
  } catch {
    return { available: false, model: null, models: [] };
  }
}

async function streamOllama(
  model: string,
  messages: Array<{ role: string; content: string }>,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buf = "";

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
        if (chunk) {
          full += chunk;
          onChunk(chunk);
        }
      } catch { /* skip malformed lines */ }
    }
  }
  return full;
}

// ── System prompts ─────────────────────────────────────────────────────────────

// Full prompt for cloud models (Claude, GPT-4o)
const SYSTEM_PROMPT = `You are UQL Copilot — an expert AI assistant embedded in UQL Studio, a multi-model database IDE. Your job is to fully help the user no matter what they ask. You analyze files, generate complete queries, explain concepts, and troubleshoot problems.

## UQL Syntax Reference
\`\`\`
CREATE DB <name>
CREATE TABLE|GRAPH|DOCUMENT <name> [IN <db>]
ADD [TABLE|GRAPH|DOCUMENT] <name> VALUES { key: value, ... } [IN <db>]
FIND [TABLE|GRAPH|DOCUMENT] <name> [WHERE field op val] [LIMIT n] [IN <db>]
MODIFY [TABLE|GRAPH|DOCUMENT] <name> SET field=val WHERE ... [IN <db>]
REMOVE [TABLE|GRAPH|DOCUMENT] <name> WHERE ... [IN <db>]
DROP TABLE|GRAPH|DOCUMENT <name> [IN <db>]
FIND PATH FROM node(id) TO node(id)
WHERE operators: = != > >= < <=  AND to combine
\`\`\`
Type qualifier (TABLE/GRAPH/DOCUMENT) is optional unless multiple collections share the same name.

## Code Blocks
Wrap every UQL query in a fenced block — the UI shows "Insert into Editor" and "Run" buttons on each block:
\`\`\`uql
YOUR_QUERY_HERE
\`\`\`
Put each query in its **own separate block** so the user can run them one by one.

## Core Behaviour Rules

### 1. ALWAYS answer — never refuse or say "I can't help"
If you are unsure about something, make a reasonable assumption, state it clearly, and proceed.

### 2. Working with file attachments (CSV, text, JSON, images, PDFs)
When the user attaches a file and asks you to do something with it:
- **Read the entire file** and understand its structure fully before responding.
- **CSV / spreadsheet data**: identify columns, data types, and row count. Generate CREATE TABLE and ADD queries for every row.
- **JSON data**: map keys to collection fields; generate ADD queries.
- **SQL files**: convert each query to its UQL equivalent.

### 3. Schema awareness
- Use the active database and schema provided in the context.
- Never invent collection or field names that aren't in the schema or the user's file.

### 4. Completeness
- Generate the **full** set of queries needed — don't abbreviate.`;

// Shorter prompt for local Phi models (they struggle with very long system prompts)
const PHI_SYSTEM_PROMPT = `You are UQL Copilot, an expert assistant for UQL Studio. Always answer user questions simply and directly. 
If the user asks how to do something in the UI, give clear, step-by-step instructions (e.g., 'Go to the Databases tab, click New Database, enter a name, and click Create').
If there is a query method, show the query in a code block and ask if the user wants to run it.
Be concise, avoid irrelevant information, and never invent logic puzzles or unrelated content.
`;

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
  try {
    const status = await getOllamaStatus();
    res.json(status);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

router.get("/ai/local/models", async (_req, res) => {
  try {
    const status = await getOllamaStatus();
    res.json({ available: status.available, models: status.models, defaultModel: status.model });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ── Message streaming ─────────────────────────────────────────────────────────

type AttachmentPayload = {
  name: string;
  mediaType: string;
  fileType: "image" | "text" | "document";
  data: string;
};

router.post("/anthropic/conversations/:id/messages", async (req, res) => {
  const conversationId = Number(req.params.id);
  const {
    content,
    databaseName,
    schema: schemaCtx,
    attachments,
    lastQuery,
    lastResult,
    selectedModel,
  }: {
    content?: string;
    databaseName?: string;
    schema?: string;
    attachments?: AttachmentPayload[];
    lastQuery?: string;
    lastResult?: unknown;
    selectedModel?: string;
  } = req.body;

  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  const trimmedContent = content?.trim() ?? "";

  if (!trimmedContent && !hasAttachments) {
    res.status(400).json({ error: "Content or attachments are required" });
    return;
  }

  const conversation = store.getConversation(conversationId);
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const attachmentSummary = hasAttachments
    ? ` [Attached: ${attachments!.map((a) => a.name).join(", ")}]`
    : "";
  const savedContent = (trimmedContent || "(file attachment)") + attachmentSummary;
  store.insertMessage({ conversationId, role: "user", content: savedContent });

  const history = store.listMessages(conversationId);

  // ── Determine provider priority ───────────────────────────────────────────
  const githubToken: string | undefined =
    (req as unknown as { session?: { github_token?: string } }).session?.github_token;

  const ollamaStatus = await getOllamaStatus();
  const useLocal  = ollamaStatus.available && !!ollamaStatus.model;
  const useGitHub = !useLocal && !!githubToken;
  const useAnthropic = !useLocal && !useGitHub && !!anthropic;

  if (!useLocal && !useGitHub && !useAnthropic) {
    res.status(401).json({
      error: "no-provider",
      message:
        "No AI available. Install Ollama with Phi for local AI (no login needed), " +
        "or sign in with GitHub to use GitHub Models for free.",
    });
    return;
  }

  // Use shorter prompt for local models (Phi struggles with long prompts)
  let systemPrompt = useLocal ? PHI_SYSTEM_PROMPT : SYSTEM_PROMPT;

  // Append database / schema context
  if (databaseName || schemaCtx) {
    systemPrompt += "\n\n## Database Context:\n";
    if (databaseName) systemPrompt += `Active DB: ${databaseName}\n`;
    if (schemaCtx) systemPrompt += `Schema:\n${schemaCtx}`;
  }

  // Append last query result context
  if (lastQuery || lastResult) {
    systemPrompt += "\n\n## Last Query Result:\n";
    if (lastQuery) systemPrompt += `Query: \`${lastQuery.trim()}\`\n`;
    if (lastResult !== undefined && lastResult !== null) {
      try {
        const resultStr = JSON.stringify(lastResult, null, 2);
        // Limit result size to avoid overwhelming local models
        const maxLen = useLocal ? 800 : 3000;
        systemPrompt += `Result:\n${resultStr.length > maxLen ? resultStr.slice(0, maxLen) + "\n...(truncated)" : resultStr}\n`;
      } catch { /* ignore serialization errors */ }
    }
  }

  if (hasAttachments) {
    systemPrompt +=
      "\n\n## File Attachments:\nThe user has attached one or more files. " +
      "Carefully read each file's content. If any file contains UQL queries, " +
      "present them in ```uql code blocks so the user can run them.";
  }

  // Resolve which Ollama model to use — always use the first available phi model if selectedModel is not set or not found
  let ollamaModel = ollamaStatus.model!;
  if (useLocal) {
    // Always use phi:latest if available
    if (ollamaStatus.models.includes("phi:latest")) {
      ollamaModel = "phi:latest";
    } else if (selectedModel && ollamaStatus.models.includes(selectedModel)) {
      ollamaModel = selectedModel;
    } else if (ollamaStatus.models.length > 0) {
      // Prefer a phi model if available
      const phiModel = ollamaStatus.models.find(m => m.toLowerCase().startsWith('phi'));
      if (phiModel) ollamaModel = phiModel;
    }
  }

  // ── SSE setup ─────────────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";

  // Build content blocks for non-local providers
  type ContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    | { type: "document"; source: { type: "base64"; media_type: string; data: string } };

  const buildLastContent = (): string | ContentBlock[] => {
    if (!hasAttachments) return savedContent;
    const blocks: ContentBlock[] = [];
    for (const att of attachments!) {
      if (att.fileType === "image") {
        blocks.push({ type: "image", source: { type: "base64", media_type: att.mediaType, data: att.data } });
      } else if (att.fileType === "document") {
        blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: att.data } });
      } else {
        blocks.push({ type: "text", text: `[Attached file: ${att.name}]\n\`\`\`\n${att.data}\n\`\`\`` });
      }
    }
    blocks.push({
      type: "text",
      text: trimmedContent || "Please read this file carefully and help me with its contents.",
    });
    return blocks;
  };

  try {
    if (useLocal) {
      // ── Tier 1: Local Ollama ──────────────────────────────────────────────
      const ollamaMessages = [
        { role: "system", content: systemPrompt },
        ...history.map((m, i) => ({
          role: m.role as "user" | "assistant",
          content: i === history.length - 1 && hasAttachments
            ? `${trimmedContent}\n\n${attachments!
                .filter((a) => a.fileType === "text")
                .map((a) => `[File: ${a.name}]\n${a.data}`)
                .join("\n\n")}`
            : m.content,
        })),
      ];

      fullResponse = await streamOllama(
        ollamaModel,
        ollamaMessages,
        (chunk) => {
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        }
      );

    } else if (useGitHub) {
      // ── Tier 2: GitHub Models ─────────────────────────────────────────────
      const toOpenAIContent = (
        raw: ReturnType<typeof buildLastContent>
      ): OpenAI.ChatCompletionContentPart[] | string => {
        if (typeof raw === "string") return raw;
        return raw.map((block): OpenAI.ChatCompletionContentPart => {
          if (block.type === "text") return { type: "text", text: block.text };
          if (block.type === "image") {
            return {
              type: "image_url",
              image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
            };
          }
          return { type: "text", text: "[PDF attachment — paste text content for best results]" };
        });
      };

      const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...history.map((m, i): OpenAI.ChatCompletionMessageParam => ({
          role: m.role as "user" | "assistant",
          content: i === history.length - 1
            ? (toOpenAIContent(buildLastContent()) as string)
            : m.content,
        })),
      ];

      const ghClient = new OpenAI({
        baseURL: "https://models.inference.ai.azure.com",
        apiKey: githubToken,
      });

      try {
        const stream = await ghClient.chat.completions.create({
          model: "gpt-4o",
          max_tokens: 8192,
          messages: openaiMessages,
          stream: true,
        });

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) {
            fullResponse += delta;
            res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
          }
        }
      } catch (err: unknown) {
        const statusCode = (err as { status?: number })?.status ?? 0;
        if (statusCode === 429) {
          res.write(`data: ${JSON.stringify({ error: "rate-limit", done: true })}\n\n`);
          res.end();
          return;
        }
        throw err;
      }

    } else {
      // ── Tier 3: Anthropic (Replit integration) ────────────────────────────
      const anthropicMessages = history.map((m, i) => ({
        role: m.role as "user" | "assistant",
        content: i === history.length - 1 ? buildLastContent() : m.content,
      }));

      const hasPdf = hasAttachments && attachments!.some((a) => a.fileType === "document");
      const streamOptions = hasPdf
        ? { headers: { "anthropic-beta": "pdfs-2024-09-25" } }
        : undefined;

      const stream = anthropic!.messages.stream(
        {
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          system: systemPrompt,
          messages: anthropicMessages,
        },
        streamOptions as never
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
      const titleBase = trimmedContent || attachments![0]?.name || "File attachment";
      store.updateConversationTitle(conversationId, titleBase.slice(0, 55) + (titleBase.length > 55 ? "…" : ""));
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();

  } catch (err: unknown) {
    console.error("AI stream error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: String(err) });
    } else {
      res.write(`data: ${JSON.stringify({ error: String(err), done: true })}\n\n`);
      res.end();
    }
  }
});

export default router;
