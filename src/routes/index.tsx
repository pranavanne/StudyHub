import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LogIn } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { signInRecruiterDemo } from "@/lib/demo-auth.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Study Hub — A quiet desk for deep study" },
      {
        name: "description",
        content:
          "Study Hub keeps your notes, materials and a study companion on one calm desk. Sign in to pick up where you left off.",
      },
      { property: "og:title", content: "Study Hub — A quiet desk for deep study" },
      {
        property: "og:description",
        content:
          "Upload your materials, keep them organised by subject, and ask a study companion anything.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const demoLogin = useServerFn(signInRecruiterDemo);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) navigate({ to: "/dashboard", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success("Check your email to confirm your account.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function handleDemo() {
    setDemoBusy(true);
    try {
      const session = await demoLogin();
      const { error } = await supabase.auth.setSession(session);
      if (error) throw error;
      navigate({ to: "/dashboard", replace: true });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Demo login is unavailable. Please try again.",
      );
    } finally {
      setDemoBusy(false);
    }
  }

  return (
    <section className="relative min-h-screen overflow-hidden border-b border-line bg-paper">
      <div className="absolute -top-24 -right-24 size-96 rounded-full bg-lamp-soft/50 blur-3xl" />
      <div className="absolute -bottom-32 -left-16 size-80 rounded-full bg-sage-soft/60 blur-3xl" />
      <div className="relative mx-auto grid max-w-6xl grid-cols-1 gap-12 px-8 py-16 lg:grid-cols-2 lg:items-center">
        <div className="animate-rise">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-ink text-paper card-shadow">
              <span className="font-display text-xl font-semibold">S</span>
            </div>
            <span className="font-display text-2xl font-semibold tracking-tight">Study Hub</span>
          </div>
          <h1 className="mt-8 text-balance font-display text-5xl font-medium leading-[1.05] tracking-tight lg:text-6xl">
            A quiet desk for <span className="italic text-lamp">deep</span> study.
          </h1>
          <p className="mt-5 max-w-[46ch] text-pretty text-base text-muted">
            Your materials, notes, and a study companion — arranged like index cards under a good
            lamp. No noise, just focus.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-sage-soft px-3 py-1.5 text-xs font-medium text-ink/70">
              12 subjects
            </span>
            <span className="rounded-full bg-plum-soft px-3 py-1.5 text-xs font-medium text-ink/70">
              Source-linked answers
            </span>
            <span className="rounded-full bg-clay-soft px-3 py-1.5 text-xs font-medium text-ink/70">
              Calm by default
            </span>
          </div>
        </div>

        <div className="animate-fade [animation-delay:120ms]">
          <div className="rounded-[28px] bg-surface p-7 card-shadow-lg">
            <div className="flex rounded-full bg-card p-1 text-sm font-medium">
              <button
                type="button"
                onClick={() => setMode("signin")}
                className={
                  mode === "signin"
                    ? "flex-1 rounded-full bg-surface py-2 text-ink card-shadow"
                    : "flex-1 rounded-full py-2 text-muted"
                }
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className={
                  mode === "signup"
                    ? "flex-1 rounded-full bg-surface py-2 text-ink card-shadow"
                    : "flex-1 rounded-full py-2 text-muted"
                }
              >
                Sign up
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="mt-6 space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@university.edu"
                    className="w-full rounded-2xl border border-line bg-paper px-4 py-3 text-sm outline-none transition focus:border-lamp focus:ring-4 focus:ring-lamp/15"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-2xl border border-line bg-paper px-4 py-3 text-sm outline-none transition focus:border-lamp focus:ring-4 focus:ring-lamp/15"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={busy || demoBusy}
                className="mt-6 w-full rounded-2xl bg-ink py-3 text-sm font-medium text-paper transition hover:bg-ink/90 disabled:opacity-60"
              >
                {busy ? "One moment…" : mode === "signin" ? "Enter the desk" : "Create your desk"}
              </button>
            </form>

            <Button
              type="button"
              variant="outline"
              onClick={handleDemo}
              disabled={busy || demoBusy}
              className="mt-3 h-auto w-full rounded-2xl border-line bg-paper py-3 text-sm font-medium text-ink hover:bg-card/60"
            >
              <LogIn aria-hidden="true" />
              {demoBusy ? "Opening demo…" : "Recruiter Demo Login"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
