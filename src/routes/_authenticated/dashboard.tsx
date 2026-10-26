import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  LibraryBig,
  Paperclip,
  Trash2,
  X,
} from "lucide-react";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { StudySidebar } from "@/components/study-sidebar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  attachDocumentsToSession,
  createDocument,
  detachDocumentFromSession,
  indexDocument,
  listDocuments,
} from "@/lib/documents.functions";

import {
  ACCEPTED_UPLOAD_ACCEPT,
  fileExtension,
  isAcceptedUpload,
  newFileId,
  uploadContentType,
} from "@/lib/uploads";
import {
  createSession,
  getProfile,
  listMessages,
  sendMessage,
  type ChatMessage,
} from "@/lib/study.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  validateSearch: (search: Record<string, unknown>): { c?: string } =>
    typeof search["c"] === "string" ? { c: search["c"] } : {},
  head: () => ({
    meta: [
      { title: "Study chat — Study Hub" },
      {
        name: "description",
        content: "Ask questions, attach PDFs and study from your personal library.",
      },
      { property: "og:title", content: "Study chat — Study Hub" },
      {
        property: "og:description",
        content: "A focused study conversation grounded in your documents.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

type UploadState = { name: string; status: "reading" | "ready" | "error" };

function AttachedFiles({
  onFileAdded,
  uploadState,
}: {
  onFileAdded: (id: string, file: File) => void;
  uploadState: Record<string, UploadState>;
}) {
  const attachments = usePromptInputAttachments();
  const started = useRef(new Set<string>());

  useEffect(() => {
    for (const item of attachments.files) {
      if (started.current.has(item.id) || !item.url) continue;
      started.current.add(item.id);
      void fetch(item.url)
        .then((response) => response.blob())
        .then((blob) =>
          onFileAdded(
            item.id,
            new File([blob], item.filename ?? "document", { type: item.mediaType }),
          ),
        )
        .catch(() => toast.error("Could not read that attachment"));
    }
  }, [attachments.files, onFileAdded]);

  if (attachments.files.length === 0) return null;

  return (
    <PromptInputHeader className="gap-2 border-b border-line pb-2">
      {attachments.files.map((item) => {
        const state = uploadState[item.id];
        return (
          <div
            key={item.id}
            className="flex max-w-full items-center gap-2 rounded-lg bg-clay-soft px-2.5 py-1.5 text-xs text-ink"
          >
            <FileText className="size-3.5 shrink-0" />
            <span className="max-w-48 truncate">{item.filename}</span>
            <span className="font-mono text-[10px] text-muted">
              {state?.status === "ready"
                ? "Ready"
                : state?.status === "error"
                  ? "Failed"
                  : "Reading…"}
            </span>
            <button
              type="button"
              onClick={() => attachments.remove(item.id)}
              className="grid size-5 place-items-center rounded-md text-muted transition hover:bg-paper/70 hover:text-ink"
              aria-label={`Remove ${item.filename ?? "attachment"}`}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </PromptInputHeader>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();
  const fetchProfile = useServerFn(getProfile);
  const fetchMessages = useServerFn(listMessages);
  const fetchDocuments = useServerFn(listDocuments);
  const ask = useServerFn(sendMessage);
  const addDocument = useServerFn(createDocument);
  const detachDocument = useServerFn(detachDocumentFromSession);
  const attachDocuments = useServerFn(attachDocumentsToSession);
  const startSession = useServerFn(createSession);
  const runIndexing = useServerFn(indexDocument);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const uploadTasks = useRef(new Set<Promise<void>>());
  const [uploadState, setUploadState] = useState<Record<string, UploadState>>({});
  const [showMaterials, setShowMaterials] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const { c: sessionId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const messagesKey = ["messages", sessionId ?? "new"] as const;
  const sessionRef = useRef<string | null>(sessionId ?? null);
  useEffect(() => {
    sessionRef.current = sessionId ?? null;
  }, [sessionId]);

  const profile = useQuery({ queryKey: ["profile"], queryFn: () => fetchProfile({}) });
  const messages = useQuery({
    queryKey: messagesKey,
    queryFn: () => fetchMessages({ data: { sessionId: sessionId ?? null } }),
  });
  const documents = useQuery({
    queryKey: ["documents", sessionId ?? "new"],
    queryFn: () =>
      sessionId ? fetchDocuments({ data: { sessionId } }) : Promise.resolve([] as never[]),
  });
  const library = useQuery({
    queryKey: ["documents", "library"],
    queryFn: () => fetchDocuments({ data: {} }),
    enabled: libraryOpen,
  });

  /** Makes sure this conversation exists so attached materials can belong to it. */
  const ensureSession = useCallback(async () => {
    if (sessionRef.current) return sessionRef.current;
    const created = await startSession({});
    sessionRef.current = created.id;
    await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    await navigate({ to: "/dashboard", search: { c: created.id }, replace: true });
    return created.id;
  }, [navigate, queryClient, startSession]);

  const dropMutation = useMutation({
    mutationFn: async (id: string) => {
      const chatId = sessionRef.current ?? sessionId;
      if (!chatId) return;
      await detachDocument({ data: { sessionId: chatId, documentId: id } });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Removed from this chat — still in your library");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const attachMutation = useMutation({
    mutationFn: async (documentIds: string[]) => {
      const chatId = await ensureSession();
      await attachDocuments({ data: { sessionId: chatId, documentIds } });
    },
    onSuccess: async (_result, documentIds) => {
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      setLibraryOpen(false);
      setPicked([]);
      setLibrarySearch("");
      toast.success(
        `${documentIds.length} ${documentIds.length === 1 ? "file" : "files"} added to this chat`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const askMutation = useMutation({
    mutationFn: (content: string) =>
      ask({ data: { content, sessionId: sessionRef.current ?? sessionId ?? null } }),
    onMutate: async (content) => {
      await queryClient.cancelQueries({ queryKey: messagesKey });
      queryClient.setQueryData<ChatMessage[]>(messagesKey, (current = []) => [
        ...current,
        {
          id: `pending-${Date.now()}`,
          role: "user",
          content,
          created_at: new Date().toISOString(),
        },
      ]);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      if (!sessionId && result.sessionId) {
        queryClient.setQueryData(
          ["messages", result.sessionId],
          queryClient.getQueryData(messagesKey),
        );
        await navigate({ to: "/dashboard", search: { c: result.sessionId }, replace: true });
        await queryClient.invalidateQueries({ queryKey: ["messages", result.sessionId] });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: messagesKey });
    },
    onError: (error: Error) => {
      void queryClient.invalidateQueries({ queryKey: messagesKey });
      toast.error(error.message);
    },
    onSettled: () => textareaRef.current?.focus(),
  });

  useEffect(() => textareaRef.current?.focus(), []);

  const uploadAttachment = useCallback(
    (id: string, file: File) => {
      setUploadState((current) => ({ ...current, [id]: { name: file.name, status: "reading" } }));
      const task = (async () => {
        try {
          const { data } = await supabase.auth.getUser();
          const userId = data.user?.id;
          if (!userId) throw new Error("Please sign in again");
          if (!isAcceptedUpload(file.name)) {
            throw new Error("Attach a PDF, Word or PowerPoint file.");
          }
          const chatId = await ensureSession();
          const path = `${userId}/${newFileId()}.${fileExtension(file.name)}`;
          const { error } = await supabase.storage
            .from("materials")
            .upload(path, file, { contentType: uploadContentType(file.name) });
          if (error) throw error;
          const document = await addDocument({
            data: { filename: file.name, filePath: path, subject: "General", sessionId: chatId },
          });
          const result = await runIndexing({ data: { documentId: document.id } });
          await queryClient.invalidateQueries({ queryKey: ["documents"] });
          if (result.chunks === 0) {
            setUploadState((current) => ({
              ...current,
              [id]: { name: file.name, status: "error" },
            }));
            toast.error(result.note ?? "No readable text found in this file.");
            return;
          }
          setUploadState((current) => ({ ...current, [id]: { name: file.name, status: "ready" } }));
          toast.success(`${file.name} is ready to study.`);
        } catch (error) {
          setUploadState((current) => ({ ...current, [id]: { name: file.name, status: "error" } }));
          toast.error(error instanceof Error ? error.message : "Could not add this document");
          throw error;
        }
      })();
      uploadTasks.current.add(task);
      void task.finally(() => uploadTasks.current.delete(task));
    },
    [addDocument, ensureSession, queryClient, runIndexing],
  );

  async function submit(message: PromptInputMessage) {
    if (uploadTasks.current.size > 0) await Promise.allSettled([...uploadTasks.current]);
    const names = message.files.map((file) => file.filename).filter(Boolean);
    const content =
      message.text.trim() ||
      (names.length > 0 ? `Summarise the key ideas in ${names.join(", ")}.` : "");
    if (!content || askMutation.isPending) return;
    askMutation.mutate(content);
  }

  const name = profile.data?.display_name ?? "Student";
  const rows = messages.data ?? [];
  const attachedIds = new Set((documents.data ?? []).map((doc) => doc.id));
  const term = librarySearch.trim().toLowerCase();
  const libraryRows = (library.data ?? []).filter(
    (doc) =>
      !attachedIds.has(doc.id) &&
      (term === "" ||
        doc.filename.toLowerCase().includes(term) ||
        doc.subject.toLowerCase().includes(term)),
  );

  return (
    <section className="mx-auto flex h-dvh max-w-[1440px] flex-col overflow-hidden lg:flex-row">
      <StudySidebar active="chat" activeSessionId={sessionId ?? null} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface/35">
        <header className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4 sm:px-8">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted">
              Study companion
            </p>
            <h1 className="font-display text-2xl font-medium">Good to see you, {name}</h1>
          </div>
          <button
            type="button"
            onClick={() => setShowMaterials((open) => !open)}
            className="flex items-center gap-2 rounded-lg border border-line bg-paper/70 px-3 py-1.5 text-xs text-muted transition hover:text-ink"
            aria-expanded={showMaterials}
          >
            {showMaterials ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            <span className="size-2 rounded-full bg-sage" />
            {documents.data?.length ?? 0} materials in this chat
          </button>
        </header>

        {showMaterials ? (
          <div className="shrink-0 border-b border-line bg-paper/60 px-5 py-3 sm:px-8">
            <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2">
              {(documents.data ?? []).length === 0 ? (
                <p className="text-xs text-muted">
                  No materials here yet — attach a PDF, Word or PowerPoint file below and this chat
                  will study from it.
                </p>
              ) : (
                (documents.data ?? []).map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-2 rounded-lg border border-line bg-clay-soft px-2.5 py-1.5 text-xs text-ink"
                  >
                    <FileText className="size-3.5 shrink-0" />
                    {doc.signed_url ? (
                      <a
                        href={doc.signed_url}
                        download={doc.filename}
                        rel="noreferrer"
                        className="max-w-56 truncate hover:underline"
                      >
                        {doc.filename}
                      </a>
                    ) : (
                      <span className="max-w-56 truncate">{doc.filename}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => dropMutation.mutate(doc.id)}
                      disabled={dropMutation.isPending}
                      className="grid size-5 place-items-center rounded-md text-muted transition hover:bg-paper/70 hover:text-ink"
                      aria-label={`Remove ${doc.filename}`}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))
              )}
              <button
                type="button"
                onClick={() => setLibraryOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-ink hover:text-ink"
              >
                <LibraryBig className="size-3.5" />
                Add from library
              </button>
            </div>
          </div>
        ) : null}

        <Conversation className="min-h-0">
          <ConversationContent className="mx-auto w-full max-w-4xl gap-6 px-5 py-8 sm:px-8">
            {rows.length === 0 ? (
              <ConversationEmptyState
                className="min-h-[50vh]"
                title="Start with what you’re learning"
                description="Ask a question or attach a PDF, Word or PowerPoint file to study from."
              >
                <div className="grid size-14 place-items-center rounded-lg bg-ink text-paper">
                  <span className="font-display text-xl font-semibold">S</span>
                </div>
                <div className="space-y-1">
                  <h2 className="font-display text-2xl font-medium">What are we studying today?</h2>
                  <p className="text-sm text-muted">
                    Ask a question or attach a PDF, Word or PowerPoint file to study from.
                  </p>
                </div>
              </ConversationEmptyState>
            ) : (
              rows.map((message) => (
                <Message
                  key={message.id}
                  from={message.role}
                  className="max-w-[88%] sm:max-w-[78%]"
                >
                  <MessageContent
                    className={message.role === "user" ? "bg-ink text-paper" : "text-ink"}
                  >
                    <MessageResponse>{message.content}</MessageResponse>
                  </MessageContent>
                </Message>
              ))
            )}
            {askMutation.isPending ? (
              <Shimmer className="text-sm text-muted">Thinking through your materials…</Shimmer>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton aria-label="Scroll to latest message" />
        </Conversation>

        <div className="shrink-0 border-t border-line bg-paper/85 px-4 pb-5 pt-4 sm:px-8">
          <div className="mx-auto max-w-4xl">
            <PromptInput
              accept={ACCEPTED_UPLOAD_ACCEPT}
              maxFiles={3}
              maxFileSize={20 * 1024 * 1024}
              onError={(error) => toast.error(error.message)}
              onSubmit={submit}
              className="card-shadow-lg"
            >
              <AttachedFiles onFileAdded={uploadAttachment} uploadState={uploadState} />
              <PromptInputTextarea
                ref={textareaRef}
                placeholder="Ask about your notes, concepts, or attached PDF…"
                className="min-h-20 text-sm"
              />
              <PromptInputFooter>
                <PromptInputTools>
                  <PromptInputButton
                    tooltip="Attach PDF"
                    onClick={() =>
                      document
                        .querySelector<HTMLInputElement>('input[aria-label="Upload files"]')
                        ?.click()
                    }
                  >
                    <Paperclip />
                  </PromptInputButton>
                  <PromptInputButton
                    tooltip="Add from library"
                    onClick={() => setLibraryOpen(true)}
                  >
                    <LibraryBig />
                  </PromptInputButton>
                  <span className="text-xs text-muted">PDF, Word, PowerPoint · 20 MB max</span>
                </PromptInputTools>
                <PromptInputSubmit disabled={askMutation.isPending} />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </main>

      <Dialog
        open={libraryOpen}
        onOpenChange={(open) => {
          setLibraryOpen(open);
          if (!open) {
            setPicked([]);
            setLibrarySearch("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add from library</DialogTitle>
            <DialogDescription>
              Pick files you have already uploaded to study from them in this chat.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={librarySearch}
            onChange={(event) => setLibrarySearch(event.target.value)}
            placeholder="Search by name or category…"
          />
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {library.isLoading ? (
              <p className="py-6 text-center text-sm text-muted">Loading your library…</p>
            ) : libraryRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                Nothing left to add — upload a file below to build your library.
              </p>
            ) : (
              libraryRows.map((doc) => {
                const checked = picked.includes(doc.id);
                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() =>
                      setPicked((current) =>
                        checked ? current.filter((id) => id !== doc.id) : [...current, doc.id],
                      )
                    }
                    aria-pressed={checked}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition ${
                      checked
                        ? "border-ink bg-clay-soft text-ink"
                        : "border-line text-ink hover:bg-surface/60"
                    }`}
                  >
                    <FileText className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate">{doc.filename}</span>
                    <span className="shrink-0 rounded-md bg-surface px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">
                      {doc.subject}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <DialogFooter>
            <button
              type="button"
              disabled={picked.length === 0 || attachMutation.isPending}
              onClick={() => attachMutation.mutate(picked)}
              className="rounded-lg bg-ink px-4 py-2 text-sm text-paper transition disabled:opacity-50"
            >
              {attachMutation.isPending
                ? "Adding…"
                : `Attach${picked.length > 0 ? ` (${picked.length})` : ""} to chat`}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
