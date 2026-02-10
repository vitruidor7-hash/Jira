import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createClient,
  RealtimeChannel,
  Session,
  SupabaseClient,
  User,
} from "@supabase/supabase-js";
import { motion } from "framer-motion";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus,
  Search,
  Users,
  Clock,
  Wifi,
  WifiOff,
  Send,
  Filter,
  LogOut,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

type IssueStatus = "backlog" | "todo" | "in_progress" | "review" | "done";
type IssuePriority = "low" | "medium" | "high" | "critical";

type UserLite = {
  id: string;
  name: string;
  email?: string;
};

type Issue = {
  id: string;
  project_id: string;
  key: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  assignee_id?: string | null;
  reporter_id?: string | null;
  assignee?: ProfileLite | null;
  reporter?: ProfileLite | null;
  story_points?: number | null;
  due_date?: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

type Comment = {
  id: string;
  project_id: string;
  issue_id: string;
  author_id: string;
  author?: ProfileLite | null;
  body: string;
  created_at: string;
};

type Activity = {
  id: string;
  project_id: string;
  actor_id: string;
  actor?: ProfileLite | null;
  action: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

type Filters = {
  q: string;
  priority: "all" | IssuePriority;
  assignee: "all" | string;
};

type ProfileLite = {
  id: string;
  display_name: string | null;
};

type ProjectMember = {
  project_id: string;
  user_id: string;
  role: string;
  profiles?: ProfileLite | null;
};

type LockPayload = {
  issueId: string;
  userId: string;
  userName: string;
  locked: boolean;
};

type LockInfo = {
  userId: string;
  userName: string;
};

const STATUSES: { id: IssueStatus; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];

const PRIORITIES: IssuePriority[] = ["low", "medium", "high", "critical"];

const priorityVariant: Record<IssuePriority, "secondary" | "outline" | "default" | "destructive"> = {
  low: "outline",
  medium: "secondary",
  high: "default",
  critical: "destructive",
};

const PROJECT_ID = "project-alpha";

function getSupabaseClient() {
  const url = (import.meta as any)?.env?.VITE_SUPABASE_URL;
  const anonKey = (import.meta as any)?.env?.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    realtime: { params: { eventsPerSecond: 30 } },
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

function nowIso() {
  return new Date().toISOString();
}

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}

function resolveDisplayName(user: User): string {
  const meta = (user.user_metadata || {}) as Record<string, unknown>;
  const fullName = (meta.full_name || meta.name || meta.preferred_name) as string | undefined;
  if (fullName && typeof fullName === "string" && fullName.trim()) return fullName.trim();
  if (user.email) return user.email.split("@")[0];
  return "User";
}

function resolveProfileName(profile: ProfileLite | null | undefined, fallback?: string | null) {
  if (profile?.display_name?.trim()) return profile.display_name.trim();
  if (fallback?.trim()) return fallback.trim();
  return "User";
}

function getNextIssueKey(existingIssues: Issue[], projectPrefix = "ALPHA") {
  let maxId = 0;
  for (const i of existingIssues) {
    const [prefix, numberPart] = i.key.split("-");
    if (prefix !== projectPrefix) continue;
    const n = Number.parseInt(numberPart ?? "", 10);
    if (!Number.isNaN(n)) {
      if (n > maxId) maxId = n;
    }
  }
  return `${projectPrefix}-${maxId + 1}`;
}

function toIssueDragId(issueId: string) {
  return `issue:${issueId}`;
}

function toColumnDropId(status: IssueStatus) {
  return `column:${status}`;
}

function parseDragId(id: string): { type: "issue" | "column"; value: string } | null {
  const [type, value] = id.split(":");
  if (!type || !value) return null;
  if (type === "issue" || type === "column") return { type, value };
  return null;
}

type SortableIssueCardProps = {
  issue: Issue;
  lockInfo?: LockInfo;
  me: UserLite;
  memberDirectory: Record<string, string>;
  onSelect: (issue: Issue) => void;
};

function SortableIssueCard({ issue, lockInfo, me, memberDirectory, onSelect }: SortableIssueCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: toIssueDragId(issue.id),
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  const lockedByOther = lockInfo && lockInfo.userId !== me.id;

  return (
    <motion.div layout ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card
        className="cursor-grab active:cursor-grabbing rounded-2xl border border-border/70 shadow-sm hover:shadow-md transition-shadow"
        onClick={() => onSelect(issue)}
      >
        <CardContent className="p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono text-muted-foreground">{issue.key}</span>
            <Badge variant={priorityVariant[issue.priority]} className="capitalize">
              {issue.priority}
            </Badge>
          </div>

          <p className="text-sm font-medium leading-snug">{issue.title}</p>

          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground truncate">
              {issue.assignee_id ? memberDirectory[issue.assignee_id] || "Unknown user" : "Unassigned"}
            </div>
            {lockedByOther ? (
              <Badge variant="outline" className="text-[10px]">
                Editing: {lockInfo.userName}
              </Badge>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

type ColumnLaneProps = {
  status: IssueStatus;
  label: string;
  issues: Issue[];
  issueLocks: Record<string, LockInfo>;
  me: UserLite;
  memberDirectory: Record<string, string>;
  onSelectIssue: (issue: Issue) => void;
};

function ColumnLane({ status, label, issues, issueLocks, me, memberDirectory, onSelectIssue }: ColumnLaneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: toColumnDropId(status) });

  return (
    <div className="min-w-[300px] w-[320px] flex-shrink-0">
      <div className="mb-2 px-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{label}</h3>
        <Badge variant="secondary">{issues.length}</Badge>
      </div>

      <div
        ref={setNodeRef}
        className={`rounded-2xl border p-2 min-h-[180px] bg-muted/30 transition-colors ${
          isOver ? "border-primary" : "border-border/60"
        }`}
      >
        <SortableContext items={issues.map((i) => toIssueDragId(i.id))} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {issues.map((issue) => (
              <SortableIssueCard
                key={issue.id}
                issue={issue}
                me={me}
                lockInfo={issueLocks[issue.id]}
                memberDirectory={memberDirectory}
                onSelect={onSelectIssue}
              />
            ))}
          </div>
        </SortableContext>
      </div>
    </div>
  );
}

type AuthScreenProps = {
  supabase: SupabaseClient;
};

function AuthScreen({ supabase }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleEmailAuth = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === "signup") {
        const { error: signUpError, data } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: fullName.trim() || null,
            },
          },
        });

        if (signUpError) throw signUpError;

        if (!data.session) {
          setMessage("Account created. Check your email to confirm your account.");
        } else {
          setMessage("Account created and signed in.");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
      }
    } catch (e: any) {
      setError(e?.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }, [email, fullName, mode, password, supabase]);

  const handleGoogle = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (oauthError) throw oauthError;
    } catch (e: any) {
      setError(e?.message || "Google sign-in failed.");
      setBusy(false);
    }
  }, [supabase]);

  return (
    <div className="h-screen w-full grid place-items-center p-6 bg-background">
      <Card className="w-full max-w-md rounded-2xl shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl">Sign in to Project Manager</CardTitle>
          <p className="text-sm text-muted-foreground">
            Realtime collaboration requires an authenticated Supabase user.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={mode === "login" ? "default" : "outline"}
              onClick={() => setMode("login")}
              disabled={busy}
            >
              Log in
            </Button>
            <Button
              variant={mode === "signup" ? "default" : "outline"}
              onClick={() => setMode("signup")}
              disabled={busy}
            >
              Sign up
            </Button>
          </div>

          {mode === "signup" ? (
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name"
              disabled={busy}
            />
          ) : null}

          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
            disabled={busy}
          />

          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            type="password"
            disabled={busy}
          />

          <Button onClick={handleEmailAuth} className="w-full" disabled={busy || !email || !password}>
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </span>
            ) : mode === "signup" ? (
              "Create account"
            ) : (
              "Sign in"
            )}
          </Button>

          <Button variant="outline" className="w-full" onClick={handleGoogle} disabled={busy}>
            Continue with Google
          </Button>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

