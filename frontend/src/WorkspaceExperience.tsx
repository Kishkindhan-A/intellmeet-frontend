import { useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Search,
  Users,
  Video,
} from 'lucide-react';
import type { Meeting, Task, Member } from './types';
import { Modal, Empty } from './ui';

export function WorkspaceSearch({
  meetings,
  tasks,
  members,
  close,
  openMeeting,
  openTasks,
  openTeam,
}: {
  meetings: Meeting[];
  tasks: Task[];
  members: Member[];
  close: () => void;
  openMeeting: (m: Meeting) => void;
  openTasks: () => void;
  openTeam: () => void;
}) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const results = [
    ...meetings
      .filter((m) => m.title.toLowerCase().includes(term))
      .map((m) => ({
        id: m._id,
        title: m.title,
        detail: `Meeting · ${m.status}`,
        icon: Video,
        action: () => openMeeting(m),
      })),
    ...tasks
      .filter((t) => t.title.toLowerCase().includes(term))
      .map((t) => ({
        id: t._id,
        title: t.title,
        detail: `Action item · ${t.status.replace('_', ' ')}`,
        icon: CheckSquare,
        action: openTasks,
      })),
    ...members
      .filter((m) => `${m.user?.name} ${m.user?.email}`.toLowerCase().includes(term))
      .map((m) => ({
        id: m.userId,
        title: m.user?.name || 'Teammate',
        detail: `Team · ${m.role}`,
        icon: Users,
        action: openTeam,
      })),
  ].slice(0, 12);
  return (
    <Modal title="Search your workspace" close={close}>
      <label className="command-input">
        <Search size={20} />
        <input
          autoFocus
          aria-label="Search workspace"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a meeting, action item, or teammate…"
        />
      </label>
      <p className="search-hint">
        Results from the current workspace. Use Tab to navigate and Enter to open.
      </p>
      <div className="command-results">
        {results.map((r) => (
          <button
            key={`${r.detail}-${r.id}`}
            onClick={() => {
              close();
              r.action();
            }}
          >
            <r.icon size={19} />
            <span>
              <strong>{r.title}</strong>
              <small>{r.detail}</small>
            </span>
            <ArrowRight size={16} />
          </button>
        ))}
      </div>
      {!results.length && (
        <Empty title="No matches" detail="Try a different title or teammate name." />
      )}
    </Modal>
  );
}

export function GettingStarted({
  meetings,
  tasks,
  members,
  schedule,
  invite,
  createTask,
  canInvite,
}: {
  meetings: Meeting[];
  tasks: Task[];
  members: Member[];
  schedule: () => void;
  invite: () => void;
  createTask: () => void;
  canInvite: boolean;
}) {
  const steps = [
    {
      title: 'Plan a conversation',
      detail: 'Schedule your first team meeting',
      done: meetings.length > 0,
      action: schedule,
      icon: CalendarDays,
    },
    {
      title: 'Bring your team together',
      detail: 'Invite a teammate to this workspace',
      done: members.length > 1,
      action: invite,
      icon: Users,
    },
    {
      title: 'Make the next step clear',
      detail: 'Create an action item with an owner',
      done: tasks.length > 0,
      action: createTask,
      icon: CheckSquare,
    },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <details className="setup-panel" aria-label="Workspace setup">
      <summary className="setup-heading">
        <div>
          <span className="eyebrow">LET’S GET YOU SETTLED</span>
          <h2>A good start, in three small steps.</h2>
        </div>
        <span>{steps.filter((s) => s.done).length} of 3 complete · View checklist</span>
      </summary>
      <div className="setup-steps">
        {steps.map((s, i) => (
          <button
            key={s.title}
            className={s.done ? 'complete' : ''}
            disabled={s.done || (i === 1 && !canInvite)}
            onClick={s.action}
          >
            <span className="step-icon">{s.done ? <Check size={19} /> : <s.icon size={19} />}</span>
            <span>
              <strong>{s.title}</strong>
              <small>{s.done ? 'Completed' : s.detail}</small>
            </span>
            {!s.done && <ArrowRight size={16} />}
          </button>
        ))}
      </div>
    </details>
  );
}

export function WeekAgenda({
  meetings,
  open,
}: {
  meetings: Meeting[];
  open: (m: Meeting) => void;
}) {
  const [anchor] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  });
  const [offset, setOffset] = useState(0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(anchor);
    d.setDate(d.getDate() + offset * 7 + i);
    return d;
  });
  const [today] = useState(() => new Date().toDateString());
  return (
    <section className="panel week-panel">
      <div className="panel-heading">
        <div>
          <h2>Your week, at a glance</h2>
          <p>
            {days[0].toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} –{' '}
            {days[6].toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}{' '}
            · Local time
          </p>
        </div>
        <div className="week-controls">
          <button
            className="icon-button"
            aria-label="Previous week"
            onClick={() => setOffset((o) => o - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button className="secondary compact" onClick={() => setOffset(0)}>
            This week
          </button>
          <button
            className="icon-button"
            aria-label="Next week"
            onClick={() => setOffset((o) => o + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="week-grid">
        {days.map((d) => (
          <div
            className={`week-day ${d.toDateString() === today ? 'today' : ''}`}
            key={d.toISOString()}
          >
            <div className="day-label">
              <span>{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <strong>{d.getDate()}</strong>
            </div>
            {meetings
              .filter(
                (m) =>
                  m.status !== 'cancelled' &&
                  new Date(m.startsAt).toDateString() === d.toDateString(),
              )
              .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
              .map((m) => (
                <button className={`agenda-event ${m.status}`} key={m._id} onClick={() => open(m)}>
                  <small>
                    {new Date(m.startsAt).toLocaleTimeString(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}{' '}
                    · {m.durationMinutes} min
                  </small>
                  <strong>{m.title}</strong>
                  <span>
                    {m.status === 'live'
                      ? 'Live now'
                      : m.status === 'ended'
                        ? 'View recap'
                        : 'View meeting'}
                  </span>
                </button>
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}
