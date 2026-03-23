import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import {
  Sparkles, Plus, LayoutList, Send, X, Trash2,
  Copy, Play, Check, Database, ChevronDown,
  MessageSquare, Loader2, AlertCircle, Table2, Zap, Mic, MicOff,
  Paperclip, FileText, FileCode, FileType, Download,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useListAnthropicConversations,
  useCreateAnthropicConversation,
  useDeleteAnthropicConversation,
  useListCollections,
  getListAnthropicConversationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

type AttachmentFile = {
  id: string; name: string; mediaType: string; fileType: "image" | "text" | "document";
  data: string; preview?: string; size: number;
};
type MessageAttachment = { name: string; fileType: "image" | "text" | "document"; preview?: string; };
type LocalMessage = { id: string; role: "user" | "assistant"; content: string; isStreaming?: boolean; attachments?: MessageAttachment[]; };
type RunResult = { messageId: string; query: string; result: { success: boolean; rows?: any[]; rowCount?: number; error?: string }; };
type PendingRun = { query: string; messageId: string; };

function parseContent(content: string): Array<{ type: "text" | "uql"; value: string }> {
  const parts: Array<{ type: "text" | "uql"; value: string }> = [];
  const regex = /```uql\n?([\s\S]*?)```/g;
  let lastIndex = 0, match;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) parts.push({ type: "text", value: content.slice(lastIndex, match.index) });
    parts.push({ type: "uql", value: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) parts.push({ type: "text", value: content.slice(lastIndex) });
  return parts;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr), now = new Date();
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d`;
  return date.toLocaleDateString();
}

function useSpeechRecognition({ onInterim, onFinal }: { onInterim: (t: string) => void; onFinal: (t: string) => void }) {
  const recognitionRef = useRef<any>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  useEffect(() => {
    setIsSupported(typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));
  }, []);
  const start = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR(); r.continuous = false; r.interimResults = true; r.lang = "en-US"; r.maxAlternatives = 1;
    r.onstart = () => setIsListening(true);
    r.onresult = (e: any) => {
      let interim = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      if (final) onFinal(final.trim()); else if (interim) onInterim(interim.trim());
    };
    r.onerror = () => setIsListening(false);
    r.onend = () => setIsListening(false);
    recognitionRef.current = r; r.start();
  }, [onInterim, onFinal]);
  const stop = useCallback(() => { recognitionRef.current?.stop(); setIsListening(false); }, []);
  return { isListening, isSupported, start, stop };
}

export interface AIAssistantHandle {
  newChat: () => void;
  toggleSessions: () => void;
}

interface AIAssistantProps {
  activeDatabaseId?: number | null;
  activeDatabaseName?: string | null;
  onInsertQuery?: (query: string) => void;
  lastResult?: any | null;
  lastQuery?: string | null;
  hideHeader?: boolean;
  onStateChange?: (s: { conversationCount: number; showSessions: boolean }) => void;
}

export const AIAssistant = forwardRef(function AIAssistantInner(
  { activeDatabaseId, activeDatabaseName, onInsertQuery, lastResult, lastQuery, hideHeader, onStateChange }: AIAssistantProps,
  ref: React.Ref<AIAssistantHandle>
) {
  const queryClient = useQueryClient();
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(null);
  const [runResults, setRunResults] = useState<RunResult[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const modelSelectorRef = useRef<HTMLDivElement>(null);

  type AuthStatus = { user: { login: string; name: string; avatar_url: string } | null; provider: "github" | "anthropic" | "local" | null; localModel: { available: boolean; model: string | null } | null; };
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [rateLimitHit, setRateLimitHit] = useState(false);

  const refreshAuth = () => {
    fetch("/api/auth/me", { credentials: "include" }).then(r => r.json()).then((d: AuthStatus) => setAuthStatus(d)).catch(() => setAuthStatus({ user: null, provider: null, localModel: null }));
  };
  useEffect(() => { refreshAuth(); }, []);

  useEffect(() => {
    fetch("/api/ai/local/models").then(r => r.json()).then((d: { available: boolean; models: string[]; defaultModel: string | null }) => {
      if (d.available && d.models.length > 0) {
        setAvailableModels(d.models);
        if (!selectedModel) setSelectedModel(d.defaultModel);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(e.target as Node)) setShowModelSelector(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const speech = useSpeechRecognition({
    onInterim: useCallback((t: string) => setInterimText(t), []),
    onFinal: useCallback((t: string) => {
      setInterimText("");
      setInputText(prev => { const p = prev.trim(); return p ? `${p} ${t}` : t; });
      setTimeout(() => { if (textareaRef.current) { textareaRef.current.style.height = "auto"; textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`; textareaRef.current.focus(); } }, 0);
    }, []),
  });

  const { data: conversations = [], refetch: refetchConversations } = useListAnthropicConversations();
  const { data: collections = [] } = useListCollections(activeDatabaseId ?? 0, { query: { enabled: !!activeDatabaseId } });
  const createConversation = useCreateAnthropicConversation();
  const deleteConversation = useDeleteAnthropicConversation();

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const autoResizeTextarea = useCallback(() => {
    if (textareaRef.current) { textareaRef.current.style.height = "auto"; textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`; }
  }, []);

  const buildSchemaContext = useCallback((): string => {
    if (!collections.length) return "";
    return collections.map(c => {
      const type = (c.type ?? "collection").toUpperCase();
      const count = (c as any).recordCount != null ? ` (${(c as any).recordCount} records)` : "";
      let line = `${type} ${c.name}${count}`;
      const schema = (c as any).schema;
      if (Array.isArray(schema) && schema.length > 0) {
        const fields = schema.map((f: any) => (typeof f === "string" ? f : f.name ?? f.field ?? String(f))).filter(Boolean);
        if (fields.length > 0) line += ` fields:[${fields.join(", ")}]`;
      }
      const indexes = (c as any).indexes;
      if (Array.isArray(indexes) && indexes.length > 0) line += ` indexes:[${indexes.join(", ")}]`;
      return line;
    }).join("\n");
  }, [collections]);

  const loadConversation = useCallback(async (id: number) => {
    setActiveConversationId(id); setShowSessions(false); setRunResults([]); setPendingRun(null);
    try {
      const res = await fetch(`/api/anthropic/conversations/${id}`);
      const data = await res.json();
      if (data.messages) setMessages(data.messages.map((m: any) => ({ id: String(m.id), role: m.role, content: m.content })));
    } catch { setMessages([]); }
  }, []);

  const handleNewChat = useCallback(async () => {
    setActiveConversationId(null); setMessages([]); setRunResults([]); setPendingRun(null); setShowSessions(false); setInputText("");
  }, []);

  useImperativeHandle(ref, () => ({
    newChat: handleNewChat,
    toggleSessions: () => setShowSessions(s => !s),
  }), [handleNewChat]);

  useEffect(() => {
    onStateChange?.({ conversationCount: conversations.length, showSessions });
  }, [conversations.length, showSessions]);

  const processFile = useCallback((file: File): Promise<AttachmentFile> => {
    return new Promise((resolve, reject) => {
      const MAX = 10 * 1024 * 1024;
      if (file.size > MAX) { reject(new Error(`"${file.name}" too large (max 10 MB)`)); return; }
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const reader = new FileReader();
      if (file.type.startsWith("image/")) {
        reader.onload = () => { const d = reader.result as string; resolve({ id, name: file.name, mediaType: file.type, fileType: "image", data: d.split(",")[1], preview: d, size: file.size }); };
        reader.onerror = reject; reader.readAsDataURL(file);
      } else if (file.type === "application/pdf") {
        reader.onload = () => { const d = reader.result as string; resolve({ id, name: file.name, mediaType: "application/pdf", fileType: "document", data: d.split(",")[1], size: file.size }); };
        reader.onerror = reject; reader.readAsDataURL(file);
      } else {
        reader.onload = () => { resolve({ id, name: file.name, mediaType: file.type || "text/plain", fileType: "text", data: reader.result as string, size: file.size }); };
        reader.onerror = reject; reader.readAsText(file);
      }
    });
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []); e.target.value = "";
    if (!files.length) return; setAttachError(null);
    const results: AttachmentFile[] = [];
    for (const f of files) { try { results.push(await processFile(f)); } catch (err: any) { setAttachError(err.message ?? "Failed to read file"); } }
    if (results.length) setAttachments(prev => [...prev, ...results]);
  }, [processFile]);

  const removeAttachment = useCallback((id: string) => setAttachments(prev => prev.filter(a => a.id !== id)), []);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (isStreaming) return;
    setInputText("");
    const sentAttachments = [...attachments];
    setAttachments([]); setAttachError(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    let convId = activeConversationId;
    if (!convId) {
      try {
        const titleBase = trimmed || sentAttachments[0]?.name || "File attachment";
        const newConv = await createConversation.mutateAsync({ data: { title: titleBase.slice(0, 55) + (titleBase.length > 55 ? "…" : "") } });
        convId = newConv.id; setActiveConversationId(convId); await refetchConversations();
      } catch { return; }
    }

    const userMsgId = `user-${Date.now()}`, asstMsgId = `asst-${Date.now()}`;
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: "user", content: trimmed, attachments: sentAttachments.map(a => ({ name: a.name, fileType: a.fileType, preview: a.preview })) },
      { id: asstMsgId, role: "assistant", content: "", isStreaming: true },
    ]);
    setIsStreaming(true);
    abortRef.current = new AbortController();

    try {
      const res = await fetch(`/api/anthropic/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: trimmed || undefined,
          databaseName: activeDatabaseName ?? undefined,
          schema: buildSchemaContext() || undefined,
          lastQuery: lastQuery?.trim() || undefined,
          lastResult: lastResult ?? undefined,
          selectedModel: selectedModel ?? undefined,
          attachments: sentAttachments.length > 0 ? sentAttachments.map(a => ({ name: a.name, mediaType: a.mediaType, fileType: a.fileType, data: a.data })) : undefined,
        }),
        signal: abortRef.current.signal,
        credentials: "include",
      });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 401) throw new Error("no-provider");
        throw new Error((errData as any).message || (errData as any).error || "Failed to connect to AI");
      }

      const reader = res.body.getReader(), decoder = new TextDecoder();
      let buffer = "", fullContent = "", streamAborted = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error === "rate-limit") { setRateLimitHit(true); streamAborted = true; break; }
            if (data.content) { fullContent += data.content; const c = fullContent; setMessages(prev => prev.map(m => m.id === asstMsgId ? { ...m, content: c } : m)); }
            if (data.done || data.error) break;
          } catch {}
        }
        if (streamAborted) break;
      }
      if (streamAborted) {
        setMessages(prev => prev.map(m => m.id === asstMsgId ? { ...m, content: "Rate limit reached. Use a local Ollama model or sign in with a GitHub Pro/Education account.", isStreaming: false } : m));
        setIsStreaming(false); return;
      }
      setMessages(prev => prev.map(m => m.id === asstMsgId ? { ...m, isStreaming: false } : m));
      queryClient.invalidateQueries({ queryKey: getListAnthropicConversationsQueryKey() });
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setMessages(prev => prev.map(m => m.id === asstMsgId ? { ...m, content: "Sorry, I encountered an error. Please try again.", isStreaming: false } : m));
      }
    } finally { setIsStreaming(false); abortRef.current = null; }
  }, [activeConversationId, isStreaming, activeDatabaseName, buildSchemaContext, createConversation, refetchConversations, queryClient, attachments, lastQuery, lastResult, selectedModel]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(inputText); }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 1500);
  };

  const handleRunQuery = useCallback(async (query: string, msgId: string) => { setPendingRun({ query, messageId: msgId }); }, []);

  const confirmRun = useCallback(async () => {
    if (!pendingRun) return;
    const { query, messageId } = pendingRun; setPendingRun(null); setIsRunning(true);
    try {
      const res = await fetch("/api/queries/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, databaseId: activeDatabaseId ?? undefined }) });
      const data = await res.json();
      const result: RunResult = { messageId, query, result: { success: data.success, rows: data.rows, rowCount: data.rowCount, error: data.error } };
      setRunResults(prev => { const idx = prev.findIndex(r => r.messageId === messageId && r.query === query); if (idx >= 0) { const n = [...prev]; n[idx] = result; return n; } return [...prev, result]; });
    } catch (err) { setRunResults(prev => [...prev, { messageId, query, result: { success: false, error: String(err) } }]); }
    finally { setIsRunning(false); }
  }, [pendingRun, activeDatabaseId]);

  const handleDeleteConversation = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation(); await deleteConversation.mutateAsync({ id });
    if (activeConversationId === id) handleNewChat();
    await refetchConversations();
  };

  const isEmpty = messages.length === 0;

  return (
    <div
      className="flex flex-col h-full overflow-hidden relative"
      style={{ background: '#0d0d0d', borderLeft: '1px solid #2e2e2e' }}
    >
      {/* Header — hidden when rendered in parent strip */}
      {!hideHeader && <div
        className="flex items-center justify-between px-3 py-2 shrink-0 border-b"
        style={{ background: '#1a1a1a', borderColor: '#2e2e2e' }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 flex items-center justify-center"
            style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 3 }}
          >
            <Sparkles className="w-3 h-3" style={{ color: '#888' }} />
          </div>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#888', fontWeight: 600 }}>
            UQL Copilot
          </span>
          <span
            className="px-1"
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: '#444', background: '#141414', border: '1px solid #2a2a2a', borderRadius: 2 }}
          >
            AI
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <AiBtn onClick={() => setShowSessions(s => !s)} active={showSessions} title="Sessions">
            <LayoutList className="w-3 h-3" />
            {conversations.length > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full flex items-center justify-center"
                style={{ background: '#3a3a3a', fontSize: 8, color: '#aaa', fontFamily: "'IBM Plex Mono', monospace" }}
              >
                {conversations.length > 9 ? "9+" : conversations.length}
              </span>
            )}
          </AiBtn>
          <AiBtn onClick={handleNewChat} title="New Chat">
            <Plus className="w-3 h-3" />
          </AiBtn>

          {/* Model selector — shown when Ollama is available */}
          {authStatus?.localModel?.available && (
            <div ref={modelSelectorRef} className="relative ml-1 pl-1.5 border-l" style={{ borderColor: '#2a2a2a' }}>
              <button
                onClick={() => setShowModelSelector(s => !s)}
                title="Select Ollama model"
                className="flex items-center gap-1 px-1.5 py-0.5 transition-colors"
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: '#666', borderRadius: 2 }}
                onMouseEnter={e => (e.currentTarget.style.color = '#aaa')}
                onMouseLeave={e => (e.currentTarget.style.color = '#666')}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#555' }} />
                <span className="max-w-[55px] truncate">
                  {selectedModel?.split(":")[0] ?? authStatus.localModel.model?.split(":")[0] ?? "local"}
                </span>
                <ChevronDown className="w-2 h-2" />
              </button>
              <AnimatePresence>
                {showModelSelector && availableModels.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.1 }}
                    className="absolute right-0 top-full mt-0.5 z-50 min-w-[130px] border overflow-hidden"
                    style={{ background: '#111', borderColor: '#2a2a2a', borderRadius: 3 }}
                  >
                    <div className="px-2.5 pt-2 pb-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Ollama models
                    </div>
                    {availableModels.map(m => (
                      <button
                        key={m}
                        onClick={() => { setSelectedModel(m); setShowModelSelector(false); }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors"
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
                          color: selectedModel === m ? '#ddd' : '#666',
                          background: selectedModel === m ? '#1a1a1a' : 'transparent',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
                        onMouseLeave={e => (e.currentTarget.style.background = selectedModel === m ? '#1a1a1a' : 'transparent')}
                      >
                        {selectedModel === m ? <Check className="w-2.5 h-2.5 shrink-0" /> : <span className="w-2.5 shrink-0" />}
                        <span className="truncate">{m}</span>
                      </button>
                    ))}
                    <div className="px-2.5 pb-2 pt-1 border-t" style={{ borderColor: '#1e1e1e', marginTop: 4 }}>
                      <a href="https://ollama.com/library" target="_blank" rel="noreferrer"
                        className="flex items-center gap-1.5 transition-colors"
                        style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: '#444' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#888')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#444')}
                      >
                        <Download className="w-2.5 h-2.5" />
                        Get more models
                      </a>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* GitHub auth indicator */}
          {authStatus?.provider === "github" && authStatus.user && (
            <div className="flex items-center gap-1.5 ml-1 pl-1.5 border-l" style={{ borderColor: '#2a2a2a' }}>
              <img src={authStatus.user.avatar_url} alt={authStatus.user.name} title={`Signed in as ${authStatus.user.name}`} className="w-4 h-4 rounded-full" style={{ outline: '1px solid #333' }} />
              <button
                onClick={async () => { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); refreshAuth(); }}
                title="Sign out"
                className="transition-colors"
                style={{ color: '#444', padding: 2, borderRadius: 2 }}
                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#aaa')}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#444')}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          )}
          {authStatus?.provider === "anthropic" && (
            <div className="ml-1 pl-1.5 border-l" style={{ borderColor: '#2a2a2a', fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: '#444' }}>
              Claude
            </div>
          )}
        </div>
      </div>}

      {/* Sessions Panel */}
      <AnimatePresence>
        {showSessions && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", maxHeight: 220, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="border-b overflow-y-auto shrink-0"
            style={{ borderColor: '#2e2e2e', background: '#1a1a1a' }}
          >
            <div className="px-3 py-1.5 flex items-center justify-between sticky top-0 z-10 border-b" style={{ background: '#111', borderColor: '#1e1e1e' }}>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Sessions
              </span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#333' }}>
                {conversations.length}
              </span>
            </div>
            {conversations.length === 0 ? (
              <div className="px-3 py-4 text-center" style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#333', fontSize: 11 }}>
                no sessions yet
              </div>
            ) : (
              <div className="pb-1">
                {conversations.map(conv => (
                  <div
                    key={conv.id}
                    onClick={() => loadConversation(conv.id)}
                    className="flex items-center justify-between px-3 py-1.5 cursor-pointer group transition-colors"
                    style={{ background: activeConversationId === conv.id ? '#161616' : 'transparent' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#111')}
                    onMouseLeave={e => (e.currentTarget.style.background = activeConversationId === conv.id ? '#161616' : 'transparent')}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageSquare className="w-3 h-3 shrink-0" style={{ color: '#444' }} />
                      <span className="truncate" style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#888', fontSize: 11 }}>
                        {conv.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <span className="group-hover:hidden" style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#333', fontSize: 10 }}>
                        {formatRelativeTime(conv.createdAt)}
                      </span>
                      <button
                        onClick={e => handleDeleteConversation(conv.id, e)}
                        className="hidden group-hover:flex p-0.5 transition-colors"
                        style={{ color: '#555', borderRadius: 2 }}
                        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#c44')}
                        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#555')}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rate Limit Banner */}
      <AnimatePresence>
        {rateLimitHit && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mx-3 mt-2 border p-3 shrink-0"
            style={{ borderColor: '#3a3a1a', background: '#1a1a0a', borderRadius: 3 }}
          >
            <div className="flex items-start gap-2 mb-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#888' }} />
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#888' }}>
                GitHub Models rate limit reached. Use a local Ollama model or a GitHub Pro/Education account.
              </div>
              <button onClick={() => setRateLimitHit(false)} style={{ color: '#444', marginLeft: 'auto', borderRadius: 2 }}>
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="flex gap-2">
              <a href="https://ollama.com/library/phi4" target="_blank" rel="noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border transition-colors"
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#888', borderColor: '#333', borderRadius: 3, background: '#111' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
                onMouseLeave={e => (e.currentTarget.style.background = '#111')}
              >
                Install Phi (local)
              </a>
              <a href="/api/auth/github"
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border transition-colors"
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#888', borderColor: '#333', borderRadius: 3, background: '#111' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
                onMouseLeave={e => (e.currentTarget.style.background = '#111')}
              >
                Sign in with GitHub
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isEmpty && authStatus?.provider === null ? (
          <NoProviderScreen />
        ) : isEmpty ? (
          <WelcomeScreen activeDatabaseName={activeDatabaseName} onPromptClick={p => sendMessage(p)} />
        ) : (
          <div className="p-3 space-y-3 pb-4">
            {messages.map(msg => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onInsert={onInsertQuery}
                onRun={q => handleRunQuery(q, msg.id)}
                onCopy={handleCopy}
                copiedId={copiedId}
                runResults={runResults.filter(r => r.messageId === msg.id)}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Pending Run Banner */}
      <AnimatePresence>
        {pendingRun && (
          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 10, opacity: 0 }}
            className="mx-3 mb-2 border p-3 shrink-0"
            style={{ borderColor: '#333', background: '#111', borderRadius: 3 }}
          >
            <div className="flex items-start gap-2 mb-2">
              <Zap className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#666' }} />
              <div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#888', marginBottom: 4 }}>Run this query?</div>
                <div className="px-2 py-1.5 border" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#ccc', background: '#0a0a0a', borderColor: '#2a2a2a', borderRadius: 2 }}>
                  {pendingRun.query}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={confirmRun} disabled={isRunning}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border transition-colors disabled:opacity-40"
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#e0e0e0', background: '#222', borderColor: '#444', borderRadius: 3 }}
                onMouseEnter={e => (e.currentTarget.style.background = '#2a2a2a')}
                onMouseLeave={e => (e.currentTarget.style.background = '#222')}
              >
                {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                Yes, run it
              </button>
              <button
                onClick={() => setPendingRun(null)}
                className="px-3 py-1.5 border transition-colors"
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#666', borderColor: '#2a2a2a', borderRadius: 3 }}
                onMouseEnter={e => (e.currentTarget.style.color = '#aaa')}
                onMouseLeave={e => (e.currentTarget.style.color = '#666')}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* File Input */}
      <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.txt,.csv,.json,.md,.sql,.py,.js,.ts,.tsx,.jsx,.html,.xml,.yaml,.yml,.log,.sh,.env" className="hidden" onChange={handleFileSelect} />

      {/* Input Area */}
      <div className="border-t p-2.5 shrink-0" style={{ borderColor: '#2e2e2e', background: '#1a1a1a' }}>
        {/* Attachment chips */}
        <AnimatePresence>
          {attachments.length > 0 && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex flex-wrap gap-1.5 mb-2">
              {attachments.map(att => (
                <motion.div
                  key={att.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="flex items-center gap-1.5 pl-1.5 pr-1 py-0.5 border"
                  style={{ background: '#111', borderColor: '#2a2a2a', borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#888' }}
                >
                  {att.fileType === "image" && att.preview
                    ? <img src={att.preview} alt={att.name} className="w-3.5 h-3.5 object-cover" style={{ borderRadius: 2 }} />
                    : att.fileType === "document"
                    ? <FileType className="w-3 h-3 shrink-0" />
                    : att.name.match(/\.(js|ts|jsx|tsx|py|sql|sh)$/i)
                    ? <FileCode className="w-3 h-3 shrink-0" />
                    : <FileText className="w-3 h-3 shrink-0" />
                  }
                  <span className="max-w-[90px] truncate">{att.name}</span>
                  <button onClick={() => removeAttachment(att.id)} style={{ color: '#444', borderRadius: 2, padding: 2 }} onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#aaa')} onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#444')}>
                    <X className="w-2.5 h-2.5" />
                  </button>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error */}
        <AnimatePresence>
          {attachError && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-1.5 mb-2 px-2 py-1 border"
              style={{ background: '#1a0a0a', borderColor: '#3a1a1a', borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#c44' }}
            >
              <AlertCircle className="w-3 h-3 shrink-0" />
              {attachError}
              <button onClick={() => setAttachError(null)} className="ml-auto" style={{ color: '#844', borderRadius: 2 }}><X className="w-2.5 h-2.5" /></button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* DB label */}
        {activeDatabaseName && (
          <div className="flex items-center gap-1.5 mb-2">
            <div className="flex items-center gap-1 px-1.5 py-0.5 border" style={{ background: '#111', borderColor: '#2a2a2a', borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#555' }}>
              <Database className="w-2.5 h-2.5" />
              {activeDatabaseName}
            </div>
            {speech.isListening && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 border" style={{ background: '#1a0a0a', borderColor: '#3a1a1a', borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#c44' }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#c44' }} />
                Listening
              </div>
            )}
          </div>
        )}
        {!activeDatabaseName && speech.isListening && (
          <div className="flex items-center gap-1.5 mb-2">
            <div className="flex items-center gap-1 px-1.5 py-0.5 border" style={{ background: '#1a0a0a', borderColor: '#3a1a1a', borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#c44' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#c44' }} />
              Listening
            </div>
          </div>
        )}

        <div className="flex gap-1.5 items-end">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming}
            title="Attach file"
            className="mb-1 p-1.5 transition-colors disabled:opacity-40 shrink-0"
            style={{ color: '#444', borderRadius: 3 }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#aaa')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#444')}
          >
            <Paperclip className="w-3.5 h-3.5" />
          </button>

          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              value={speech.isListening && interimText ? interimText : inputText}
              onChange={e => { if (!speech.isListening) { setInputText(e.target.value); autoResizeTextarea(); } }}
              onKeyDown={handleKeyDown}
              placeholder={isStreaming ? "AI is responding…" : speech.isListening ? "Speak now…" : attachments.length > 0 ? "Add a message or send the file…" : "Ask me to write a query or explain UQL…"}
              disabled={isStreaming}
              readOnly={speech.isListening}
              rows={1}
              className="w-full border px-3 pr-16 py-2 outline-none resize-none leading-relaxed transition-colors disabled:opacity-60"
              style={{
                background: '#080808',
                borderColor: speech.isListening ? '#4a2a2a' : '#2a2a2a',
                color: '#c8c8c8',
                fontSize: 12,
                fontFamily: "'IBM Plex Mono', monospace",
                borderRadius: 3,
              }}
              onFocus={e => (e.currentTarget.style.borderColor = '#444')}
              onBlur={e => (e.currentTarget.style.borderColor = speech.isListening ? '#4a2a2a' : '#2a2a2a')}
            />
            <div className="absolute right-1.5 bottom-1.5 flex items-center gap-0.5">
              {speech.isSupported && (
                <button
                  onClick={() => speech.isListening ? speech.stop() : speech.start()}
                  disabled={isStreaming}
                  title={speech.isListening ? "Stop recording" : "Speak"}
                  className="p-1.5 transition-colors"
                  style={{ color: speech.isListening ? '#c44' : '#444', borderRadius: 3 }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = speech.isListening ? '#e44' : '#aaa')}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = speech.isListening ? '#c44' : '#444')}
                >
                  {speech.isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                </button>
              )}
              <button
                onClick={() => sendMessage(inputText)}
                disabled={(!inputText.trim() && attachments.length === 0) || isStreaming || speech.isListening}
                className="p-1.5 transition-colors disabled:opacity-30"
                style={{
                  background: (inputText.trim() || attachments.length > 0) && !isStreaming ? '#e0e0e0' : '#1a1a1a',
                  color: (inputText.trim() || attachments.length > 0) && !isStreaming ? '#0a0a0a' : '#444',
                  borderRadius: 3,
                }}
              >
                {isStreaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
        <div className="mt-1.5 text-center" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: '#333' }}>
          Enter to send · Shift+Enter for newline
        </div>
      </div>
    </div>
  );
});

function AiBtn({ children, onClick, active, title }: { children: React.ReactNode; onClick: () => void; active?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="relative w-6 h-6 flex items-center justify-center transition-colors"
      style={{ color: active ? '#bbb' : '#444', background: active ? '#1a1a1a' : 'transparent', borderRadius: 3 }}
      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#aaa')}
      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = active ? '#bbb' : '#444')}
    >
      {children}
    </button>
  );
}

function NoProviderScreen() {
  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex flex-col items-center justify-center flex-1 text-center">
        <div className="w-10 h-10 flex items-center justify-center mb-4 border" style={{ background: '#111', borderColor: '#222', borderRadius: 3 }}>
          <Sparkles className="w-5 h-5" style={{ color: '#444' }} />
        </div>
        <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: '#888', fontWeight: 600, marginBottom: 4 }}>
          UQL Copilot
        </h3>
        <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#444', marginBottom: 20, maxWidth: 200, lineHeight: 1.6 }}>
          Choose how to power your AI — locally or via GitHub.
        </p>

        {/* Local Phi */}
        <div className="w-full mb-3 border p-3 text-left" style={{ borderColor: '#2a2a2a', background: '#0d0d0d', borderRadius: 3 }}>
          <div className="flex items-center gap-2 mb-2">
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#888', fontWeight: 600 }}>Local Phi — offline, no login</span>
          </div>
          <div className="border p-2 mb-2 space-y-1.5" style={{ borderColor: '#1e1e1e', background: '#080808', borderRadius: 2 }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Step 1 — Install Ollama</div>
            <div className="grid grid-cols-3 gap-1">
              {[["🪟 Win", "https://ollama.com/download/windows"], ["🍎 Mac", "https://ollama.com/download/mac"], ["🐧 Linux", "https://ollama.com/download/linux"]].map(([label, url]) => (
                <a key={url} href={url} target="_blank" rel="noreferrer"
                  className="flex items-center justify-center py-1 border transition-colors"
                  style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#666', borderColor: '#2a2a2a', borderRadius: 2, background: '#111' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#aaa')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#666')}
                >
                  {label}
                </a>
              ))}
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>Step 2 — Pull a model</div>
            <div className="space-y-0.5">
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#666' }}>
                <span style={{ color: '#555' }}>$ </span>ollama pull phi4 <span style={{ color: '#333' }}># 9 GB</span>
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#666' }}>
                <span style={{ color: '#555' }}>$ </span>ollama pull phi3:mini <span style={{ color: '#333' }}># 2 GB</span>
              </div>
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#333', marginTop: 2 }}>
              Step 3 — Refresh this page
            </div>
          </div>
          <a href="https://ollama.com" target="_blank" rel="noreferrer"
            className="w-full flex items-center justify-center gap-2 py-2 border transition-colors"
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#888', borderColor: '#2a2a2a', borderRadius: 3, background: '#111' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
            onMouseLeave={e => (e.currentTarget.style.background = '#111')}
          >
            <Download className="w-3.5 h-3.5" />
            Download Ollama
          </a>
        </div>

        <div className="flex items-center w-full gap-2 mb-3">
          <div className="flex-1 h-px" style={{ background: '#1e1e1e' }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#333' }}>or</span>
          <div className="flex-1 h-px" style={{ background: '#1e1e1e' }} />
        </div>

        <a href="/api/auth/github"
          className="w-full flex items-center justify-center gap-2 py-2 border transition-colors"
          style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: '#e0e0e0', background: '#e0e0e0', borderColor: '#e0e0e0', borderRadius: 3 }}
          onMouseEnter={e => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.borderColor = '#ffffff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#e0e0e0'; e.currentTarget.style.borderColor = '#e0e0e0'; }}
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" style={{ fill: "#0a0a0a" }}>
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
          <span style={{ color: '#0a0a0a' }}>Continue with GitHub</span>
        </a>
        <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#333', marginTop: 8 }}>
          Free via GitHub Models — Education &amp; Pro plans
        </p>
      </div>
    </div>
  );
}

function WelcomeScreen({ activeDatabaseName, onPromptClick }: { activeDatabaseName?: string | null; onPromptClick: (p: string) => void }) {
  const prompts = activeDatabaseName
    ? [`Show me all collections in ${activeDatabaseName}`, `Create a sample table in ${activeDatabaseName}`, `Write a query to find records in ${activeDatabaseName}`, "Explain UQL syntax with examples"]
    : ["How do I create a new database?", "Write a query to insert sample data", "Explain TABLE vs GRAPH vs DOCUMENT", "Show me how to do a graph traversal"];

  return (
    <div className="flex flex-col items-center justify-center h-full p-4">
      <div className="w-10 h-10 flex items-center justify-center mb-4 border" style={{ background: '#111', borderColor: '#222', borderRadius: 3 }}>
        <Sparkles className="w-5 h-5" style={{ color: '#555' }} />
      </div>
      <h3 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: '#888', fontWeight: 600, marginBottom: 4 }}>UQL Copilot</h3>
      <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#444', marginBottom: 20, lineHeight: 1.6, textAlign: 'center', maxWidth: 200 }}>
        Ask me to write queries, explain UQL syntax, or help design your schema.
      </p>
      <div className="w-full space-y-1.5">
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Try asking</div>
        {prompts.map(prompt => (
          <button
            key={prompt}
            onClick={() => onPromptClick(prompt)}
            className="w-full text-left px-3 py-2 border transition-colors flex items-center gap-2"
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#666', background: '#0d0d0d', borderColor: '#1e1e1e', borderRadius: 3 }}
            onMouseEnter={e => { e.currentTarget.style.background = '#111'; e.currentTarget.style.color = '#aaa'; e.currentTarget.style.borderColor = '#2a2a2a'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#0d0d0d'; e.currentTarget.style.color = '#666'; e.currentTarget.style.borderColor = '#1e1e1e'; }}
          >
            <span style={{ color: '#333' }}>›</span>
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message, onInsert, onRun, onCopy, copiedId, runResults }: {
  message: LocalMessage; onInsert?: (q: string) => void; onRun?: (q: string) => void;
  onCopy: (text: string, id: string) => void; copiedId: string | null; runResults: RunResult[];
}) {
  const isUser = message.role === "user";
  const parts = isUser ? [] : parseContent(message.content);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[92%] space-y-1.5">
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-end">
              {message.attachments.map((att, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2 py-0.5 border"
                  style={{ background: '#111', borderColor: '#2a2a2a', borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#666' }}
                >
                  {att.fileType === "image" && att.preview
                    ? <img src={att.preview} alt={att.name} className="w-4 h-4 object-cover" style={{ borderRadius: 2 }} />
                    : att.fileType === "document"
                    ? <FileType className="w-3 h-3 shrink-0" />
                    : <FileText className="w-3 h-3 shrink-0" />
                  }
                  <span className="max-w-[100px] truncate">{att.name}</span>
                </div>
              ))}
            </div>
          )}
          {message.content && (
            <div className="px-3 py-2 border"
              style={{ background: '#1a1a1a', borderColor: '#333', borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: '#c8c8c8', lineHeight: 1.6 }}
            >
              {message.content}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <div className="w-5 h-5 flex items-center justify-center shrink-0 mt-0.5 border" style={{ background: '#111', borderColor: '#2a2a2a', borderRadius: 2 }}>
        <Sparkles className="w-3 h-3" style={{ color: '#555' }} />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {message.isStreaming && message.content === "" ? (
          <div className="flex items-center gap-1 py-1">
            <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#444', animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#444', animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#444', animationDelay: '300ms' }} />
          </div>
        ) : (
          <>
            {parts.map((part, i) => {
              if (part.type === "text") {
                return (
                  <div key={i} className="whitespace-pre-wrap"
                    style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: '#888', lineHeight: 1.7 }}
                  >
                    {part.value}
                  </div>
                );
              }
              const copyKey = `${message.id}-uql-${i}`;
              const existingResult = runResults.find(r => r.query === part.value);
              return (
                <div key={i} className="border overflow-hidden" style={{ borderColor: '#2a2a2a', borderRadius: 3 }}>
                  <div className="flex items-center justify-between px-3 py-1 border-b" style={{ background: '#111', borderColor: '#1e1e1e' }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>UQL</span>
                    <div className="flex items-center gap-0.5">
                      <CodeBtn onClick={() => onInsert?.(part.value)} title="Insert into editor">
                        <Table2 className="w-2.5 h-2.5" />
                        <span>Insert</span>
                      </CodeBtn>
                      <CodeBtn onClick={() => onRun?.(part.value)} title="Run query">
                        <Play className="w-2.5 h-2.5" />
                        <span>Run</span>
                      </CodeBtn>
                      <button
                        onClick={() => onCopy(part.value, copyKey)}
                        className="p-1 transition-colors"
                        style={{ color: copiedId === copyKey ? '#8a8' : '#444', borderRadius: 2 }}
                        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#aaa')}
                        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = copiedId === copyKey ? '#8a8' : '#444')}
                      >
                        {copiedId === copyKey ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="px-3 py-2.5" style={{ background: '#060606', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: '#c8c8c8', lineHeight: 1.6 }}>
                    {part.value}
                  </div>
                  {existingResult && <InlineResult result={existingResult.result} />}
                </div>
              );
            })}
            {message.isStreaming && (
              <span className="inline-block w-0.5 h-3 animate-pulse rounded-sm ml-0.5" style={{ background: '#666' }} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CodeBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1 px-2 py-0.5 transition-colors"
      style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#555', borderRadius: 2 }}
      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#aaa')}
      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#555')}
    >
      {children}
    </button>
  );
}

function InlineResult({ result }: { result: { success: boolean; rows?: any[]; rowCount?: number; error?: string } }) {
  if (!result.success) {
    return (
      <div className="px-3 py-2 flex items-start gap-1.5 border-t" style={{ borderColor: '#2a1a1a', background: '#120808' }}>
        <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" style={{ color: '#c44' }} />
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#c44', lineHeight: 1.5 }}>{result.error ?? "Query failed"}</span>
      </div>
    );
  }
  const rows = result.rows ?? [], rowCount = result.rowCount ?? rows.length;
  return (
    <div className="border-t" style={{ borderColor: '#1a2a1a', background: '#080f08' }}>
      <div className="px-3 py-1 flex items-center gap-1.5 border-b" style={{ borderColor: '#1a2a1a' }}>
        <Check className="w-3 h-3" style={{ color: '#5a8' }} />
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#5a8' }}>{rowCount} row{rowCount !== 1 ? "s" : ""} affected</span>
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto max-h-[100px] overflow-y-auto">
          <table className="w-full border-collapse" style={{ fontSize: 10 }}>
            <thead style={{ background: '#0a0a0a' }}>
              <tr>
                {Object.keys(rows[0]).map(k => (
                  <th key={k} className="px-2 py-0.5 text-left border-b whitespace-nowrap"
                    style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#555', borderColor: '#1e1e1e', fontWeight: 500 }}
                  >{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 5).map((row, i) => (
                <tr key={i} className="border-b" style={{ borderColor: '#111' }}>
                  {Object.values(row).map((v: any, j) => (
                    <td key={j} className="px-2 py-0.5 whitespace-nowrap max-w-[80px] overflow-hidden text-ellipsis"
                      style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#888' }}
                    >
                      {typeof v === "object" ? JSON.stringify(v) : String(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 5 && (
            <div className="px-2 py-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#444' }}>
              + {rows.length - 5} more rows
            </div>
          )}
        </div>
      )}
    </div>
  );
}
