import { Link, useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Shapes,
  Trash2,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { supabase } from "@/integrations/supabase/client";
import {
  deleteSession,
  listSessions,
  renameSession,
  setSessionPinned,
} from "@/lib/study.functions";
import { cn } from "@/lib/utils";

type StudySidebarProps = {
  active: "chat" | "documents" | "quiz";
  activeSessionId?: string | null;
};

const items = [
  { id: "documents", label: "Documents", to: "/documents", icon: BookOpen },
  { id: "quiz", label: "Quiz", to: "/quiz", icon: Shapes },
] as const;

export function StudySidebar({ active, activeSessionId = null }: StudySidebarProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchSessions = useServerFn(listSessions);
  const removeSession = useServerFn(deleteSession);
  const renameChatFn = useServerFn(renameSession);
  const pinChatFn = useServerFn(setSessionPinned);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => fetchSessions({}) });

  const renameChat = useMutation({
    mutationFn: (input: { id: string; title: string }) => renameChatFn({ data: input }),
    onSuccess: async () => {
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const pinChat = useMutation({
    mutationFn: (input: { id: string; pinned: boolean }) => pinChatFn({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
    onError: (error: Error) => toast.error(error.message),
  });

  function startNewChat() {
    queryClient.setQueryData(["messages", "new"], []);
    navigate({ to: "/dashboard", search: {} });
  }

  const removeChat = useMutation({
    mutationFn: (id: string) => removeSession({ data: { id } }),
    onSuccess: async (_result, id) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      if (id === activeSessionId) navigate({ to: "/dashboard", search: {} });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  const threads = sessions.data ?? [];

  return (
    <>
      <aside className="hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface/70 p-5 lg:flex">
        <div className="flex shrink-0 items-center gap-2.5 px-2">
          <div className="grid size-9 place-items-center rounded-lg bg-ink text-paper">
            <span className="font-display font-semibold">S</span>
          </div>
          <span className="font-display text-lg font-semibold">Study Hub</span>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={startNewChat}
          className="mt-8 w-full shrink-0 justify-start gap-2 rounded-lg border-line bg-paper/60"
        >
          <Plus className="size-4" />
          New Chat
        </Button>

        <nav className="mt-4 shrink-0 space-y-1 text-sm" aria-label="Study Hub">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                to={item.to}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition",
                  active === item.id
                    ? "bg-card font-medium text-ink card-shadow"
                    : "text-muted hover:bg-card/60 hover:text-ink",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <p className="mt-6 shrink-0 px-3 font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
          Recent chats
        </p>
        <div className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
          {threads.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">No conversations yet.</p>
          ) : (
            threads.map((thread) => (
              <div
                key={thread.id}
                className={cn(
                  "group flex items-center gap-1 rounded-lg pr-1 transition",
                  thread.id === activeSessionId
                    ? "bg-card text-ink"
                    : "text-muted hover:bg-card/60 hover:text-ink",
                )}
              >
                {editingId === thread.id ? (
                  <input
                    autoFocus
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onBlur={() => setEditingId(null)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        renameChat.mutate({ id: thread.id, title: draftTitle });
                      } else if (event.key === "Escape") {
                        setEditingId(null);
                      }
                    }}
                    aria-label="Chat name"
                    className="mx-2 my-1 min-w-0 flex-1 rounded-md border border-line bg-paper px-2 py-1 text-sm text-ink outline-none focus:border-lamp"
                  />
                ) : (
                  <>
                    <Link
                      to="/dashboard"
                      search={{ c: thread.id }}
                      className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-sm"
                      title={thread.title}
                    >
                      {thread.is_pinned ? (
                        <Pin className="size-3.5 shrink-0 fill-current" />
                      ) : (
                        <MessageSquare className="size-3.5 shrink-0" />
                      )}
                      <span className="truncate">{thread.title}</span>
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Options for ${thread.title}`}
                          className="grid size-6 shrink-0 place-items-center rounded-md text-muted opacity-0 transition hover:bg-paper/70 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                        >
                          <MoreHorizontal className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onSelect={() => {
                            setDraftTitle(thread.title);
                            setEditingId(thread.id);
                          }}
                        >
                          <Pencil className="size-3.5" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            pinChat.mutate({ id: thread.id, pinned: !thread.is_pinned })
                          }
                        >
                          {thread.is_pinned ? (
                            <PinOff className="size-3.5" />
                          ) : (
                            <Pin className="size-3.5" />
                          )}
                          {thread.is_pinned ? "Unpin" : "Pin"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => removeChat.mutate(thread.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          onClick={handleSignOut}
          className="mt-3 w-full shrink-0 justify-start gap-3 rounded-lg px-3 text-muted hover:text-ink"
        >
          <LogOut className="size-4" />
          Sign out
        </Button>
      </aside>

      <header className="flex h-16 shrink-0 items-center justify-between border-b border-line bg-surface/80 px-4 lg:hidden">
        <Link to="/dashboard" className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-lg bg-ink text-paper">
            <span className="font-display text-sm font-semibold">S</span>
          </div>
          <span className="font-display font-semibold">Study Hub</span>
        </Link>
        <nav className="flex items-center gap-1" aria-label="Study Hub">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={startNewChat}
            aria-label="New chat"
            title="New chat"
          >
            <Plus />
          </Button>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.id}
                asChild
                variant={active === item.id ? "secondary" : "ghost"}
                size="icon-sm"
              >
                <Link to={item.to} aria-label={item.label} title={item.label}>
                  <Icon />
                </Link>
              </Button>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={handleSignOut}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut />
          </Button>
        </nav>
      </header>
    </>
  );
}
