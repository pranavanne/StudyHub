import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("profiles")
      .select("display_name, field_of_study")
      .eq("id", context.userId)
      .maybeSingle();
    return data ?? { display_name: "Student", field_of_study: null };
  });

export type ChatSession = {
  id: string;
  title: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
};

export const listSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("chat_sessions")
      .select("id, title, is_pinned, created_at, updated_at")
      .order("is_pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as ChatSession[];
  });

export const renameSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; title: string }) => input)
  .handler(async ({ data, context }) => {
    const title = data.title.trim().slice(0, 80);
    if (!title) throw new Error("Please enter a name for this chat");
    const { error } = await context.supabase
      .from("chat_sessions")
      .update({ title })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, title };
  });

export const setSessionPinned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; pinned: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chat_sessions")
      .update({ is_pinned: data.pinned })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("chat_sessions")
      .insert({ user_id: context.userId, title: "New chat" })
      .select("id, title, is_pinned, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return data as ChatSession;
  });

export const deleteSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("chat_sessions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sessionId?: string | null }) => input)
  .handler(async ({ data, context }) => {
    if (!data.sessionId) return [] as ChatMessage[];
    const { data: rows, error } = await context.supabase
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("session_id", data.sessionId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return (rows ?? []) as ChatMessage[];
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { content: string; sessionId?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const content = data.content.trim();
    if (!content) throw new Error("Write a question first");

    const { supabase, userId } = context;

    let sessionId = data.sessionId ?? null;
    if (!sessionId) {
      const { data: created, error: sessionError } = await supabase
        .from("chat_sessions")
        .insert({ user_id: userId, title: "New chat" })
        .select("id")
        .single();
      if (sessionError) throw new Error(sessionError.message);
      sessionId = created.id;
    }

    const { error: insertError } = await supabase
      .from("chat_messages")
      .insert({ user_id: userId, role: "user", content, session_id: sessionId });
    if (insertError) throw new Error(insertError.message);

    const [{ data: history }, { data: links }, { data: legacyDocs }, { data: session }] =
      await Promise.all([
        supabase
          .from("chat_messages")
          .select("role, content")
          .eq("session_id", sessionId)
          .order("created_at", { ascending: false })
          .limit(12),
        supabase.from("chat_session_documents").select("document_id").eq("session_id", sessionId),
        supabase.from("documents").select("id, filename, subject").eq("session_id", sessionId),
        supabase.from("chat_sessions").select("title").eq("id", sessionId).maybeSingle(),
      ]);

    if (!session?.title || session.title === "New chat") {
      const title = content.length > 48 ? `${content.slice(0, 48).trim()}…` : content;
      await supabase.from("chat_sessions").update({ title }).eq("id", sessionId);
    }

    const docIds = new Set<string>();
    for (const row of links ?? []) docIds.add(row.document_id);
    for (const row of legacyDocs ?? []) docIds.add(row.id);

    let docs: { id: string; filename: string; subject: string }[] = [];
    if (docIds.size > 0) {
      const { data: docRows } = await supabase
        .from("documents")
        .select("id, filename, subject")
        .in("id", [...docIds]);
      docs = docRows ?? [];
    }
    const sources = docs.map((d) => `- ${d.filename} (${d.subject})`).join("\n");

    // Pull the most relevant passages from the materials attached to THIS chat only.
    let passages = "";
    if (docs.length > 0) {
      try {
        const { embedTexts } = await import("./embeddings.server");
        const [queryVector] = await embedTexts([content]);
        const { data: matches } = await supabase.rpc("match_session_chunks", {
          query_embedding: JSON.stringify(queryVector),
          doc_ids: docs.map((d) => d.id),
          match_count: 6,
        });
        passages = (matches ?? [])
          .map((m: { content: string }) => m.content)
          .join("\n---\n")
          .slice(0, 12000);
      } catch (error) {
        console.error("Retrieval failed", error);
      }
    }

    const messages = [
      {
        role: "system",
        content:
          "You are the Study Hub companion: a calm, precise study tutor. Give short, clear explanations, " +
          "use plain language, and offer to quiz the student when useful. Answer using the materials " +
          "attached to this conversation, and mention the material by name when you use it.\n\n" +
          (sources
            ? `Materials attached to this chat:\n${sources}`
            : "No materials are attached to this chat yet.") +
          (passages ? `\n\nRelevant passages:\n${passages}` : ""),
      },
      ...(history ?? []).reverse().map((m) => ({ role: m.role, content: m.content })),
    ];

    let reply = "I couldn't reach the study companion just now. Please try again in a moment.";
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env["OPENAI_API_KEY"]}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: process.env["OPENAI_MODEL"] || "gpt-4o-mini", messages }),
      });
      if (response.status === 429) {
        reply =
          "You've asked a lot of questions very quickly — take a short breath and try again in a minute.";
      } else if (response.status === 402) {
        reply = "The study companion is out of credits for now.";
      } else if (response.ok) {
        const json = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        reply = json.choices?.[0]?.message?.content?.trim() || reply;
      } else {
        console.error("AI gateway error", response.status, await response.text());
      }
    } catch (error) {
      console.error("AI gateway request failed", error);
    }

    const { error: replyError } = await supabase
      .from("chat_messages")
      .insert({ user_id: userId, role: "assistant", content: reply, session_id: sessionId });
    if (replyError) throw new Error(replyError.message);

    await supabase
      .from("chat_sessions")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", sessionId);

    return { reply, sessionId };
  });
