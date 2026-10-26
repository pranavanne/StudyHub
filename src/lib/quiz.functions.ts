import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type QuizQuestion = {
  question: string;
  options: string[];
  answer: number;
  explanation: string;
};

export type QuizResultDetail = {
  question: string;
  options?: string[];
  answer: number;
  chosen: number;
  explanation?: string;
};

export type QuizResult = {
  id: string;
  topic: string;
  score: number;
  total: number;
  created_at: string;
  details?: QuizResultDetail[];
};

function safeParse(raw: string): QuizQuestion[] {
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const parsed = JSON.parse(slice) as QuizQuestion[];
  return parsed
    .filter(
      (q) =>
        q &&
        typeof q.question === "string" &&
        Array.isArray(q.options) &&
        q.options.length >= 2 &&
        typeof q.answer === "number",
    )
    .slice(0, 5)
    .map((q) => ({
      question: q.question,
      options: q.options.slice(0, 4).map(String),
      answer: Math.max(0, Math.min(q.options.length - 1, Math.round(q.answer))),
      explanation: typeof q.explanation === "string" ? q.explanation : "",
    }));
}

export const generateQuiz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { topic?: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const topic = (data.topic ?? "").trim();

    const [{ data: chunks }, { data: materials }] = await Promise.all([
      supabase.from("document_chunks").select("content").order("chunk_index").limit(25),
      supabase.from("materials").select("title, subject, note").limit(30),
    ]);

    const sourceText = (chunks ?? [])
      .map((c) => c.content)
      .join("\n---\n")
      .slice(0, 12000);
    const materialList = (materials ?? [])
      .map((m) => `- ${m.title} (${m.subject})${m.note ? `: ${m.note}` : ""}`)
      .join("\n");

    if (!sourceText && !materialList) {
      throw new Error("Upload a study material or document first, then generate a quiz.");
    }

    const prompt =
      "Write exactly 5 multiple-choice questions for active recall practice based on the study material below." +
      (topic ? ` Focus on: ${topic}.` : "") +
      "\n\nReply with ONLY a JSON array, no prose, in this shape:\n" +
      '[{"question":"...","options":["a","b","c","d"],"answer":0,"explanation":"..."}]\n' +
      "Each question has 4 plausible options, one correct, and a one-sentence explanation.\n\n" +
      (sourceText ? `Study material:\n${sourceText}\n\n` : "") +
      (materialList ? `The student's materials:\n${materialList}` : "");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env["OPENAI_API_KEY"]}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env["OPENAI_MODEL"] || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a precise study tutor who writes fair, clear recall questions.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (response.status === 429) {
      throw new Error("Too many quizzes at once — try again in a minute.");
    }
    if (response.status === 402) {
      throw new Error("The study companion is out of credits for now.");
    }
    if (!response.ok) {
      console.error("AI gateway error", response.status, await response.text());
      throw new Error("Could not build a quiz just now. Please try again.");
    }

    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content ?? "";

    let questions: QuizQuestion[] = [];
    try {
      questions = safeParse(raw);
    } catch {
      questions = [];
    }
    if (questions.length === 0) {
      throw new Error("The quiz came back unreadable. Please try again.");
    }

    let finalTopic = topic;
    if (!finalTopic) {
      try {
        const titleResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env["OPENAI_API_KEY"]}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env["OPENAI_MODEL"] || "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "You name study quizzes. Reply with ONLY a short title of 2-5 words describing the subject matter. No quotes, no punctuation at the end.",
              },
              {
                role: "user",
                content: `Name this quiz based on its questions:\n${questions
                  .map((q) => `- ${q.question}`)
                  .join("\n")}`,
              },
            ],
          }),
        });
        if (titleResponse.ok) {
          const titleJson = (await titleResponse.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const suggested = (titleJson.choices?.[0]?.message?.content ?? "")
            .replace(/["`*\n]/g, " ")
            .trim()
            .slice(0, 60);
          if (suggested) finalTopic = suggested;
        }
      } catch (error) {
        console.error("Quiz title generation failed", error);
      }
    }

    return { topic: finalTopic || "Your materials", questions };
  });

export const updateQuizTopic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; topic: string }) => input)
  .handler(async ({ data, context }) => {
    const topic = data.topic.trim().slice(0, 80);
    if (!topic) throw new Error("Give the quiz a name.");
    const { error } = await context.supabase
      .from("quiz_results")
      .update({ topic })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, topic };
  });

export const deleteQuizResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("quiz_results")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveQuizResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { topic: string; score: number; total: number; details: QuizResultDetail[] }) => input,
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("quiz_results")
      .insert({
        user_id: context.userId,
        topic: data.topic || "Your materials",
        score: data.score,
        total: data.total,
        details: data.details,
      })
      .select("id, topic, score, total, created_at, details")
      .single();
    if (error) throw new Error(error.message);
    return row as QuizResult;
  });

export const listQuizResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("quiz_results")
      .select("id, topic, score, total, created_at, details")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as QuizResult[];
  });
