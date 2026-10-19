import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Video,
  LayoutDashboard,
  CalendarDays,
  CheckSquare,
  Users,
  Settings,
  HelpCircle,
  Bell,
  Search,
  Plus,
  ChevronDown,
  ArrowUpRight,
  Clock,
  Sparkles,
  LogOut,
  Menu,
  X,
  Check,
  ShieldCheck,
} from "lucide-react";
import { api, restoreSession, clearSession, ApiError } from "./api";
import type { User } from "./api";
import type { Workspace, Meeting, Task, Member } from "./types";
import { Auth } from "./Auth";
import { StudioLanding } from "./StudioLanding";
const MeetingRoom = lazy(() =>
  import("./MeetingRoom").then((m) => ({ default: m.MeetingRoom })),
);
import { SettingsPage, HelpPage, Notifications } from "./Pages";
import { Modal, Empty, Loading, ErrorBox, Submit, dateLabel } from "./ui";
import "./App.css";
import "./Signature.css";
import "./WorkspacePolish.css";
import { SignalMark, MeetingSpotlight } from "./Brand";
import {
  WorkspaceSearch,
  GettingStarted,
  WeekAgenda,
} from "./WorkspaceExperience";
import { useSearchShortcut } from "./useSearchShortcut";
import { navigate, usePathname } from "./navigation";

const authPaths = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/auth/callback",
];
type Page =
  | "overview"
  | "meetings"
  | "tasks"
  | "team"
  | "settings"
  | "help"
  | "notifications";
