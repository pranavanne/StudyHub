import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";
import { StudySidebar } from "@/components/study-sidebar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteQuizResult,
  generateQuiz,
  listQuizResults,
  saveQuizResult,
  updateQuizTopic,
  type QuizQuestion,
  type QuizResult,
  type QuizResultDetail,
} from "@/lib/quiz.functions";

export const Route = createFileRoute("/_authenticated/quiz")({
  head: () => ({
    meta: [
      { title: "Quiz — Study Hub" },
      {
        name: "description",
        content:
          "Generate a five-question recall quiz from your own study materials, answer it and keep your scores.",
      },
      { property: "og:title", content: "Quiz — Study Hub" },
      {
        property: "og:description",
        content: "Active recall practice built from the notes and PDFs on your desk.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Quiz,
});

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function startOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

function bucketFor(value: string) {
  const today = startOfDay(new Date());
  const day = startOfDay(new Date(value));
  const dayMs = 86_400_000;
  if (day === today) return "Today";
  if (day === today - dayMs) return "Yesterday";
  if (day > today - 7 * dayMs) return "This week";
  return "Earlier";
}

const BUCKET_ORDER = ["Today", "Yesterday", "This week", "Earlier"];

function scoreTone(score: number, total: number) {
  const ratio = total > 0 ? score / total : 0;
  if (ratio === 1) return "border-sage bg-sage-soft";
  if (ratio >= 0.5) return "border-line bg-card/60";
  return "border-clay bg-clay-soft";
}

function Quiz() {
  const queryClient = useQueryClient();

  const makeQuiz = useServerFn(generateQuiz);
  const storeResult = useServerFn(saveQuizResult);
  const fetchResults = useServerFn(listQuizResults);

  const results = useQuery({ queryKey: ["quiz-results"], queryFn: () => fetchResults({}) });

  const [topic, setTopic] = useState("");
  const [quizTopic, setQuizTopic] = useState("Your materials");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const [historySearch, setHistorySearch] = useState("");
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [sort, setSort] = useState("recent");
  const [reviewing, setReviewing] = useState<QuizResult | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const renameQuiz = useServerFn(updateQuizTopic);
  const renameMutation = useMutation({
    mutationFn: (payload: { id: string; topic: string }) => renameQuiz({ data: payload }),
    onSuccess: () => {
      setRenamingId(null);
      queryClient.invalidateQueries({ queryKey: ["quiz-results"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeQuiz = useServerFn(deleteQuizResult);
  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeQuiz({ data: { id } }),
    onSuccess: (_data, id) => {
      setReviewing((current) => (current?.id === id ? null : current));
      queryClient.invalidateQueries({ queryKey: ["quiz-results"] });
      toast.success("Quiz deleted.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const history = results.data ?? [];

  const topics = useMemo(
    () => Array.from(new Set(history.map((r) => r.topic))).slice(0, 12),
    [history],
  );

  const grouped = useMemo(() => {
    const term = historySearch.trim().toLowerCase();
    const rows = history.filter(
      (r) =>
        (activeTopic === null || r.topic === activeTopic) &&
        (term === "" || r.topic.toLowerCase().includes(term)),
    );
    const sorted = [...rows].sort((a, b) => {
      if (sort === "low") return a.score / a.total - b.score / b.total;
      if (sort === "high") return b.score / b.total - a.score / a.total;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    const buckets = new Map<string, QuizResult[]>();
    for (const row of sorted) {
      const key = bucketFor(row.created_at);
      buckets.set(key, [...(buckets.get(key) ?? []), row]);
    }
    return BUCKET_ORDER.filter((b) => buckets.has(b)).map(
      (b) => [b, buckets.get(b)!] as [string, QuizResult[]],
    );
  }, [history, historySearch, activeTopic, sort]);

  const generateMutation = useMutation({
    mutationFn: (value: string) => makeQuiz({ data: { topic: value } }),
    onSuccess: (data) => {
      setQuestions(data.questions);
      setQuizTopic(data.topic);
      setAnswers({});
      setSubmitted(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: {
      topic: string;
      score: number;
      total: number;
      details: QuizResultDetail[];
    }) => storeResult({ data: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quiz-results"] });
      toast.success("Score saved to your record.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const score = questions.reduce((sum, q, i) => sum + (answers[i] === q.answer ? 1 : 0), 0);
  const allAnswered = questions.length > 0 && questions.every((_, i) => answers[i] !== undefined);

  function submit() {
    if (!allAnswered || submitted) return;
    setSubmitted(true);
    saveMutation.mutate({
      topic: quizTopic,
      score,
      total: questions.length,
      details: questions.map((q, i) => ({
        question: q.question,
        options: q.options,
        chosen: answers[i] ?? -1,
        answer: q.answer,
        explanation: q.explanation,
      })),
    });
  }

  return (
    <section className="mx-auto flex min-h-dvh max-w-[1440px] flex-col lg:flex-row">
      <StudySidebar active="quiz" />

      <main className="min-w-0 flex-1 px-6 py-8 lg:px-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.15em] text-muted">
              Active recall
            </p>
            <h2 className="mt-1 font-display text-3xl font-medium tracking-tight">Quiz yourself</h2>
          </div>
          <div className="flex items-center gap-3">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Focus on… (optional)"
              className="w-56 rounded-full border border-line bg-surface px-4 py-2.5 text-sm outline-none transition focus:border-lamp focus:ring-4 focus:ring-lamp/15"
            />
            <button
              onClick={() => generateMutation.mutate(topic)}
              disabled={generateMutation.isPending}
              className="rounded-full bg-lamp px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-lamp/90 disabled:opacity-60"
            >
              {generateMutation.isPending ? "Writing questions…" : "Generate quiz"}
            </button>
          </div>
        </header>

        {questions.length === 0 && (
          <div className="mt-6 grid place-items-center rounded-3xl border border-dashed border-line bg-card/40 p-12 text-center">
            <div>
              <p className="font-display text-lg font-medium">No quiz yet</p>
              <p className="mt-1 text-sm text-muted">
                Generate five questions drawn from your uploaded materials and documents.
              </p>
            </div>
          </div>
        )}

        {questions.length > 0 && (
          <div className="mt-6 space-y-4">
            {questions.map((q, index) => (
              <article key={index} className="rounded-3xl bg-surface p-5 card-shadow">
                <p className="font-mono text-[11px] uppercase tracking-wide text-muted">
                  Question {index + 1}
                </p>
                <h3 className="mt-2 font-display text-lg font-medium leading-snug">{q.question}</h3>
                <div className="mt-4 space-y-2">
                  {q.options.map((option, optionIndex) => {
                    const chosen = answers[index] === optionIndex;
                    const correct = q.answer === optionIndex;
                    const tone = submitted
                      ? correct
                        ? "border-sage bg-sage-soft"
                        : chosen
                          ? "border-clay bg-clay-soft"
                          : "border-line bg-card/40"
                      : chosen
                        ? "border-lamp bg-lamp/10"
                        : "border-line bg-card/40 hover:border-lamp/60";
                    return (
                      <button
                        key={optionIndex}
                        disabled={submitted}
                        onClick={() => setAnswers((prev) => ({ ...prev, [index]: optionIndex }))}
                        className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition ${tone}`}
                      >
                        <span className="font-mono text-[11px] text-muted">
                          {String.fromCharCode(65 + optionIndex)}
                        </span>
                        {option}
                      </button>
                    );
                  })}
                </div>
                {submitted && q.explanation && (
                  <p className="mt-3 text-sm text-muted">{q.explanation}</p>
                )}
              </article>
            ))}

            {!submitted ? (
              <button
                onClick={submit}
                disabled={!allAnswered}
                className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-ink/90 disabled:opacity-50"
              >
                {allAnswered ? "Submit answers" : "Answer every question first"}
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-4 rounded-3xl bg-surface p-5 card-shadow">
                <p className="font-display text-2xl font-medium">
                  {score} / {questions.length}
                </p>
                <p className="text-sm text-muted">
                  {score === questions.length
                    ? "Perfect recall — well done."
                    : score >= questions.length / 2
                      ? "Solid. Review the ones you missed."
                      : "Worth another pass through these materials."}
                </p>
                <button
                  onClick={() => generateMutation.mutate(topic)}
                  className="ml-auto rounded-full bg-lamp px-4 py-2 text-sm font-medium text-ink transition hover:bg-lamp/90"
                >
                  New quiz
                </button>
              </div>
            )}
          </div>
        )}

        <section className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-xl font-medium">Past quizzes</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Search by topic…"
                  className="w-56 rounded-full border border-line bg-surface py-2 pl-9 pr-4 text-sm outline-none transition focus:border-lamp focus:ring-4 focus:ring-lamp/15"
                />
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="rounded-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-lamp"
              >
                <option value="recent">Most recent</option>
                <option value="low">Lowest score first</option>
                <option value="high">Highest score first</option>
              </select>
            </div>
          </div>

          {topics.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {["All topics", ...topics].map((chip) => {
                const active = chip === "All topics" ? activeTopic === null : activeTopic === chip;
                return (
                  <button
                    key={chip}
                    onClick={() => setActiveTopic(chip === "All topics" ? null : chip)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition ${
                      active
                        ? "border-lamp bg-lamp/15 text-ink"
                        : "border-line bg-card/40 text-muted hover:border-lamp/60"
                    }`}
                  >
                    {chip}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-4 space-y-6">
            {(results.data ?? []).length === 0 && (
              <p className="text-sm text-muted">Your finished quizzes will be listed here.</p>
            )}
            {(results.data ?? []).length > 0 && grouped.length === 0 && (
              <p className="text-sm text-muted">No quizzes match that search.</p>
            )}
            {grouped.map(([bucket, rows]) => (
              <div key={bucket}>
                <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted">
                  {bucket}
                </p>
                <div className="mt-2 space-y-2">
                  {rows.map((result) => (
                    <div
                      key={result.id}
                      className="flex w-full items-center gap-2 rounded-2xl border border-line bg-card/50 px-4 py-3 text-sm transition hover:border-lamp/60"
                    >
                      {renamingId === result.id ? (
                        <form
                          className="flex min-w-0 flex-1 items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            renameMutation.mutate({ id: result.id, topic: renameValue });
                          }}
                        >
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => setRenamingId(null)}
                            className="min-w-0 flex-1 rounded-full border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:border-lamp"
                          />
                        </form>
                      ) : (
                        <button
                          onClick={() => setReviewing(result)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block truncate font-medium">{result.topic}</span>
                          <span className="font-mono text-[11px] text-muted">
                            {formatDate(result.created_at)} · {formatTime(result.created_at)}
                          </span>
                        </button>
                      )}
                      <span
                        className={`shrink-0 rounded-full border px-3 py-1 font-display text-sm font-medium ${scoreTone(result.score, result.total)}`}
                      >
                        {result.score}/{result.total}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            aria-label="Quiz options"
                            onMouseDown={(e) => e.preventDefault()}
                            className="shrink-0 rounded-full border border-line p-1.5 text-muted transition hover:border-lamp/60 hover:text-ink"
                          >
                            <MoreHorizontal className="size-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            onSelect={() => {
                              setRenamingId(result.id);
                              setRenameValue(result.topic);
                            }}
                          >
                            <Pencil className="size-3.5" />
                            Rename quiz
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-clay focus:text-clay"
                            onSelect={() => deleteMutation.mutate(result.id)}
                          >
                            <Trash2 className="size-3.5" />
                            Delete quiz
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <Dialog open={reviewing !== null} onOpenChange={(open) => !open && setReviewing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{reviewing?.topic}</DialogTitle>
            <DialogDescription>
              {reviewing
                ? `Scored ${reviewing.score}/${reviewing.total} on ${formatDate(reviewing.created_at)} at ${formatTime(reviewing.created_at)}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {reviewing && (reviewing.details ?? []).length === 0 && (
            <p className="text-sm text-muted">
              This quiz was taken before answers were saved, so only the score is available.
            </p>
          )}

          <div className="space-y-4">
            {(reviewing?.details ?? []).map((detail, index) => (
              <article key={index} className="rounded-2xl border border-line bg-card/40 p-4">
                <p className="font-mono text-[11px] uppercase tracking-wide text-muted">
                  Question {index + 1}
                </p>
                <h4 className="mt-1 font-display text-base font-medium leading-snug">
                  {detail.question}
                </h4>
                <div className="mt-3 space-y-2">
                  {(detail.options ?? []).map((option, optionIndex) => {
                    const correct = detail.answer === optionIndex;
                    const chosen = detail.chosen === optionIndex;
                    const tone = correct
                      ? "border-sage bg-sage-soft"
                      : chosen
                        ? "border-clay bg-clay-soft"
                        : "border-line bg-surface";
                    return (
                      <div
                        key={optionIndex}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm ${tone}`}
                      >
                        <span className="font-mono text-[11px] text-muted">
                          {String.fromCharCode(65 + optionIndex)}
                        </span>
                        <span className="min-w-0 flex-1">{option}</span>
                        {correct && <span className="text-[11px] text-muted">Correct</span>}
                        {!correct && chosen && (
                          <span className="text-[11px] text-muted">Your answer</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {detail.explanation && (
                  <p className="mt-3 text-sm text-muted">{detail.explanation}</p>
                )}
              </article>
            ))}
          </div>

          {reviewing && (
            <div className="flex justify-end border-t border-line pt-4">
              <button
                onClick={() => deleteMutation.mutate(reviewing.id)}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-2 rounded-full border border-clay px-4 py-2 text-sm font-medium text-clay transition hover:bg-clay-soft disabled:opacity-60"
              >
                <Trash2 className="size-3.5" />
                {deleteMutation.isPending ? "Deleting…" : "Delete quiz"}
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