type BoardProps = {
  supabase: SupabaseClient;
  session: Session;
};

function RealtimeBoard({ supabase, session }: BoardProps) {
  const me = useMemo<UserLite>(() => {
    const user = session.user;
    return {
      id: user.id,
      name: resolveDisplayName(user),
      email: user.email,
    };
  }, [session.user]);

  const [connected, setConnected] = useState(false);
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);

  const [issues, setIssues] = useState<Issue[]>([]);
  const [commentsByIssue, setCommentsByIssue] = useState<Record<string, Comment[]>>({});
  const [activities, setActivities] = useState<Activity[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);

  const [presence, setPresence] = useState<Record<string, UserLite>>({});
  const [issueLocks, setIssueLocks] = useState<Record<string, LockInfo>>({});

  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const selectedIssue = useMemo(
    () => issues.find((i) => i.id === selectedIssueId) ?? null,
    [issues, selectedIssueId]
  );

  const prevSelectedRef = useRef<string | null>(null);

  const [filters, setFilters] = useState<Filters>({ q: "", priority: "all", assignee: "all" });

  const [newIssueOpen, setNewIssueOpen] = useState(false);
  const [newIssueTitle, setNewIssueTitle] = useState("");
  const [newIssueDesc, setNewIssueDesc] = useState("");
  const [newIssuePriority, setNewIssuePriority] = useState<IssuePriority>("medium");
  const [newIssueStatus, setNewIssueStatus] = useState<IssueStatus>("backlog");

  const [draftComment, setDraftComment] = useState("");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const memberDirectory = useMemo(() => {
    const map: Record<string, string> = {};
    for (const member of members) {
      map[member.user_id] = resolveProfileName(member.profiles, member.user_id);
    }
    map[me.id] = me.name;
    return map;
  }, [me.id, me.name, members]);

  const assigneeOptions = useMemo(() => {
    return members
      .map((m) => ({ id: m.user_id, label: resolveProfileName(m.profiles, m.user_id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [members]);

  const filteredIssues = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return issues.filter((i) => {
      if (filters.priority !== "all" && i.priority !== filters.priority) return false;
      if (filters.assignee !== "all" && (i.assignee_id || "") !== filters.assignee) return false;
      if (!q) return true;
      return (
        i.key.toLowerCase().includes(q) ||
        i.title.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q)
      );
    });
  }, [filters, issues]);

  const grouped = useMemo(() => {
    const map: Record<IssueStatus, Issue[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      review: [],
      done: [],
    };

    for (const issue of filteredIssues) map[issue.status].push(issue);

    for (const key of Object.keys(map) as IssueStatus[]) {
      map[key].sort((a, b) => a.position - b.position || a.updated_at.localeCompare(b.updated_at));
    }

    return map;
  }, [filteredIssues]);

  const onlineUsers = useMemo(() => {
    const list = Object.values(presence);
    if (!list.find((u) => u.id === me.id)) list.push(me);
    return list;
  }, [me, presence]);

  const upsertIssueLocal = useCallback((incoming: Issue) => {
    setIssues((prev) => {
      const idx = prev.findIndex((i) => i.id === incoming.id);
      if (idx === -1) return [...prev, incoming];
      const next = [...prev];
      next[idx] = { ...next[idx], ...incoming };
      return next;
    });
  }, []);

  const removeIssueLocal = useCallback((issueId: string) => {
    setIssues((prev) => prev.filter((i) => i.id !== issueId));
    setCommentsByIssue((prev) => {
      const { [issueId]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const upsertCommentLocal = useCallback((incoming: Comment) => {
    setCommentsByIssue((prev) => {
      const existing = prev[incoming.issue_id] || [];
      const idx = existing.findIndex((c) => c.id === incoming.id);
      const next = idx === -1 ? [...existing, incoming] : existing.map((c) => (c.id === incoming.id ? incoming : c));
      next.sort((a, b) => a.created_at.localeCompare(b.created_at));
      return { ...prev, [incoming.issue_id]: next };
    });
  }, []);

  const fetchInitialData = useCallback(async () => {
    const [{ data: issueRows, error: issueErr }, { data: commentRows, error: commentErr }, { data: activityRows, error: activityErr }, { data: memberRows, error: memberErr }] =
      await Promise.all([
        supabase
          .from("issues")
          .select("*, assignee:assignee_id(id, display_name), reporter:reporter_id(id, display_name)")
          .eq("project_id", PROJECT_ID)
          .order("position", { ascending: true }),
        supabase
          .from("comments")
          .select("*, author:author_id(id, display_name)")
          .eq("project_id", PROJECT_ID)
          .order("created_at", { ascending: true }),
        supabase
          .from("activities")
          .select("*, actor:actor_id(id, display_name)")
          .eq("project_id", PROJECT_ID)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("project_members")
          .select("project_id, user_id, role, profiles(id, display_name)")
          .eq("project_id", PROJECT_ID),
      ]);

    if (issueErr || commentErr || activityErr || memberErr) {
      console.error("Initial fetch failed", issueErr || commentErr || activityErr || memberErr);
      return;
    }

    setIssues((issueRows || []) as Issue[]);

    const commentMap: Record<string, Comment[]> = {};
    for (const c of (commentRows || []) as Comment[]) {
      commentMap[c.issue_id] = commentMap[c.issue_id] || [];
      commentMap[c.issue_id].push(c);
    }
    setCommentsByIssue(commentMap);

    setActivities((activityRows || []) as Activity[]);
    setMembers((memberRows || []) as ProjectMember[]);
  }, [supabase]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  useEffect(() => {
    const ch = supabase.channel(`project:${PROJECT_ID}`, {
      config: {
        presence: { key: me.id },
        broadcast: { self: false },
      },
    });

    ch
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "issues", filter: `project_id=eq.${PROJECT_ID}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldIssue = payload.old as Issue;
            removeIssueLocal(oldIssue.id);
          } else {
            upsertIssueLocal(payload.new as Issue);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comments", filter: `project_id=eq.${PROJECT_ID}` },
        (payload) => {
          if (payload.eventType !== "DELETE") {
            upsertCommentLocal(payload.new as Comment);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "activities", filter: `project_id=eq.${PROJECT_ID}` },
        (payload) => {
          if (payload.eventType !== "DELETE") {
            setActivities((prev) => [payload.new as Activity, ...prev].slice(0, 200));
          }
        }
      )
      .on("presence", { event: "sync" }, () => {
        const state = ch.presenceState() as Record<string, Array<{ user: UserLite }>>;
        const next: Record<string, UserLite> = {};
        for (const key of Object.keys(state)) {
          const latest = state[key]?.[0]?.user;
          if (latest) next[latest.id] = latest;
        }
        setPresence(next);
      })
      .on("broadcast", { event: "issue-lock" }, ({ payload }) => {
        const p = payload as LockPayload;
        setIssueLocks((prev) => {
          const next = { ...prev };
          if (!p.locked) {
            const existing = next[p.issueId];
            if (existing?.userId === p.userId) {
              delete next[p.issueId];
            }
          } else {
            next[p.issueId] = {
              userId: p.userId,
              userName: p.userName,
            };
          }
          return next;
        });
      })
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") {
          ch.track({ user: me, at: nowIso() }).catch((e) => console.error("Presence tracking failed", e));
        }
      });

    setChannel(ch);

    return () => {
      ch.untrack();
      supabase.removeChannel(ch);
      setChannel(null);
      setConnected(false);
    };
  }, [me, removeIssueLocal, supabase, upsertCommentLocal, upsertIssueLocal]);

  const sendIssueLock = useCallback(
    (issueId: string, locked: boolean) => {
      if (!channel) return;
      channel.send({
        type: "broadcast",
        event: "issue-lock",
        payload: {
          issueId,
          userId: me.id,
          userName: me.name,
          locked,
        } satisfies LockPayload,
      });
    },
    [channel, me.id, me.name]
  );

  useEffect(() => {
    if (prevSelectedRef.current && prevSelectedRef.current !== selectedIssueId) {
      sendIssueLock(prevSelectedRef.current, false);
    }

    if (selectedIssueId) sendIssueLock(selectedIssueId, true);

    prevSelectedRef.current = selectedIssueId;

    return () => {
      if (selectedIssueId) sendIssueLock(selectedIssueId, false);
    };
  }, [selectedIssueId, sendIssueLock]);

  const persistActivity = useCallback(
    async (action: string, metadata?: Record<string, unknown>) => {
      const row: Activity = {
        id: uid(),
        project_id: PROJECT_ID,
        actor_id: me.id,

        action,
        metadata,
        created_at: nowIso(),
      };

      setActivities((prev) => [row, ...prev].slice(0, 200));

      const { error } = await supabase.from("activities").insert(row);
      if (error) console.error("Activity insert failed", error);
    },
    [me.id, supabase]
  );

  const createIssue = useCallback(async () => {
    const title = newIssueTitle.trim();
    if (!title) return;

    const nextIssue: Issue = {
      id: uid(),
      project_id: PROJECT_ID,
      key: getNextIssueKey(issues, "ALPHA"),
      title,
      description: newIssueDesc.trim(),
      status: newIssueStatus,
      priority: newIssuePriority,
      assignee_id: null,

      reporter_id: me.id,

      story_points: null,
      due_date: null,
      position: grouped[newIssueStatus].length,
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    upsertIssueLocal(nextIssue);
    setNewIssueOpen(false);
    setNewIssueTitle("");
    setNewIssueDesc("");
    setNewIssuePriority("medium");
    setNewIssueStatus("backlog");

    await persistActivity("Created issue", { key: nextIssue.key, title: nextIssue.title });

    const { error } = await supabase.from("issues").insert(nextIssue);
    if (error) {
      console.error("Issue create failed", error);
    }
  }, [
    grouped,
    issues,
    me.id,
    newIssueDesc,
    newIssuePriority,
    newIssueStatus,
    newIssueTitle,
    persistActivity,
    supabase,
    upsertIssueLocal,
  ]);

  const patchIssue = useCallback(
    async (issueId: string, patch: Partial<Issue>, activityAction?: string) => {
      const current = issues.find((i) => i.id === issueId);
      if (!current) return;

      const next = { ...current, ...patch, updated_at: nowIso() };
      upsertIssueLocal(next);

      if (activityAction) {
        await persistActivity(activityAction, { key: current.key, patch });
      }

      const { error } = await supabase
        .from("issues")
        .update({ ...patch, updated_at: nowIso() })
        .eq("id", issueId);

      if (error) console.error("Issue patch failed", error);
    },
    [issues, persistActivity, supabase, upsertIssueLocal]
  );

  const addComment = useCallback(async () => {
    if (!selectedIssue || !draftComment.trim()) return;

    const row: Comment = {
      id: uid(),
      project_id: PROJECT_ID,
      issue_id: selectedIssue.id,
      author_id: me.id,

      body: draftComment.trim(),
      created_at: nowIso(),
    };

    upsertCommentLocal(row);
    setDraftComment("");
    await persistActivity("Commented on issue", { key: selectedIssue.key });

    const { error } = await supabase.from("comments").insert(row);
    if (error) console.error("Comment insert failed", error);
  }, [draftComment, me.id, persistActivity, selectedIssue, supabase, upsertCommentLocal]);

  const reorderLocally = useCallback(
    (issueId: string, targetStatus: IssueStatus, targetIndex: number) => {
      const sourceIssue = issues.find((i) => i.id === issueId);
      if (!sourceIssue) return null;

      const next = [...issues];
      const movingIdx = next.findIndex((i) => i.id === issueId);
      const [moving] = next.splice(movingIdx, 1);
      moving.status = targetStatus;

      const targetColumnLength = next.filter((i) => i.status === targetStatus).length;
      const clampedIndex = Math.max(0, Math.min(targetIndex, targetColumnLength));

      const rebuilt: Issue[] = [];
      for (const status of STATUSES.map((s) => s.id)) {
        let col = next.filter((i) => i.status === status);
        if (status === targetStatus) {
          col.splice(clampedIndex, 0, moving);
        }
        col = col.map((item, idx) => ({
          ...item,
          position: idx,
          updated_at: item.id === moving.id ? nowIso() : item.updated_at,
        }));
        rebuilt.push(...col);
      }

      setIssues(rebuilt);

      return {
        key: sourceIssue.key,
        previousStatus: sourceIssue.status,
        nextStatus: targetStatus,
        position: clampedIndex,
      };
    },
    [issues]
  );

  const persistMove = useCallback(
    async (issueId: string, status: IssueStatus, position: number) => {
      const { error } = await supabase.rpc("move_issue", {
        p_issue_id: issueId,
        p_status: status,
        p_position: position,
      });

      if (error) {
        const fallback = await supabase
          .from("issues")
          .update({ status, position, updated_at: nowIso() })
          .eq("id", issueId);

        if (fallback.error) console.error("Persist move failed", fallback.error);
      }
    },
    [supabase]
  );

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      if (active.id === over.id) return;

      const activeParsed = parseDragId(String(active.id));
      const overParsed = parseDragId(String(over.id));
      if (!activeParsed || activeParsed.type !== "issue") return;

      const issueId = activeParsed.value;
      const sourceIssue = issues.find((i) => i.id === issueId);
      if (!sourceIssue) return;

      let targetStatus: IssueStatus = sourceIssue.status;
      let targetIndex = grouped[sourceIssue.status].length;

      if (overParsed?.type === "column") {
        targetStatus = overParsed.value as IssueStatus;
        targetIndex = grouped[targetStatus].length;
      }

      if (overParsed?.type === "issue") {
        const overIssue = issues.find((i) => i.id === overParsed.value);
        if (overIssue) {
          targetStatus = overIssue.status;
          const targetCol = grouped[targetStatus];
          const idx = targetCol.findIndex((i) => i.id === overIssue.id);
          targetIndex = idx >= 0 ? idx : targetCol.length;
        }
      }

      const result = reorderLocally(issueId, targetStatus, targetIndex);
      if (!result) return;

      await persistMove(issueId, targetStatus, result.position);
      await persistActivity("Moved issue", {
        key: result.key,
        from: result.previousStatus,
        to: result.nextStatus,
        position: result.position,
      });
    },
    [grouped, issues, persistActivity, persistMove, reorderLocally]
  );

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.error("Sign out failed", error);
  }, [supabase]);

  const selectedLock = selectedIssue ? issueLocks[selectedIssue.id] : undefined;
  const selectedLockedByOther = selectedLock && selectedLock.userId !== me.id;

  return (
    <div className="h-screen w-full bg-background text-foreground">
      <div className="h-full grid grid-rows-[auto_1fr]">
        <header className="border-b bg-card/70 backdrop-blur px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">Project Alpha</h1>
              <Badge variant={connected ? "default" : "secondary"} className="gap-1">
                {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {connected ? "Realtime Connected" : "Connecting…"}
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                {onlineUsers.slice(0, 6).map((u) => (
                  <Avatar key={u.id} className="h-7 w-7 border-2 border-background">
                    <AvatarFallback className="text-[10px]">{initials(u.name)}</AvatarFallback>
                  </Avatar>
                ))}
              </div>

              <Badge variant="outline" className="gap-1">
                <Users className="h-3.5 w-3.5" />
                {onlineUsers.length} online
              </Badge>

              <Badge variant="secondary" className="max-w-[220px] truncate">
                {me.name}
              </Badge>

              <Button variant="outline" onClick={signOut} className="gap-2">
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>

              <Dialog open={newIssueOpen} onOpenChange={setNewIssueOpen}>
                <DialogTrigger asChild>
                  <Button className="rounded-2xl gap-1">
                    <Plus className="h-4 w-4" />
                    New issue
                  </Button>
                </DialogTrigger>
                <DialogContent className="rounded-2xl">
                  <DialogHeader>
                    <DialogTitle>Create issue</DialogTitle>
                    <DialogDescription>
                      New issues are synced across connected users in real time.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-3">
                    <Input
                      placeholder="Issue title"
                      value={newIssueTitle}
                      onChange={(e) => setNewIssueTitle(e.target.value)}
                    />

                    <Textarea
                      placeholder="Description"
                      value={newIssueDesc}
                      onChange={(e) => setNewIssueDesc(e.target.value)}
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <Select
                        value={newIssueStatus}
                        onValueChange={(v) => setNewIssueStatus(v as IssueStatus)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={newIssuePriority}
                        onValueChange={(v) => setNewIssuePriority(v as IssuePriority)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Priority" />
                        </SelectTrigger>
                        <SelectContent>
                          {PRIORITIES.map((p) => (
                            <SelectItem key={p} value={p} className="capitalize">
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <Button className="w-full" onClick={createIssue}>
                      Create
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </header>

        <div className="h-full grid grid-cols-[290px_1fr_300px] overflow-hidden">
          <aside className="border-r p-3 space-y-4 overflow-auto">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Filter className="h-4 w-4" /> Filters
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Search issues"
                    value={filters.q}
                    onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                  />
                </div>

                <Select
                  value={filters.priority}
                  onValueChange={(v) => setFilters((f) => ({ ...f, priority: v as Filters["priority"] }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All priorities</SelectItem>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p} className="capitalize">
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={filters.assignee}
                  onValueChange={(v) => setFilters((f) => ({ ...f, assignee: v as Filters["assignee"] }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Assignee" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All assignees</SelectItem>
                    {assigneeOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[420px] pr-2">
                  <div className="space-y-3">
                    {activities.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No activity yet.</p>
                    ) : (
                      activities.slice(0, 50).map((a) => (
                        <div key={a.id} className="text-sm">
                          <p>
                            <span className="font-medium">{resolveProfileName(a.actor, memberDirectory[a.actor_id])}</span> {a.action}
                          </p>
                          <p className="text-xs text-muted-foreground">{formatDateTime(a.created_at)}</p>
                          <Separator className="mt-2" />
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </aside>

          <main className="overflow-auto p-4">
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
              <div className="flex gap-3 min-w-max pb-4">
                {STATUSES.map((s) => (
                  <ColumnLane
                    key={s.id}
                    status={s.id}
                    label={s.label}
                    issues={grouped[s.id]}
                    issueLocks={issueLocks}
                    me={me}
                    memberDirectory={memberDirectory}
                    onSelectIssue={(issue) => setSelectedIssueId(issue.id)}
                  />
                ))}
              </div>
            </DndContext>
          </main>

          <aside className="border-l p-3 overflow-auto">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-sm">Realtime collaboration</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>• Identity comes from Supabase Auth session.</p>
                <p>• Presence uses authenticated user ids.</p>
                <p>• Issue locks are user-id based.</p>
                <p>• All writes are attributable to actor_id/author_id.</p>
                <p>• Use auth.uid() in RLS policies to enforce tenancy.</p>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>

      <Sheet open={Boolean(selectedIssue)} onOpenChange={(open) => !open && setSelectedIssueId(null)}>
        <SheetContent className="w-[620px] sm:max-w-[620px] p-0">
          {selectedIssue ? (
            <div className="h-full flex flex-col">
              <SheetHeader className="p-5 border-b">
                <SheetTitle className="flex items-center gap-2">
                  {selectedIssue.key}
                  <Badge variant={priorityVariant[selectedIssue.priority]} className="capitalize">
                    {selectedIssue.priority}
                  </Badge>
                  {selectedLockedByOther ? (
                    <Badge variant="outline">Locked by {selectedLock?.userName}</Badge>
                  ) : null}
                </SheetTitle>
                <SheetDescription>Live collaborative issue view</SheetDescription>
              </SheetHeader>

              <div className="p-5 space-y-4 overflow-auto">
                <Input
                  value={selectedIssue.title}
                  disabled={Boolean(selectedLockedByOther)}
                  onChange={(e) => patchIssue(selectedIssue.id, { title: e.target.value }, "Edited issue title")}
                />

                <Textarea
                  value={selectedIssue.description || ""}
                  disabled={Boolean(selectedLockedByOther)}
                  onChange={(e) =>
                    patchIssue(selectedIssue.id, { description: e.target.value }, "Edited issue description")
                  }
                  rows={6}
                />

                <div className="grid grid-cols-2 gap-3">
                  <Select
                    value={selectedIssue.status}
                    onValueChange={(v) => patchIssue(selectedIssue.id, { status: v as IssueStatus }, "Changed status")}
                    disabled={Boolean(selectedLockedByOther)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={selectedIssue.priority}
                    onValueChange={(v) =>
                      patchIssue(selectedIssue.id, { priority: v as IssuePriority }, "Changed priority")
                    }
                    disabled={Boolean(selectedLockedByOther)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Priority" />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p} className="capitalize">
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Select
                  value={selectedIssue.assignee_id || "unassigned"}
                  onValueChange={(value) =>
                    patchIssue(
                      selectedIssue.id,
                      { assignee_id: value === "unassigned" ? null : value },
                      "Changed assignee"
                    )
                  }
                  disabled={Boolean(selectedLockedByOther)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Assignee" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {assigneeOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Comments</h3>
                  <ScrollArea className="h-[220px] rounded-xl border p-3">
                    <div className="space-y-3">
                      {(commentsByIssue[selectedIssue.id] || []).map((c) => (
                        <motion.div key={c.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                          <div className="text-sm">
                            <p className="font-medium">{resolveProfileName(c.author, memberDirectory[c.author_id])}</p>
                            <p className="text-muted-foreground whitespace-pre-wrap">{c.body}</p>
                            <p className="text-xs text-muted-foreground mt-1">{formatDateTime(c.created_at)}</p>
                          </div>
                          <Separator className="mt-2" />
                        </motion.div>
                      ))}

                      {(!commentsByIssue[selectedIssue.id] || commentsByIssue[selectedIssue.id].length === 0) && (
                        <p className="text-sm text-muted-foreground">No comments yet.</p>
                      )}
                    </div>
                  </ScrollArea>

                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Write a comment"
                      value={draftComment}
                      onChange={(e) => setDraftComment(e.target.value)}
                    />
                    <Button onClick={addComment} className="self-end gap-1">
                      <Send className="h-4 w-4" />
                      Send
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default function RealtimeJiraLikeManager() {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          console.error("getSession failed", error);
          setSession(null);
        } else {
          setSession(data.session ?? null);
        }
      })
      .finally(() => {
        if (mounted) setAuthLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  if (!supabase) {
    return (
      <div className="h-screen grid place-items-center p-6 bg-background">
        <Card className="w-full max-w-xl rounded-2xl">
          <CardHeader>
            <CardTitle>Supabase client not configured</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Set environment variables:</p>
            <p className="font-mono">VITE_SUPABASE_URL</p>
            <p className="font-mono">VITE_SUPABASE_ANON_KEY</p>
            <p>Then reload the app to enable authenticated realtime mode.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="h-screen grid place-items-center bg-background">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading session...
        </div>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen supabase={supabase} />;
  }

  return <RealtimeBoard supabase={supabase} session={session} />;
}

/**
 * -----------------------------------------------------------------------------
 * Backend notes (Supabase / Postgres)
 * -----------------------------------------------------------------------------
 * 1) Enable Auth providers in Supabase dashboard:
 *    - Email/Password
 *    - Google (OAuth)
 *
 * 2) Recommended relational schema (ids + profile tables):
 *
 * profiles(
 *   id uuid primary key references auth.users(id) on delete cascade,
 *   display_name text,
 *   email text,
 *   created_at timestamptz not null default now()
 * );
 *
 * projects(
 *   id text primary key,
 *   name text not null,
 *   owner_id uuid not null references profiles(id),
 *   created_at timestamptz not null default now()
 * );
 *
 * project_members(
 *   project_id text not null references projects(id) on delete cascade,
 *   user_id uuid not null references profiles(id) on delete cascade,
 *   role text not null default 'member', -- owner | manager | member | viewer
 *   created_at timestamptz not null default now(),
 *   primary key(project_id, user_id)
 * );
 *
 * issues(
 *   id text primary key,
 *   project_id text not null references projects(id) on delete cascade,
 *   key text not null,
 *   title text not null,
 *   description text not null default '',
 *   status text not null,
 *   priority text not null,
 *   assignee_id uuid null references profiles(id),
 *   reporter_id uuid not null references profiles(id),
 *   story_points int null,
 *   due_date timestamptz null,
 *   position int not null default 0,
 *   created_at timestamptz not null default now(),
 *   updated_at timestamptz not null default now()
 * );
 *
 * comments(
 *   id text primary key,
 *   project_id text not null references projects(id) on delete cascade,
 *   issue_id text not null references issues(id) on delete cascade,
 *   author_id uuid not null references profiles(id),
 *   body text not null,
 *   created_at timestamptz not null default now()
 * );
 *
 * activities(
 *   id text primary key,
 *   project_id text not null references projects(id) on delete cascade,
 *   actor_id uuid not null references profiles(id),
 *   action text not null,
 *   metadata jsonb,
 *   created_at timestamptz not null default now()
 * );
 *
 * 3) Enforce authorization with RLS (critical):
 *
 * alter table profiles enable row level security;
 * alter table projects enable row level security;
 * alter table project_members enable row level security;
 * alter table issues enable row level security;
 * alter table comments enable row level security;
 * alter table activities enable row level security;
 *
 * create policy "projects_select_member"
 *   on projects for select
 *   using (
 *     exists (
 *       select 1 from project_members pm
 *       where pm.project_id = projects.id
 *         and pm.user_id = auth.uid()
 *     )
 *   );
 *
 * create policy "issues_select_member"
 *   on issues for select
 *   using (
 *     exists (
 *       select 1 from project_members pm
 *       where pm.project_id = issues.project_id
 *         and pm.user_id = auth.uid()
 *     )
 *   );
 *
 * create policy "issues_insert_member"
 *   on issues for insert
 *   with check (
 *     reporter_id = auth.uid()
 *     and exists (
 *       select 1 from project_members pm
 *       where pm.project_id = issues.project_id
 *         and pm.user_id = auth.uid()
 *         and pm.role in ('owner', 'manager', 'member')
 *     )
 *   );
 *
 * create policy "issues_update_editor_role"
 *   on issues for update
 *   using (
 *     exists (
 *       select 1 from project_members pm
 *       where pm.project_id = issues.project_id
 *         and pm.user_id = auth.uid()
 *         and pm.role in ('owner', 'manager', 'member')
 *     )
 *   )
 *   with check (
 *     exists (
 *       select 1 from project_members pm
 *       where pm.project_id = issues.project_id
 *         and pm.user_id = auth.uid()
 *         and pm.role in ('owner', 'manager', 'member')
 *     )
 *   );
 *
 * create policy "issues_delete_admin_roles"
 *   on issues for delete
 *   using (
 *     exists (
 *       select 1 from project_members pm
 *       where pm.project_id = issues.project_id
 *         and pm.user_id = auth.uid()
 *         and pm.role in ('owner', 'manager')
 *     )
 *   );
 *
 * create policy "comments_member_rw"
 *   on comments for all
 *   using (
 *     exists (
 *       select 1 from project_members pm
 *       where pm.project_id = comments.project_id
 *         and pm.user_id = auth.uid()
 *     )
 *   )
 *   with check (
 *     author_id = auth.uid()
 *     and exists (
 *       select 1 from project_members pm
 *       where pm.project_id = comments.project_id
 *         and pm.user_id = auth.uid()
 *         and pm.role in ('owner', 'manager', 'member')
 *     )
 *   );
 *
 * Apply equivalent policies for activities and project_members so only project members can read/write project-scoped rows.
 *
 * 4) Keep realtime enabled on issues/comments/activities tables.
 * 5) (Recommended) Implement move_issue(...) RPC as SECURITY DEFINER for safe concurrent ordering.
 */
