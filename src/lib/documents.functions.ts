import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type StudyDocument = {
  id: string;
  filename: string;
  file_url: string;
  subject: string;
  session_id: string | null;
  created_at: string;
  signed_url: string | null;
};

export const listDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { sessionId?: string | null }) => input ?? {})
  .handler(async ({ data: input, context }) => {
    let query = context.supabase
      .from("documents")
      .select("id, filename, file_url, subject, session_id, created_at")
      .order("created_at", { ascending: false });
    if (input?.sessionId) {
      // Documents reach a chat either through the link table or a legacy upload column.
      const [{ data: links }, { data: legacy }] = await Promise.all([
        context.supabase
          .from("chat_session_documents")
          .select("document_id")
          .eq("session_id", input.sessionId),
        context.supabase.from("documents").select("id").eq("session_id", input.sessionId),
      ]);
      const ids = new Set<string>();
      for (const row of links ?? []) ids.add(row.document_id);
      for (const row of legacy ?? []) ids.add(row.id);
      if (ids.size === 0) return [] as StudyDocument[];
      query = query.in("id", [...ids]);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const { createDocumentViewToken } = await import("./document-token.server");
    const rows = data ?? [];
    const withLinks = await Promise.all(
      rows.map(async (row) => {
        const token = await createDocumentViewToken({
          documentId: row.id,
          userId: context.userId,
        });
        return { ...row, signed_url: `/api/public/document/${token}` } as StudyDocument;
      }),
    );
    return withLinks;
  });

/** Attaches documents that already live in the library to a chat. */
export const attachDocumentsToSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sessionId: string; documentIds: string[] }) => input)
  .handler(async ({ data, context }) => {
    if (data.documentIds.length === 0) return { ok: true, added: 0 };
    const { error } = await context.supabase.from("chat_session_documents").upsert(
      data.documentIds.map((documentId) => ({
        user_id: context.userId,
        session_id: data.sessionId,
        document_id: documentId,
      })),
      { onConflict: "session_id,document_id", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
    return { ok: true, added: data.documentIds.length };
  });

/** Removes a document from a chat without deleting it from the library. */
export const detachDocumentFromSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sessionId: string; documentId: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chat_session_documents")
      .delete()
      .eq("session_id", data.sessionId)
      .eq("document_id", data.documentId);
    if (error) throw new Error(error.message);

    // Legacy uploads were bound through documents.session_id.
    await context.supabase
      .from("documents")
      .update({ session_id: null })
      .eq("id", data.documentId)
      .eq("session_id", data.sessionId);
    return { ok: true };
  });

export const createDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { filename: string; filePath: string; subject?: string; sessionId?: string | null }) =>
      input,
  )
  .handler(async ({ data, context }) => {
    const filename = data.filename.trim();
    if (!filename) throw new Error("A file name is required");
    if (!data.filePath.startsWith(`${context.userId}/`)) {
      throw new Error("Invalid file location");
    }
    const { data: row, error } = await context.supabase
      .from("documents")
      .insert({
        user_id: context.userId,
        filename,
        file_url: data.filePath,
        subject: data.subject?.trim() || "General",
        session_id: data.sessionId ?? null,
      })
      .select("id, filename, file_url, subject, session_id, created_at")
      .single();
    if (error) throw new Error(error.message);

    if (data.sessionId) {
      await context.supabase.from("chat_session_documents").upsert(
        {
          user_id: context.userId,
          session_id: data.sessionId,
          document_id: row.id,
        },
        { onConflict: "session_id,document_id", ignoreDuplicates: true },
      );
    }
    return row;
  });

export const updateDocumentSubject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; subject: string }) => input)
  .handler(async ({ data, context }) => {
    const subject = data.subject.trim().slice(0, 40) || "General";
    const { error } = await context.supabase
      .from("documents")
      .update({ subject })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, subject };
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("documents")
      .select("file_url")
      .eq("id", data.id)
      .maybeSingle();

    const { error } = await context.supabase.from("documents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    if (row?.file_url) {
      await context.supabase.storage.from("materials").remove([row.file_url]);
    }
    return { ok: true };
  });

/**
 * Reads the uploaded PDF, splits it into passages, embeds them and stores the
 * vectors so the study companion can search inside the document.
 */
export const indexDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { documentId: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: doc, error: docError } = await context.supabase
      .from("documents")
      .select("id, file_url, filename")
      .eq("id", data.documentId)
      .maybeSingle();
    if (docError) throw new Error(docError.message);
    if (!doc) throw new Error("Document not found");

    const { data: file, error: downloadError } = await context.supabase.storage
      .from("materials")
      .download(doc.file_url);
    if (downloadError || !file) throw new Error("Could not open the uploaded file");

    const { extractDocumentText } = await import("./extract-text.server");
    const buffer = new Uint8Array(await file.arrayBuffer());
    const filename = (doc as { filename?: string }).filename ?? doc.file_url;
    const text = await extractDocumentText(buffer, filename);

    const { chunkText, embedTexts } = await import("./embeddings.server");
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      return { chunks: 0, note: "No readable text found in this file." };
    }

    const vectors = await embedTexts(chunks);

    await context.supabase.from("document_chunks").delete().eq("document_id", doc.id);

    const rows = chunks.map((content, index) => ({
      document_id: doc.id,
      user_id: context.userId,
      chunk_index: index,
      content,
      embedding: JSON.stringify(vectors[index]),
    }));

    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await context.supabase
        .from("document_chunks")
        .insert(rows.slice(i, i + 100));
      if (error) throw new Error(error.message);
    }

    return { chunks: rows.length, note: null };
  });
