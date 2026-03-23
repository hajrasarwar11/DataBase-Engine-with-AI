import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Sparkles, Plus, LayoutList, Settings, Send, X, Trash2,
  Copy, Play, Check, Database, Clock, ChevronRight,
  MessageSquare, Loader2, AlertCircle, Table2, Zap, Mic, MicOff,
  Paperclip, FileText, FileCode, Image as ImageIcon, FileType,
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
  id: string;
  name: string;
  mediaType: string;
  fileType: "image" | "text" | "document";
  data: string;
  preview?: string;
  size: number;
};

type MessageAttachment = {
  name: string;
  fileType: "image" | "text" | "document";
  preview?: string;
};

type LocalMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  attachments?: MessageAttachment[];
};

type RunResult = {
  messageId: string;
  query: string;
  result: { success: boolean; rows?: any[]; rowCount?: number; error?: string };
};

type PendingRun = {
  query: string;
  messageId: string;
};

function parseContent(
  content: string
): Array<{ type: "text" | "uql"; value: string }> {
  const parts: Array<{ type: "text" | "uql"; value: string }> = [];
  const regex = /```uql\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: content.slice(lastIndex, match.index) });
    }
    parts.push({ type: "uql", value: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push({ type: "text", value: content.slice(lastIndex) });
  }
  return parts;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function useSpeechRecognition({
  onInterim,
  onFinal,
}: {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
}) {
  const recognitionRef = useRef<any>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported(
      typeof window !== "undefined" &&
        !!(
          (window as any).SpeechRecognition ||
          (window as any).webkitSpeechRecognition
        )
    );
  }, []);

  const start = useCallback(() => {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      if (final) {
        onFinal(final.trim());
      } else if (interim) {
        onInterim(interim.trim());
      }
    };

    recognition.onerror = (e: any) => {
      console.warn("Speech recognition error:", e.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [onInterim, onFinal]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  return { isListening, isSupported, start, stop };
}

interface AIAssistantProps {
  activeDatabaseId?: number | null;
  activeDatabaseName?: string | null;
  onInsertQuery?: (query: string) => void;
}

export function AIAssistant({
  activeDatabaseId,
  activeDatabaseName,
  onInsertQuery,
}: AIAssistantProps) {
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

  type AuthStatus = {
    user: { login: string; name: string; avatar_url: string } | null;
    provider: "github" | "anthropic" | "local" | null;
    localModel: { available: boolean; model: string | null } | null;
  };
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [rateLimitHit, setRateLimitHit] = useState(false);

  const refreshAuth = () => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((data: AuthStatus) => setAuthStatus(data))
      .catch(() => setAuthStatus({ user: null, provider: null, localModel: null }));
  };

  useEffect(() => { refreshAuth(); }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const speech = useSpeechRecognition({
    onInterim: useCallback((text: string) => {
      setInterimText(text);
    }, []),
    onFinal: useCallback((text: string) => {
      setInterimText("");
      setInputText((prev) => {
        const trimmed = prev.trim();
        return trimmed ? `${trimmed} ${text}` : text;
      });
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
          textareaRef.current.focus();
        }
      }, 0);
    }, []),
  });

  const { data: conversations = [], refetch: refetchConversations } =
    useListAnthropicConversations();

  const { data: collections = [] } = useListCollections(activeDatabaseId ?? 0, {
    query: { enabled: !!activeDatabaseId },
  });

  const createConversation = useCreateAnthropicConversation();
  const deleteConversation = useDeleteAnthropicConversation();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const autoResizeTextarea = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, []);

  const buildSchemaContext = useCallback((): string => {
    if (!collections.length) return "";
    const grouped = collections.reduce(
      (acc, c) => {
        const k = c.type;
        if (!acc[k]) acc[k] = [];
        acc[k].push(c.name);
        return acc;
      },
      {} as Record<string, string[]>
    );
    return Object.entries(grouped)
      .map(([type, names]) => `${type.toUpperCase()}S: ${names.join(", ")}`)
      .join("\n");
  }, [collections]);

  const loadConversation = useCallback(async (id: number) => {
    setActiveConversationId(id);
    setShowSessions(false);
    setRunResults([]);
    setPendingRun(null);
    try {
      const res = await fetch(`/api/anthropic/conversations/${id}`);
      const data = await res.json();
      if (data.messages) {
        setMessages(
          data.messages.map((m: any) => ({
            id: String(m.id),
            role: m.role,
            content: m.content,
          }))
        );
      }
    } catch {
      setMessages([]);
    }
  }, []);

  const handleNewChat = useCallback(async () => {
    setActiveConversationId(null);
    setMessages([]);
    setRunResults([]);
    setPendingRun(null);
    setShowSessions(false);
    setInputText("");
  }, []);

  const processFile = useCallback((file: File): Promise<AttachmentFile> => {
    return new Promise((resolve, reject) => {
      const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
      if (file.size > MAX_SIZE) {
        reject(new Error(`"${file.name}" is too large (max 10 MB)`));
        return;
      }
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const reader = new FileReader();

      if (file.type.startsWith("image/")) {
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1];
          resolve({ id, name: file.name, mediaType: file.type, fileType: "image", data: base64, preview: dataUrl, size: file.size });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      } else if (file.type === "application/pdf") {
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1];
          resolve({ id, name: file.name, mediaType: "application/pdf", fileType: "document", data: base64, size: file.size });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      } else {
        reader.onload = () => {
          resolve({ id, name: file.name, mediaType: file.type || "text/plain", fileType: "text", data: reader.result as string, size: file.size });
        };
        reader.onerror = reject;
        reader.readAsText(file);
      }
    });
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (!files.length) return;
      setAttachError(null);
      const results: AttachmentFile[] = [];
      for (const f of files) {
        try {
          const att = await processFile(f);
          results.push(att);
        } catch (err: any) {
          setAttachError(err.message ?? "Failed to read file");
        }
      }
      if (results.length) {
        setAttachments((prev) => [...prev, ...results]);
      }
    },
    [processFile]
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed && attachments.length === 0) return;
      if (isStreaming) return;

      setInputText("");
      const sentAttachments = [...attachments];
      setAttachments([]);
      setAttachError(null);
      if (textareaRef.current) textareaRef.current.style.height = "auto";

      let convId = activeConversationId;

      if (!convId) {
        try {
          const titleBase = trimmed || sentAttachments[0]?.name || "File attachment";
          const newConv = await createConversation.mutateAsync({
            data: { title: titleBase.slice(0, 55) + (titleBase.length > 55 ? "…" : "") },
          });
          convId = newConv.id;
          setActiveConversationId(convId);
          await refetchConversations();
        } catch {
          return;
        }
      }

      const userMsgId = `user-${Date.now()}`;
      const asstMsgId = `asst-${Date.now()}`;

      setMessages((prev) => [
        ...prev,
        {
          id: userMsgId,
          role: "user",
          content: trimmed,
          attachments: sentAttachments.map((a) => ({
            name: a.name,
            fileType: a.fileType,
            preview: a.preview,
          })),
        },
        { id: asstMsgId, role: "assistant", content: "", isStreaming: true },
      ]);
      setIsStreaming(true);

      abortRef.current = new AbortController();

      try {
        const res = await fetch(
          `/api/anthropic/conversations/${convId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: trimmed || undefined,
              databaseName: activeDatabaseName ?? undefined,
              schema: buildSchemaContext() || undefined,
              attachments:
                sentAttachments.length > 0
                  ? sentAttachments.map((a) => ({
                      name: a.name,
                      mediaType: a.mediaType,
                      fileType: a.fileType,
                      data: a.data,
                    }))
                  : undefined,
            }),
            signal: abortRef.current.signal,
            credentials: "include",
          }
        );

        if (!res.ok || !res.body) {
          const errData = await res.json().catch(() => ({}));
          if (res.status === 401) {
            throw new Error("no-provider");
          }
          throw new Error((errData as any).message || (errData as any).error || "Failed to connect to AI");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullContent = "";
        let streamAborted = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error === "rate-limit") {
                setRateLimitHit(true);
                streamAborted = true;
                break;
              }
              if (data.content) {
                fullContent += data.content;
                const captured = fullContent;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === asstMsgId ? { ...m, content: captured } : m
                  )
                );
              }
              if (data.done || data.error) break;
            } catch {}
          }
          if (streamAborted) break;
        }

        if (streamAborted) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstMsgId
                ? { ...m, content: "⚠️ GitHub Models rate limit reached. See the banner above to upgrade or switch to a local model.", isStreaming: false }
                : m
            )
          );
          setIsStreaming(false);
          return;
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === asstMsgId ? { ...m, isStreaming: false } : m
          )
        );
        queryClient.invalidateQueries({
          queryKey: getListAnthropicConversationsQueryKey(),
        });
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstMsgId
                ? {
                    ...m,
                    content:
                      "Sorry, I encountered an error. Please try again.",
                    isStreaming: false,
                  }
                : m
            )
          );
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [
      activeConversationId,
      isStreaming,
      activeDatabaseName,
      buildSchemaContext,
      createConversation,
      refetchConversations,
      queryClient,
      attachments,
    ]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputText);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleRunQuery = useCallback(
    async (query: string, msgId: string) => {
      setPendingRun({ query, messageId: msgId });
    },
    []
  );

  const confirmRun = useCallback(async () => {
    if (!pendingRun) return;
    const { query, messageId } = pendingRun;
    setPendingRun(null);
    setIsRunning(true);
    try {
      const res = await fetch("/api/queries/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          databaseId: activeDatabaseId ?? undefined,
        }),
      });
      const data = await res.json();
      const result: RunResult = {
        messageId,
        query,
        result: {
          success: data.success,
          rows: data.rows,
          rowCount: data.rowCount,
          error: data.error,
        },
      };
      setRunResults((prev) => {
        const existing = prev.findIndex(
          (r) => r.messageId === messageId && r.query === query
        );
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = result;
          return next;
        }
        return [...prev, result];
      });
    } catch (err) {
      setRunResults((prev) => [
        ...prev,
        {
          messageId,
          query,
          result: { success: false, error: String(err) },
        },
      ]);
    } finally {
      setIsRunning(false);
    }
  }, [pendingRun, activeDatabaseId]);

  const handleDeleteConversation = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteConversation.mutateAsync({ id });
    if (activeConversationId === id) {
      handleNewChat();
    }
    await refetchConversations();
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full bg-panel-bg border-l border-panel-border relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-foreground/[0.08] bg-gradient-to-r from-panel-bg via-purple-950/20 to-panel-bg shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
            <Sparkles className="w-3 h-3 text-white" />
          </div>
          <span className="text-sm font-semibold text-foreground tracking-tight">
            UQL Copilot
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-purple-500/40 text-purple-400 bg-purple-500/10 font-medium tracking-wide">
            AI
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSessions((s) => !s)}
            className={cn(
              "relative p-1.5 rounded-md transition-all text-muted-foreground/60 hover:text-foreground/80 hover:bg-foreground/5",
              showSessions && "bg-foreground/10 text-foreground/80"
            )}
            title="Sessions"
          >
            <LayoutList className="w-3.5 h-3.5" />
            {conversations.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-purple-500 text-[9px] text-white flex items-center justify-center font-bold">
                {conversations.length > 9 ? "9+" : conversations.length}
              </span>
            )}
          </button>
          <button
            onClick={handleNewChat}
            className="p-1.5 rounded-md transition-all text-muted-foreground/60 hover:text-foreground/80 hover:bg-foreground/5"
            title="New Chat"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          {/* Local model badge */}
          {authStatus?.localModel?.available && (
            <div
              title={`Local AI: ${authStatus.localModel.model} via Ollama — no login required`}
              className="flex items-center gap-1 ml-1 pl-1.5 border-l border-foreground/[0.12]"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[9px] text-green-400/80 font-mono">
                {authStatus.localModel.model?.split(":")[0] ?? "local"}
              </span>
            </div>
          )}
          {/* GitHub auth indicator */}
          {authStatus?.provider === "github" && authStatus.user && (
            <div className="flex items-center gap-1.5 ml-1 pl-1.5 border-l border-foreground/[0.12]">
              <img
                src={authStatus.user.avatar_url}
                alt={authStatus.user.name}
                title={`Signed in as ${authStatus.user.name} · GitHub Models`}
                className="w-5 h-5 rounded-full ring-1 ring-green-500/40"
              />
              <button
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                  refreshAuth();
                }}
                title="Sign out of GitHub"
                className="p-0.5 rounded text-muted-foreground/40 hover:text-foreground/80 hover:bg-foreground/5 transition-all"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          {authStatus?.provider === "anthropic" && (
            <div
              title="Powered by Anthropic (Replit integration)"
              className="ml-1 pl-1.5 border-l border-foreground/[0.12] text-[9px] text-purple-400/60 font-mono"
            >
              Claude
            </div>
          )}
        </div>
      </div>

      {/* Sessions Sidebar */}
      <AnimatePresence>
        {showSessions && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", maxHeight: 240, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-b border-foreground/[0.08] bg-foreground/[0.04] overflow-y-auto shrink-0"
          >
            <div className="px-3 py-2 flex items-center justify-between sticky top-0 bg-foreground/[0.08] backdrop-blur z-10">
              <span className="text-[10px] uppercase font-semibold text-muted-foreground/60 tracking-widest">
                Sessions
              </span>
              <span className="text-[10px] text-muted-foreground/40">
                {conversations.length} chats
              </span>
            </div>
            {conversations.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground/40">
                No sessions yet
              </div>
            ) : (
              <div className="pb-1">
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => loadConversation(conv.id)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 text-left group transition-all hover:bg-foreground/5 cursor-pointer",
                      activeConversationId === conv.id && "bg-foreground/5"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageSquare className="w-3 h-3 shrink-0 text-purple-400/70" />
                      <span className="text-xs text-foreground/80 truncate">
                        {conv.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <span className="text-[10px] text-muted-foreground/40 group-hover:hidden">
                        {formatRelativeTime(conv.createdAt)}
                      </span>
                      <button
                        onClick={(e) => handleDeleteConversation(conv.id, e)}
                        className="hidden group-hover:flex p-0.5 rounded text-muted-foreground/40 hover:text-red-400 transition-colors"
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

      {/* Rate limit banner */}
      <AnimatePresence>
        {rateLimitHit && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mx-3 mt-2 rounded-xl border border-amber-500/30 bg-amber-500/8 p-3 shrink-0"
          >
            <div className="flex items-start gap-2 mb-2.5">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-amber-300 mb-0.5">GitHub Models rate limit reached</div>
                <div className="text-[11px] text-amber-400/70 leading-relaxed">
                  Free tier exhausted. Sign in with a GitHub Education or Pro account to get more quota, or use a local Phi model via Ollama (no limits).
                </div>
              </div>
              <button onClick={() => setRateLimitHit(false)} className="ml-auto shrink-0 p-0.5 rounded text-muted-foreground/40 hover:text-foreground/60">
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="flex gap-2">
              <a
                href="https://ollama.com/library/phi4"
                target="_blank"
                rel="noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-green-500/15 hover:bg-green-500/25 border border-green-500/30 text-green-300 text-[11px] font-medium transition-all"
              >
                Install Phi (local)
              </a>
              <a
                href="/api/auth/github"
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-foreground/10 hover:bg-foreground/15 border border-foreground/20 text-foreground/70 text-[11px] font-medium transition-all"
              >
                Sign in with GitHub
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto min-h-0 scroll-smooth">
        {isEmpty && authStatus?.provider === null ? (
          /* No AI provider available — show both options */
          <div className="flex flex-col h-full">
            <div className="flex flex-col items-center justify-center flex-1 px-5 text-center">
              <motion.div
                animate={{
                  boxShadow: [
                    "0 0 20px rgba(168,85,247,0.10)",
                    "0 0 40px rgba(168,85,247,0.22)",
                    "0 0 20px rgba(168,85,247,0.10)",
                  ],
                }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500/15 to-violet-600/15 border border-purple-500/25 flex items-center justify-center mb-5 backdrop-blur-sm"
              >
                <Sparkles className="w-6 h-6 text-purple-400" />
              </motion.div>

              <h3 className="text-[14px] font-semibold text-foreground tracking-tight mb-1">
                UQL Copilot
              </h3>
              <p className="text-[12px] text-muted-foreground/60 leading-relaxed max-w-[210px] mb-5">
                Choose how to power your AI — locally or via GitHub.
              </p>

              {/* Option 1: Local Phi */}
              <div className="w-full mb-3 rounded-xl border border-green-500/20 bg-green-500/5 p-3 text-left">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-5 h-5 rounded-md bg-green-500/15 border border-green-500/25 flex items-center justify-center text-[10px]">⚡</span>
                  <span className="text-[12px] font-semibold text-green-300">Local Phi — no login</span>
                </div>
                <p className="text-[11px] text-muted-foreground/55 leading-relaxed mb-2.5">
                  Run Microsoft Phi on your machine via Ollama. Private, fast, no API key, no limits.
                </p>
                <div className="rounded-lg bg-background/60 border border-foreground/[0.08] px-3 py-2 mb-2.5 font-mono text-[10px] text-muted-foreground/60 space-y-0.5">
                  <div># 1. Install Ollama from ollama.com</div>
                  <div><span className="text-green-400">ollama pull phi4</span></div>
                  <div className="text-muted-foreground/40"># Then restart UQL Studio</div>
                </div>
                <a
                  href="https://ollama.com"
                  target="_blank"
                  rel="noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-green-500/15 hover:bg-green-500/25 border border-green-500/25 text-green-300 text-[12px] font-semibold transition-all active:scale-[0.98]"
                >
                  Get Ollama →
                </a>
              </div>

              <div className="flex items-center w-full gap-2 mb-3">
                <div className="flex-1 h-px bg-foreground/[0.08]" />
                <span className="text-[10px] text-muted-foreground/35 uppercase tracking-widest">or</span>
                <div className="flex-1 h-px bg-foreground/[0.08]" />
              </div>

              {/* Option 2: GitHub Models */}
              <a
                href="/api/auth/github"
                className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-xl bg-foreground text-background text-[13px] font-semibold hover:bg-foreground/90 active:scale-[0.98] transition-all shadow-lg shadow-black/30 mb-2"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" style={{ fill: "hsl(224 40% 5%)" }}>
                  <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                </svg>
                Continue with GitHub
              </a>
              <p className="text-[10px] text-muted-foreground/35 leading-relaxed max-w-[200px]">
                Free via GitHub Models — Education &amp; Pro plans included
              </p>
            </div>
          </div>
        ) : isEmpty ? (
          <WelcomeScreen
            activeDatabaseName={activeDatabaseName}
            onPromptClick={(p) => sendMessage(p)}
          />
        ) : (
          <div className="p-3 space-y-4 pb-4">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onInsert={onInsertQuery}
                onRun={(q) => handleRunQuery(q, msg.id)}
                onCopy={handleCopy}
                copiedId={copiedId}
                runResults={runResults.filter((r) => r.messageId === msg.id)}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Permission Banner */}
      <AnimatePresence>
        {pendingRun && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="mx-3 mb-2 rounded-xl border border-amber-500/30 bg-amber-500/10 backdrop-blur p-3 shrink-0"
          >
            <div className="flex items-start gap-2 mb-2">
              <Zap className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-amber-300 mb-1">
                  Run this query?
                </div>
                <div className="text-[11px] font-mono text-amber-600 dark:text-amber-200/80 bg-foreground/[0.04] rounded-md px-2 py-1.5 break-all leading-relaxed">
                  {pendingRun.query}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={confirmRun}
                disabled={isRunning}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-medium transition-all disabled:opacity-50"
              >
                {isRunning ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
                Yes, run it
              </button>
              <button
                onClick={() => setPendingRun(null)}
                className="px-3 py-1.5 rounded-lg border border-foreground/[0.12] text-muted-foreground text-xs hover:border-foreground/20 hover:text-foreground/80 transition-all"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.txt,.csv,.json,.md,.sql,.py,.js,.ts,.tsx,.jsx,.html,.xml,.yaml,.yml,.log,.sh,.env"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Input Area */}
      <div className="border-t border-foreground/[0.08] bg-foreground/[0.03] p-3 shrink-0">
        {/* Attachment chips */}
        <AnimatePresence>
          {attachments.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex flex-wrap gap-1.5 mb-2"
            >
              {attachments.map((att) => (
                <motion.div
                  key={att.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex items-center gap-1.5 pl-1.5 pr-1 py-1 rounded-lg bg-foreground/5 border border-foreground/[0.12] text-[10px] text-foreground/80 group"
                >
                  {att.fileType === "image" && att.preview ? (
                    <img
                      src={att.preview}
                      alt={att.name}
                      className="w-4 h-4 rounded object-cover"
                    />
                  ) : att.fileType === "document" ? (
                    <FileType className="w-3 h-3 text-red-400 shrink-0" />
                  ) : att.name.match(/\.(js|ts|jsx|tsx|py|sql|sh)$/i) ? (
                    <FileCode className="w-3 h-3 text-yellow-400 shrink-0" />
                  ) : (
                    <FileText className="w-3 h-3 text-blue-400 shrink-0" />
                  )}
                  <span className="max-w-[100px] truncate">{att.name}</span>
                  <span className="text-muted-foreground/40">
                    {att.size < 1024
                      ? `${att.size}B`
                      : att.size < 1024 * 1024
                      ? `${(att.size / 1024).toFixed(0)}KB`
                      : `${(att.size / 1024 / 1024).toFixed(1)}MB`}
                  </span>
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="ml-0.5 p-0.5 rounded hover:bg-foreground/10 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        {/* Attachment error */}
        <AnimatePresence>
          {attachError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-[10px] text-red-400"
            >
              <AlertCircle className="w-3 h-3 shrink-0" />
              {attachError}
              <button onClick={() => setAttachError(null)} className="ml-auto">
                <X className="w-2.5 h-2.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {activeDatabaseName && (
          <div className="flex items-center gap-1.5 mb-2">
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[10px] text-cyan-400">
              <Database className="w-2.5 h-2.5" />
              {activeDatabaseName}
            </div>
            {speech.isListening && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-[10px] text-red-400"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                Listening…
              </motion.div>
            )}
          </div>
        )}
        {!activeDatabaseName && speech.isListening && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-1.5 mb-2"
          >
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-[10px] text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              Listening…
            </div>
          </motion.div>
        )}
        <div className="flex gap-1.5 items-end">
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming}
            title="Attach file (image, PDF, text, code…)"
            className="mb-1.5 p-2 rounded-lg text-muted-foreground/60 hover:text-foreground/80 hover:bg-foreground/10 transition-all disabled:opacity-40 shrink-0"
          >
            <Paperclip className="w-3.5 h-3.5" />
          </button>

          {/* Textarea + right buttons */}
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              value={speech.isListening && interimText ? interimText : inputText}
              onChange={(e) => {
                if (!speech.isListening) {
                  setInputText(e.target.value);
                  autoResizeTextarea();
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                isStreaming
                  ? "AI is responding..."
                  : speech.isListening
                  ? "Speak now…"
                  : attachments.length > 0
                  ? "Add a message or just send the file…"
                  : "Ask me to write a query, explain UQL, or analyze your schema…"
              }
              disabled={isStreaming}
              readOnly={speech.isListening}
              rows={1}
              className={cn(
                "w-full bg-background/80 border rounded-xl pl-4 pr-20 py-3 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none resize-none transition-all leading-relaxed disabled:opacity-60",
                speech.isListening
                  ? "border-red-500/40 ring-1 ring-red-500/20 placeholder:text-red-400/60"
                  : attachments.length > 0
                  ? "border-purple-500/30 ring-1 ring-purple-500/10"
                  : "border-foreground/[0.12] focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20"
              )}
            />
            <div className="absolute right-2 bottom-2 flex items-center gap-1">
              {speech.isSupported && (
                <button
                  onClick={() => (speech.isListening ? speech.stop() : speech.start())}
                  disabled={isStreaming}
                  title={speech.isListening ? "Stop recording" : "Speak your message"}
                  className={cn(
                    "p-2 rounded-lg transition-all",
                    speech.isListening
                      ? "bg-red-500/20 text-red-400 hover:bg-red-500/30 ring-1 ring-red-500/30"
                      : "text-muted-foreground/60 hover:text-foreground/80 hover:bg-foreground/10"
                  )}
                >
                  {speech.isListening ? (
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    >
                      <MicOff className="w-3.5 h-3.5" />
                    </motion.div>
                  ) : (
                    <Mic className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
              <button
                onClick={() => sendMessage(inputText)}
                disabled={
                  (!inputText.trim() && attachments.length === 0) ||
                  isStreaming ||
                  speech.isListening
                }
                className={cn(
                  "p-2 rounded-lg transition-all",
                  (inputText.trim() || attachments.length > 0) &&
                    !isStreaming &&
                    !speech.isListening
                    ? "bg-gradient-to-br from-purple-500 to-violet-600 text-white shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 hover:scale-105"
                    : "bg-foreground/5 text-muted-foreground/40 cursor-not-allowed"
                )}
              >
                {isStreaming ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>
        <div className="mt-1.5 text-[10px] text-muted-foreground/50 text-center">
          {speech.isListening
            ? "Speak now — click mic again to stop"
            : speech.isSupported
            ? "Attach · Enter to send · Shift+Enter for newline · mic to speak"
            : "Attach files · Enter to send · Shift+Enter for newline"}
        </div>
      </div>

      {/* Background glow */}
      <div className="absolute bottom-0 right-0 w-48 h-48 bg-purple-600/5 blur-[80px] rounded-full pointer-events-none" />
    </div>
  );
}

function WelcomeScreen({
  activeDatabaseName,
  onPromptClick,
}: {
  activeDatabaseName?: string | null;
  onPromptClick: (p: string) => void;
}) {
  const prompts = activeDatabaseName
    ? [
        `Show me all collections in ${activeDatabaseName}`,
        `Create a sample table in ${activeDatabaseName}`,
        `Write a query to find records in ${activeDatabaseName}`,
        "Explain UQL syntax with examples",
      ]
    : [
        "How do I create a new database?",
        "Write a query to insert sample data",
        "Explain the difference between TABLE, GRAPH, and DOCUMENT",
        "Show me how to do a graph traversal",
      ];

  return (
    <div className="flex flex-col items-center justify-center h-full p-5 text-center">
      <motion.div
        animate={{
          boxShadow: [
            "0 0 20px rgba(168,85,247,0.15)",
            "0 0 50px rgba(168,85,247,0.3)",
            "0 0 20px rgba(168,85,247,0.15)",
          ],
        }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-violet-600/20 border border-purple-500/30 mb-5 flex items-center justify-center backdrop-blur-md"
      >
        <Sparkles className="w-7 h-7 text-purple-400" />
      </motion.div>

      <h3 className="text-sm font-semibold text-foreground mb-1 tracking-tight">
        UQL Copilot
      </h3>
      <p className="text-xs text-muted-foreground/60 mb-5 leading-relaxed max-w-[220px]">
        Ask me to write queries, explain UQL syntax, or help design your schema.
      </p>

      <div className="w-full space-y-2">
        <div className="text-[10px] text-muted-foreground/40 uppercase font-semibold tracking-widest mb-2 text-left">
          Try asking
        </div>
        {prompts.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onPromptClick(prompt)}
            className="w-full text-left px-3 py-2.5 rounded-lg bg-foreground/[0.03] hover:bg-foreground/[0.07] border border-foreground/[0.08] hover:border-foreground/[0.12] text-xs text-muted-foreground hover:text-foreground/80 transition-all flex items-center gap-2 group"
          >
            <ChevronRight className="w-3 h-3 text-purple-500 shrink-0 group-hover:translate-x-0.5 transition-transform" />
            <span>{prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onInsert,
  onRun,
  onCopy,
  copiedId,
  runResults,
}: {
  message: LocalMessage;
  onInsert?: (q: string) => void;
  onRun?: (q: string) => void;
  onCopy: (text: string, id: string) => void;
  copiedId: string | null;
  runResults: RunResult[];
}) {
  const isUser = message.role === "user";
  const parts = isUser ? [] : parseContent(message.content);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] space-y-1.5">
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-end">
              {message.attachments.map((att, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-xl bg-foreground/5 border border-foreground/[0.12] text-[10px] text-muted-foreground"
                >
                  {att.fileType === "image" && att.preview ? (
                    <img
                      src={att.preview}
                      alt={att.name}
                      className="w-5 h-5 rounded object-cover"
                    />
                  ) : att.fileType === "document" ? (
                    <FileType className="w-3 h-3 text-red-400 shrink-0" />
                  ) : (
                    <FileText className="w-3 h-3 text-blue-400 shrink-0" />
                  )}
                  <span className="max-w-[120px] truncate">{att.name}</span>
                </div>
              ))}
            </div>
          )}
          {message.content && (
            <div className="px-3 py-2 rounded-2xl rounded-tr-md bg-gradient-to-br from-purple-600/30 to-violet-700/30 border border-purple-500/20 text-xs text-foreground leading-relaxed">
              {message.content}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shrink-0 mt-0.5 shadow-lg shadow-purple-500/20">
        <Sparkles className="w-3 h-3 text-white" />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {message.isStreaming && message.content === "" ? (
          <div className="flex items-center gap-1.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce [animation-delay:300ms]" />
          </div>
        ) : (
          <>
            {parts.map((part, i) => {
              if (part.type === "text") {
                return (
                  <div
                    key={i}
                    className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap"
                  >
                    {part.value}
                  </div>
                );
              }
              const copyKey = `${message.id}-uql-${i}`;
              const existingResult = runResults.find(
                (r) => r.query === part.value
              );
              return (
                <div key={i} className="rounded-xl overflow-hidden border border-cyan-500/20 bg-background/80">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-cyan-900/20 border-b border-cyan-500/10">
                    <span className="text-[10px] uppercase font-semibold text-cyan-500 tracking-widest">
                      UQL
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onInsert?.(part.value)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-all"
                        title="Insert into editor"
                      >
                        <Table2 className="w-2.5 h-2.5" />
                        Insert
                      </button>
                      <button
                        onClick={() => onRun?.(part.value)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-all"
                        title="Run query"
                      >
                        <Play className="w-2.5 h-2.5" />
                        Run
                      </button>
                      <button
                        onClick={() => onCopy(part.value, copyKey)}
                        className="p-1 rounded-md text-muted-foreground/60 hover:text-foreground/80 hover:bg-foreground/10 transition-all"
                        title="Copy"
                      >
                        {copiedId === copyKey ? (
                          <Check className="w-2.5 h-2.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-2.5 h-2.5" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="px-3 py-2.5 font-mono text-xs text-cyan-300 leading-relaxed">
                    {part.value}
                  </div>
                  {existingResult && (
                    <InlineResult result={existingResult.result} />
                  )}
                </div>
              );
            })}
            {message.isStreaming && (
              <span className="inline-block w-0.5 h-3 bg-purple-400 animate-pulse rounded-full ml-0.5" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function InlineResult({
  result,
}: {
  result: { success: boolean; rows?: any[]; rowCount?: number; error?: string };
}) {
  if (!result.success) {
    return (
      <div className="px-3 py-2 border-t border-red-500/20 bg-red-500/5 flex items-start gap-1.5">
        <AlertCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
        <span className="text-[11px] text-red-300 leading-relaxed">
          {result.error ?? "Query failed"}
        </span>
      </div>
    );
  }

  const rows = result.rows ?? [];
  const rowCount = result.rowCount ?? rows.length;

  return (
    <div className="border-t border-emerald-500/20 bg-emerald-500/5">
      <div className="px-3 py-1.5 flex items-center gap-1.5 border-b border-emerald-500/10">
        <Check className="w-3 h-3 text-emerald-400" />
        <span className="text-[10px] text-emerald-400 font-medium">
          {rowCount} row{rowCount !== 1 ? "s" : ""} affected
        </span>
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto max-h-[120px] overflow-y-auto">
          <table className="w-full text-[10px] border-collapse">
            <thead className="bg-foreground/[0.04]">
              <tr>
                {Object.keys(rows[0]).map((k) => (
                  <th
                    key={k}
                    className="px-2 py-1 text-left text-muted-foreground font-medium border-b border-foreground/[0.08] whitespace-nowrap"
                  >
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 5).map((row, i) => (
                <tr key={i} className="border-b border-foreground/[0.08]">
                  {Object.values(row).map((v: any, j) => (
                    <td
                      key={j}
                      className="px-2 py-1 text-foreground/80 whitespace-nowrap max-w-[80px] overflow-hidden text-ellipsis"
                    >
                      {typeof v === "object" ? JSON.stringify(v) : String(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 5 && (
            <div className="px-2 py-1 text-[10px] text-muted-foreground/40">
              + {rows.length - 5} more rows
            </div>
          )}
        </div>
      )}
    </div>
  );
}
