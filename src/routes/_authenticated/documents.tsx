import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, FileText, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { StudySidebar } from "@/components/study-sidebar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  createDocument,
  deleteDocument,
  indexDocument,
  listDocuments,
  updateDocumentSubject,
} from "@/lib/documents.functions";
import {
  ACCEPTED_UPLOAD_ACCEPT,
  fileExtension,
  isAcceptedUpload,
  newFileId,
  uploadContentType,
} from "@/lib/uploads";

export const Route = createFileRoute("/_authenticated/documents")({
  head: () => ({
    meta: [
      { title: "Documents — Study Hub" },
      {
        name: "description",
        content:
          "Search, open and manage the PDF, Word and PowerPoint files in your private study library.",
      },
      { property: "og:title", content: "Documents — Study Hub" },
      { property: "og:description", content: "Your private, searchable study library." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Documents,
});

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function Documents() {
  const queryClient = useQueryClient();
  const fetchDocuments = useServerFn(listDocuments);
  const addDocument = useServerFn(createDocument);
  const removeDocument = useServerFn(deleteDocument);
  const runIndexing = useServerFn(indexDocument);
  const documents = useQuery({ queryKey: ["documents"], queryFn: () => fetchDocuments({}) });
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftSubject, setDraftSubject] = useState("");
  const [indexingId, setIndexingId] = useState<string | null>(null);
  const [indexingAll, setIndexingAll] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const saveSubject = useServerFn(updateDocumentSubject);

  const subjectMutation = useMutation({
    mutationFn: (input: { id: string; subject: string }) => saveSubject({ data: input }),
    onSuccess: async () => {
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeDocument({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document removed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reindexMutation = useMutation({
    mutationFn: (id: string) => runIndexing({ data: { documentId: id } }),
    onSuccess: (result) => {
      toast.success(result.note ?? "Search index refreshed for this file.");
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => setIndexingId(null),
  });

  async function reindexAll() {
    setIndexingAll(true);
    let done = 0;
    try {
      for (const document of rows) {
        await runIndexing({ data: { documentId: document.id } });
        done += 1;
      }
      toast.success(`Refreshed the search index for ${done} file${done === 1 ? "" : "s"}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not refresh the search index");
    } finally {
      setIndexingAll(false);
    }
  }

  const rows = documents.data ?? [];
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter(
      (document) =>
        !term ||
        document.filename.toLowerCase().includes(term) ||
        document.subject.toLowerCase().includes(term),
    );
  }, [rows, search]);

  async function upload(file: File) {
    if (!isAcceptedUpload(file.name)) {
      toast.error("Choose a PDF, Word or PowerPoint file.");
      return;
    }
    setBusy(true);
    try {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId) throw new Error("Please sign in again");
      const path = `${userId}/${newFileId()}.${fileExtension(file.name)}`;
      const { error } = await supabase.storage
        .from("materials")
        .upload(path, file, { contentType: uploadContentType(file.name) });
      if (error) throw error;
      const document = await addDocument({
        data: { filename: file.name, filePath: path, subject: "General" },
      });
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      const result = await runIndexing({ data: { documentId: document.id } });
      toast.success(result.note ?? `${file.name} is ready to study.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto flex min-h-dvh max-w-[1440px] flex-col lg:flex-row">
      <StudySidebar active="documents" />
      <main className="min-w-0 flex-1 px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted">Library</p>
            <h1 className="mt-1 font-display text-3xl font-medium">Your documents</h1>
            <p className="mt-2 text-sm text-muted">
              {rows.length} file{rows.length === 1 ? "" : "s"} ready for chat and quizzes
            </p>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_UPLOAD_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={reindexAll}
              variant="outline"
              disabled={busy || indexingAll || rows.length === 0}
              className="rounded-lg"
              title="Rebuild the search index for every file"
            >
              <RefreshCw className={indexingAll ? "animate-spin" : ""} />
              {indexingAll ? "Refreshing…" : "Refresh search index"}
            </Button>
            <Button
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className="rounded-lg bg-lamp text-ink hover:bg-lamp/90"
            >
              <Upload />
              {busy ? "Reading file…" : "Upload file"}
            </Button>
          </div>
        </header>

        <div className="relative mt-8 max-w-xl">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or subject"
            className="h-11 w-full rounded-lg border border-line bg-surface pl-10 pr-4 text-sm outline-none transition focus:border-lamp focus:ring-4 focus:ring-lamp/15"
          />
        </div>

        {documents.isLoading ? (
          <p className="mt-8 text-sm text-muted">Opening your library…</p>
        ) : visible.length === 0 ? (
          <div className="mt-8 border-t border-dashed border-line py-14 text-center">
            <p className="font-display text-lg font-medium">
              {rows.length === 0 ? "Your library is empty" : "No matching documents"}
            </p>
            <p className="mt-1 text-sm text-muted">
              {rows.length === 0
                ? "Upload a PDF, Word or PowerPoint file here, or attach one in chat."
                : "Try a different name or subject."}
            </p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((document) => (
              <article
                key={document.id}
                className="flex min-h-44 flex-col rounded-lg border border-line bg-surface p-5 card-shadow"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-clay-soft text-clay">
                    <FileText />
                  </div>
                  {editingId === document.id ? (
                    <input
                      autoFocus
                      value={draftSubject}
                      onChange={(event) => setDraftSubject(event.target.value)}
                      onBlur={() => setEditingId(null)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          subjectMutation.mutate({ id: document.id, subject: draftSubject });
                        } else if (event.key === "Escape") {
                          setEditingId(null);
                        }
                      }}
                      aria-label="Category"
                      placeholder="Category"
                      className="w-32 rounded-md border border-line bg-paper px-2 py-1 font-mono text-[10px] uppercase text-ink outline-none focus:border-lamp"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftSubject(document.subject);
                        setEditingId(document.id);
                      }}
                      title="Edit category"
                      className="rounded-md bg-sage-soft px-2 py-1 font-mono text-[10px] uppercase text-ink/70 transition hover:bg-sage-soft/70"
                    >
                      {document.subject}
                    </button>
                  )}
                </div>
                <h2 className="mt-4 line-clamp-2 text-sm font-semibold leading-snug">
                  {document.filename}
                </h2>
                <p className="mt-1 font-mono text-[10px] text-muted">
                  Added {formatDate(document.created_at)}
                </p>
                <div className="mt-auto flex items-center gap-2 pt-5">
                  {document.signed_url ? (
                    <Button asChild variant="outline" size="sm" className="flex-1 rounded-lg">
                      <a href={document.signed_url} download={document.filename} rel="noreferrer">
                        <ExternalLink /> Download
                      </a>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setIndexingId(document.id);
                      reindexMutation.mutate(document.id);
                    }}
                    disabled={indexingId !== null || indexingAll}
                    aria-label={`Refresh search index for ${document.filename}`}
                    title="Refresh search index"
                    className="text-muted hover:text-clay"
                  >
                    <RefreshCw className={indexingId === document.id ? "animate-spin" : ""} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => deleteMutation.mutate(document.id)}
                    disabled={deleteMutation.isPending}
                    aria-label={`Delete ${document.filename}`}
                    title="Delete document"
                    className="text-muted hover:text-clay"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </section>
  );
}