const nav = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "meetings", label: "Meetings", icon: CalendarDays },
  { id: "tasks", label: "Action items", icon: CheckSquare },
  { id: "team", label: "Your team", icon: Users },
] as const;
export default function App() {
  const path = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [boot, setBoot] = useState(true);
  const [error, setError] = useState("");
  const signedInId = user?.id;
  useEffect(() => {
    if (
      !boot &&
      !user &&
      path !== "/" &&
      path !== "/invite" &&
      !authPaths.includes(path)
    ) {
      navigate(
        ["/profile", "/settings"].includes(path)
          ? "/login?next=profile"
          : "/login",
        true,
      );
    }
  }, [boot, user, path]);
  useEffect(() => {
    if (!signedInId) return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (!active || checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const result = await api<{ user: User }>("/auth/me");
        if (active)
          setUser((current) =>
            current?.id === result.user.id ? result.user : current,
          );
      } catch {
        // The API clears expired sessions. Temporary network failures do not sign users out.
      } finally {
        checking = false;
      }
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [signedInId]);
  useEffect(() => {
    let active = true;
    let endedSession = false;
    const ended = (event: Event) => {
      endedSession = true;
      setUser(null);
      setError("");
      const expired =
        (event as CustomEvent<{ reason?: string }>).detail?.reason ===
        "expired";
      if (expired || !authPaths.includes(location.pathname))
        navigate(expired ? "/login?notice=session-expired" : "/login", true);
    };
    window.addEventListener("session-ended", ended);
    restoreSession()
      .then(() => api<{ user: User }>("/auth/me"))
      .then((r) => {
        if (active && !endedSession) setUser(r.user);
      })
      .catch((e) => {
        if (active && !(e instanceof ApiError && e.status === 401))
          setError(
            "Account services are temporarily unavailable. Please try again shortly.",
          );
      })
      .finally(() => {
        if (active) setBoot(false);
      });
    return () => {
      active = false;
      window.removeEventListener("session-ended", ended);
    };
  }, []);
  if (!user && path === "/") return <StudioLanding />;
  if (boot && !authPaths.includes(path)) return <Loading />;
  if (!user || authPaths.includes(path))
    return (
      <>
        {error && <div className="connection-banner">{error}</div>}
        <Auth
          key={path + location.search}
          ready={(nextUser) => {
            setError("");
            setUser(nextUser);
            if (location.pathname !== "/invite")
              navigate(
                new URLSearchParams(location.search).get("next") === "profile"
                  ? "/profile"
                  : "/workspace",
                true,
              );
          }}
        />
      </>
    );
  return <WorkspaceApp user={user} onUserChange={setUser} />;
}
function WorkspaceApp({
  user,
  onUserChange,
}: {
  user: User;
  onUserChange: (user: User) => void;
}) {
  const [page, setPage] = useState<Page>(() =>
    ["/profile", "/settings"].includes(location.pathname)
      ? "settings"
      : "overview",
  );
  const [today] = useState(() => new Date());
  const [defaultStart] = useState(() =>
    new Date(Date.now() + 3600000 - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16),
  );
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<
    "workspace" | "meeting" | "task" | "invite" | null
  >(null);
  const [room, setRoom] = useState<Meeting | null>(null);
  const [query, setQuery] = useState("");
  const [mobile, setMobile] = useState(false);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const showSearch = useCallback(() => setSearchOpen(true), []);
  useSearchShortcut(showSearch);
  const workspace = workspaces.find((w) => w._id === workspaceId);
  const admin = workspace?.role !== "member";
  const loadWorkspaces = useCallback(async () => {
    const r = await api<{ workspaces: Workspace[] }>("/workspaces");
    setWorkspaces(r.workspaces);
    setWorkspaceId((current) =>
      r.workspaces.some((w) => w._id === current)
        ? current
        : r.workspaces[0]?._id || "",
    );
  }, []);
  useEffect(() => {
    loadWorkspaces()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [loadWorkspaces]);
  const reload = useCallback(async () => {
    if (!workspaceId) return;
    const [m, t, p] = await Promise.all([
      api<{ meetings: Meeting[] }>(
        `/workspaces/${workspaceId}/meetings?limit=100`,
      ),
      api<{ tasks: Task[] }>(`/workspaces/${workspaceId}/tasks?limit=100`),
      api<{ members: Member[] }>(`/workspaces/${workspaceId}/members`),
    ]);
    setMeetings(m.meetings);
    setTasks(t.tasks);
    setMembers(p.members);
  }, [workspaceId]);
  useEffect(() => {
    setMeetings([]);
    setTasks([]);
    setMembers([]);
    if (workspaceId) {
      setLoading(true);
      reload()
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [workspaceId, reload]);
  const act = useCallback(
    async (fn: () => Promise<unknown>, message?: string) => {
      setError("");
      setBusy(true);
      try {
        await fn();
        await reload();
        if (message) setNotice(message);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to complete request");
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );
  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get("token");
    if (location.pathname === "/invite" && token) {
      history.replaceState(null, "", "/");
      void act(async () => {
        await api("/invitations/accept", "POST", { token });
        await loadWorkspaces();
      }, "Invitation accepted.");
    }
  }, [act, loadWorkspaces]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (modal === "workspace") {
        const r = await api<{ workspace: Workspace }>("/workspaces", "POST", {
          name: d.get("name"),
        });
        await loadWorkspaces();
        setWorkspaceId(r.workspace._id);
      } else if (modal === "meeting") {
        const r = await api<{ meeting: Meeting }>(
          `/workspaces/${workspaceId}/meetings`,
          "POST",
          {
            title: d.get("title"),
            description: d.get("description"),
            startsAt: new Date(String(d.get("startsAt"))).toISOString(),
            durationMinutes: Number(d.get("durationMinutes")),
            visibility: "workspace",
            invitees: [],
            lobbyEnabled: d.get("lobby") === "on",
            processingMode:
              d.get("confidential") === "on" ? "confidential" : "standard",
          },
        );
        if (d.get("instant") === "on") {
          await api(`/meetings/${r.meeting._id}/start`, "POST", {});
          setRoom({ ...r.meeting, status: "live" });
        }
        await reload();
      } else if (modal === "task") {
        await api(`/workspaces/${workspaceId}/tasks`, "POST", {
          title: d.get("title"),
          description: d.get("description"),
          priority: d.get("priority"),
          ...(d.get("dueAt")
            ? { dueAt: new Date(String(d.get("dueAt"))).toISOString() }
            : {}),
          ...(d.get("assigneeId") ? { assigneeId: d.get("assigneeId") } : {}),
        });
        await reload();
      } else if (modal === "invite") {
        await api(`/workspaces/${workspaceId}/invitations`, "POST", {
          email: d.get("email"),
          role: d.get("role"),
        });
        setNotice("Invitation sent.");
      }
      setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
    } finally {
      setBusy(false);
    }
  }
  const visibleMeetings = meetings.filter(
    (m) =>
      m.title.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "all" || m.status === filter),
  );
  const upcoming = [...meetings]
    .filter((m) => m.status === "live" || m.status === "scheduled")
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const openTasks = tasks.filter((t) => t.status !== "done");
  if (room && workspace)
    return (
      <Suspense fallback={<Loading />}>
        <MeetingRoom
          meeting={room}
          user={user}
          workspace={workspace}
          members={members}
          close={() => {
            setRoom(null);
            void reload().catch((e) => setError(e.message));
          }}
        />
      </Suspense>
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      {mobile && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <a className="brand" href="/">
          <span className="brand-icon">
            <SignalMark />
          </span>
          IntellMeet<span className="brand-ai">AI</span>
        </a>
        <button
          className="mobile-close icon-button"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        >
          <X />
        </button>
        <div className="workspace-select">
          <span className="workspace-avatar">
            {workspace?.name.charAt(0) || "W"}
          </span>
          <label>
            <small>WORKSPACE</small>
            <select
              aria-label="Current workspace"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
            >
              {!workspaces.length && <option value="">No workspace yet</option>}
              {workspaces.map((w) => (
                <option key={w._id} value={w._id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <ChevronDown size={15} />
        </div>
        <button className="workspace-add" onClick={() => setModal("workspace")}>
          <Plus size={14} />
          New workspace
        </button>
        <span className="nav-label">YOUR WORKSPACE</span>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              aria-current={page === n.id ? "page" : undefined}
              onClick={() => {
                setPage(n.id);
                setMobile(false);
                setQuery("");
                setFilter("all");
              }}
            >
              <n.icon size={19} />
              {n.label}
              {n.id === "tasks" && openTasks.length > 0 && (
                <span className="nav-count">{openTasks.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="focus-card">
            <Sparkles size={21} />
            <h4>More from every meeting</h4>
            <p>
              Turn shared ideas into clear next steps, with your team in
              control.
            </p>
            <span>
              Thoughtful collaboration
              <ArrowUpRight size={15} />
            </span>
          </div>
          <nav>
            <button
              className={page === "settings" ? "active" : ""}
              onClick={() => setPage("settings")}
            >
              <Settings size={18} />
              Settings
            </button>
            <button
              className={page === "help" ? "active" : ""}
              onClick={() => setPage("help")}
            >
              <HelpCircle size={18} />
              Help & support
            </button>
          </nav>
          <div className="profile">
            <span className="avatar">{user.name.charAt(0)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{workspace?.role || "Member"}</small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={() =>
                void act(async () => {
                  await api("/auth/logout", "POST", {});
                  clearSession();
                })
              }
              disabled={busy}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </button>
            <span className="breadcrumb">
              Workspace<span>/</span>
              <strong>
                {page === "overview"
                  ? "Overview"
                  : page === "team"
                    ? "Your team"
                    : page === "tasks"
                      ? "Action items"
                      : page.charAt(0).toUpperCase() + page.slice(1)}
              </strong>
            </span>
          </div>
          <div className="topbar-actions">
            <button
              className="workspace-search-trigger"
              onClick={showSearch}
              aria-label="Search workspace"
            >
              <Search size={17} />
              <span>Search workspace</span>
              <kbd>Ctrl K</kbd>
            </button>
            <span className="private-tag">
              <ShieldCheck size={14} />
              Private workspace
            </span>
            <button
              className="icon-button"
              aria-label="Notifications"
              onClick={() => setPage("notifications")}
            >
              <Bell size={20} />
            </button>
            <span className="avatar small">{user.name.charAt(0)}</span>
          </div>
        </header>
        <main id="content" className="content">
          <ErrorBox message={error} />
          {notice && (
            <div className="success notice" role="status">
              {notice}
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {today.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </div>
              <h1>
                {page === "overview"
                  ? `Good ${today.getHours() < 12 ? "morning" : today.getHours() < 18 ? "afternoon" : "evening"}, ${user.name.split(" ")[0]}.`
                  : page === "meetings"
                    ? "Make every conversation count."
                    : page === "tasks"
                      ? "From conversation to action."
                      : page === "team"
                        ? "Better work, together."
                        : page === "settings"
                          ? "Your workspace, your way."
                          : page === "help"
                            ? "A little help goes a long way."
                            : "Stay in the loop."}
              </h1>
              <p>
                {page === "overview"
                  ? "A little clarity for your day. Here’s what’s happening with your team."
                  : page === "meetings"
                    ? "Plan, connect, and keep your team moving forward."
                    : page === "tasks"
                      ? "Clear ownership. Shared progress. Nothing left behind."
                      : page === "team"
                        ? "The people making things happen."
                        : "Manage your IntellMeet experience."}
              </p>
            </div>
            {workspaceId &&
              ["overview", "meetings", "tasks", "team"].includes(page) && (
                <button
                  className="primary"
                  onClick={() =>
                    setModal(
                      page === "tasks"
                        ? "task"
                        : page === "team"
                          ? "invite"
                          : "meeting",
                    )
                  }
                  disabled={page === "team" && !admin}
                >
                  <Plus size={18} />
                  {page === "tasks"
                    ? "New action item"
                    : page === "team"
                      ? "Invite teammate"
                      : "New meeting"}
                </button>
              )}
          </div>
          {page === "settings" ? (
            <SettingsPage
              user={user}
              workspace={workspace}
              onUserChange={onUserChange}
              update={() => void loadWorkspaces()}
            />
          ) : loading ? (
            <Loading />
          ) : !workspaceId ? (
            <Empty
              title="Your next chapter starts here"
              detail="Create a workspace to bring your meetings, people, and projects together."
              action={
                <button
                  className="primary"
                  onClick={() => setModal("workspace")}
                >
                  <Plus size={18} />
                  Create your workspace
                </button>
              }
            />
          ) : (
            <>
              {page === "overview" && (
                <>
                  <MeetingSpotlight
                    meeting={
                      upcoming.find((m) => m.status === "live") || upcoming[0]
                    }
                    open={setRoom}
                    schedule={() => setModal("meeting")}
                  />
                  <GettingStarted
                    meetings={meetings}
                    tasks={tasks}
                    members={members}
                    schedule={() => setModal("meeting")}
                    invite={() => setModal("invite")}
                    createTask={() => setModal("task")}
                    canInvite={admin}
                  />
                  <div className="stats-grid">
                    {[
                      {
                        label: "Upcoming meetings",
                        value: upcoming.length,
                        icon: CalendarDays,
                        foot: "Ready when you are",
                        color: "mint",
                      },
                      {
                        label: "Open action items",
                        value: openTasks.length,
                        icon: CheckSquare,
                        foot: "Your team’s next steps",
                        color: "peach",
                      },
                      {
                        label: "Team members",
                        value: members.length,
                        icon: Users,
                        foot: "One connected workspace",
                        color: "lavender",
                      },
                      {
                        label: "Completed meetings",
                        value: meetings.filter((m) => m.status === "ended")
                          .length,
                        icon: Video,
                        foot: "Conversations that count",
                        color: "blue",
                      },
                    ].map((s) => (
                      <article className="stat-card" key={s.label}>
                        <div>
                          <span>{s.label}</span>
                          <s.icon
                            className={`stat-icon ${s.color}`}
                            size={38}
                          />
                        </div>
                        <strong>{s.value}</strong>
                        <small>{s.foot}</small>
                      </article>
                    ))}
                  </div>
                  <WeekAgenda meetings={meetings} open={setRoom} />
                  <div className="overview-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>On the agenda</h2>
                          <p>Your upcoming and live conversations</p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => setPage("meetings")}
                        >
                          View all
                          <ArrowUpRight size={15} />
                        </button>
                      </div>
                      {upcoming.length ? (
                        upcoming
                          .slice(0, 4)
                          .map((m) => (
                            <MeetingCard
                              key={m._id}
                              meeting={m}
                              open={() => setRoom(m)}
                            />
                          ))
                      ) : (
                        <Empty
                          title="A little breathing room"
                          detail="There are no upcoming meetings. Schedule a conversation when you’re ready."
                          action={
                            <button
                              className="secondary"
                              onClick={() => setModal("meeting")}
                            >
                              Schedule a meeting
                            </button>
                          }
                        />
                      )}
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Keep things moving</h2>
                          <p>Action items that need attention</p>
                        </div>
                        <CheckSquare size={20} />
                      </div>
                      {openTasks.length ? (
                        openTasks.slice(0, 5).map((t) => (
                          <TaskRow
                            key={t._id}
                            task={t}
                            busy={busy}
                            update={() =>
                              void act(() =>
                                api(
                                  `/workspaces/${workspaceId}/tasks/${t._id}`,
                                  "PATCH",
                                  {
                                    status: "done",
                                    version: t.version,
                                  },
                                ),
                              )
                            }
                          />
                        ))
                      ) : (
                        <Empty
                          title="All clear for now"
                          detail="Create an action item or accept one from a meeting summary."
                        />
                      )}
                      <button
                        className="panel-footer"
                        onClick={() => setPage("tasks")}
                      >
                        See all action items
                        <ArrowUpRight size={15} />
                      </button>
                    </section>
                  </div>
                  <section className="insight-banner">
                    <div className="insight-icon">
                      <Sparkles size={26} />
                    </div>
                    <div>
                      <span className="eyebrow">
                        A LITTLE LESS ADMIN. A LOT MORE CLARITY.
                      </span>
                      <h2>Let the conversation lead to something.</h2>
                      <p>
                        Review transcripts, explore summaries, and decide what
                        happens next.
                      </p>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => {
                        setPage("meetings");
                        setFilter("ended");
                      }}
                    >
                      Explore past meetings
                      <ArrowUpRight size={16} />
                    </button>
                  </section>
                </>
              )}
              {page === "meetings" && (
                <>
                  <WeekAgenda meetings={meetings} open={setRoom} />
                  <section className="panel">
                    <div className="list-toolbar">
                      <div className="tabs">
                        {["all", "scheduled", "live", "ended", "cancelled"].map(
                          (f) => (
                            <button
                              key={f}
                              className={filter === f ? "selected" : ""}
                              aria-pressed={filter === f}
                              onClick={() => setFilter(f)}
                            >
                              {f === "all"
                                ? "All meetings"
                                : f.charAt(0).toUpperCase() + f.slice(1)}
                            </button>
                          ),
                        )}
                      </div>
                      <label className="search-box">
                        <Search size={17} />
                        <input
                          aria-label="Search meetings"
                          placeholder="Search meetings…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                    </div>
                    {visibleMeetings.length ? (
                      visibleMeetings.map((m) => (
                        <MeetingCard
                          key={m._id}
                          meeting={m}
                          open={() => setRoom(m)}
                        />
                      ))
                    ) : (
                      <Empty
                        title="No meetings here yet"
                        detail="Try another filter or schedule your first conversation."
                      />
                    )}
                  </section>
                </>
              )}
              {page === "tasks" && (
                <div className="kanban">
                  {(["todo", "in_progress", "done"] as const).map((status) => (
                    <section key={status}>
                      <div className="column-title">
                        <span className={`status-dot ${status}`} />
                        <h2>
                          {status === "todo"
                            ? "To do"
                            : status === "in_progress"
                              ? "In progress"
                              : "Done"}
                        </h2>
                        <span>
                          {tasks.filter((t) => t.status === status).length}
                        </span>
                      </div>
                      {tasks
                        .filter((t) => t.status === status)
                        .map((t) => (
                          <article className="task-card" key={t._id}>
                            <span className={`badge ${t.priority}`}>
                              {t.priority} priority
                            </span>
                            <h3>{t.title}</h3>
                            {t.description && <p>{t.description}</p>}
                            {t.dueAt && (
                              <small>
                                <Clock size={13} />
                                {dateLabel(t.dueAt)}
                              </small>
                            )}
                            <label
                              className="sr-only"
                              htmlFor={`status-${t._id}`}
                            >
                              Status for {t.title}
                            </label>
                            <select
                              id={`status-${t._id}`}
                              value={t.status}
                              disabled={busy}
                              onChange={(e) =>
                                void act(() =>
                                  api(
                                    `/workspaces/${workspaceId}/tasks/${t._id}`,
                                    "PATCH",
                                    {
                                      status: e.target.value,
                                      version: t.version,
                                    },
                                  ),
                                )
                              }
                            >
                              <option value="todo">To do</option>
                              <option value="in_progress">In progress</option>
                              <option value="done">Done</option>
                            </select>
                          </article>
                        ))}
                      {!tasks.some((t) => t.status === status) && (
                        <div className="column-empty">Nothing here yet.</div>
                      )}
                    </section>
                  ))}
                </div>
              )}
              {page === "team" && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Workspace members</h2>
                      <p>{members.length} people, one shared space</p>
                    </div>
                  </div>
                  <div className="member-grid">
                    {members.map((m) => (
                      <article key={m.userId} className="member-card">
                        <span className="avatar">
                          {m.user?.name?.charAt(0) || "?"}
                        </span>
                        <h3>{m.user?.name || "Workspace member"}</h3>
                        <p>{m.user?.email}</p>
                        <span className="badge">{m.role}</span>
                      </article>
                    ))}
                  </div>
                </section>
              )}
              {page === "help" && <HelpPage workspaceId={workspaceId} />}
              {page === "notifications" && <Notifications />}
            </>
          )}
          <footer className="content-footer">
            <span>
              <span className="status-dot" />
              Your team. In sync.
            </span>
            <span>IntellMeet · Work better, together.</span>
          </footer>
        </main>
      </div>
      {searchOpen && (
        <WorkspaceSearch
          meetings={meetings}
          tasks={tasks}
          members={members}
          close={() => setSearchOpen(false)}
          openMeeting={setRoom}
          openTasks={() => setPage("tasks")}
          openTeam={() => setPage("team")}
        />
      )}
      {modal && (
        <Modal
          title={
            modal === "workspace"
              ? "Create a workspace"
              : modal === "meeting"
                ? "Schedule a conversation"
                : modal === "task"
                  ? "Create an action item"
                  : "Invite a teammate"
          }
          close={() => {
            setModal(null);
            setError("");
          }}
        >
          <ErrorBox message={error} />
          <form onSubmit={create}>
            {modal === "workspace" ? (
              <label>
                Workspace name
                <input
                  name="name"
                  required
                  maxLength={100}
                  placeholder="e.g. Design team"
                  autoFocus
                />
              </label>
            ) : modal === "invite" ? (
              <>
                <label>
                  Work email
                  <input name="email" type="email" required autoFocus />
                </label>
                <label>
                  Role
                  <select name="role">
                    <option value="member">Member</option>
                    <option value="admin">Administrator</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  {modal === "meeting" ? "Meeting title" : "Action item title"}
                  <input
                    name="title"
                    required
                    maxLength={modal === "meeting" ? 200 : 500}
                    autoFocus
                    placeholder={
                      modal === "meeting"
                        ? "e.g. Weekly team sync"
                        : "What needs to happen next?"
                    }
                  />
                </label>
                <label>
                  Description
                  <textarea
                    name="description"
                    maxLength={5000}
                    placeholder="A little context goes a long way."
                  />
                </label>
                {modal === "meeting" ? (
                  <>
                    <div className="form-row">
                      <label>
                        Date & time
                        <input
                          type="datetime-local"
                          name="startsAt"
                          required
                          defaultValue={defaultStart}
                        />
                      </label>
                      <label>
                        Duration
                        <select name="durationMinutes">
                          <option value="30">30 minutes</option>
                          <option value="60">60 minutes</option>
                          <option value="90">90 minutes</option>
                        </select>
                      </label>
                    </div>
                    <label className="check-label">
                      <input name="lobby" type="checkbox" defaultChecked />
                      Admit guests through a waiting room
                    </label>
                    <label className="check-label">
                      <input name="confidential" type="checkbox" />
                      Confidential: disable recording and AI processing
                    </label>
                    <label className="check-label">
                      <input name="instant" type="checkbox" />
                      Start this meeting immediately
                    </label>
                  </>
                ) : (
                  <>
                    <div className="form-row">
                      <label>
                        Priority
                        <select name="priority">
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="low">Low</option>
                        </select>
                      </label>
                      <label>
                        Due date (optional)
                        <input name="dueAt" type="datetime-local" />
                      </label>
                    </div>
                    <label>
                      Assign to
                      <select name="assigneeId">
                        <option value="">Unassigned</option>
                        {members.map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.user?.name || m.userId}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </>
            )}
            <Submit busy={busy}>
              {modal === "invite" ? "Send invitation" : "Save and continue"}
            </Submit>
          </form>
        </Modal>
      )}
    </div>
  );
}
function MeetingCard({
  meeting: m,
  open,
}: {
  meeting: Meeting;
  open: () => void;
}) {
  const d = new Date(m.startsAt);
  return (
    <article className="meeting-card">
      <div className="date-tile">
        <span>{d.toLocaleDateString(undefined, { month: "short" })}</span>
        <strong>{d.getDate()}</strong>
      </div>
      <div className="meeting-info">
        <h3>{m.title}</h3>
        <p>
          <Clock size={13} />
          {d.toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })}
          <span>·</span>
          {m.durationMinutes} min<span>·</span>
          {m.processingMode === "confidential"
            ? "Confidential"
            : "Team meeting"}
        </p>
      </div>
      <span className={`badge ${m.status}`}>
        {m.status === "live" ? "Live now" : m.status}
      </span>
      <button
        className={
          m.status === "live" ? "primary compact" : "secondary compact"
        }
        onClick={open}
      >
        {m.status === "live"
          ? "Join meeting"
          : m.status === "ended"
            ? "View recap"
            : "Open"}
        <ArrowUpRight size={15} />
      </button>
    </article>
  );
}
function TaskRow({
  task,
  update,
  busy,
}: {
  task: Task;
  update: () => void;
  busy: boolean;
}) {
  return (
    <div className="task-row">
      <button
        className="task-check"
        aria-label={`Complete ${task.title}`}
        onClick={update}
        disabled={busy}
      >
        <Check size={13} />
      </button>
      <div>
        <strong>{task.title}</strong>
        <small>{task.dueAt ? dateLabel(task.dueAt) : "No due date"}</small>
      </div>
      <span className={`badge ${task.priority}`}>{task.priority}</span>
    </div>
  );
}
