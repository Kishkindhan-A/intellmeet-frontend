import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Video,
  Send,
  Users,
  Sparkles,
  FileText,
  MessageSquare,
  ShieldCheck,
  Download,
} from 'lucide-react';
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  ControlBar,
  RoomAudioRenderer,
  ConnectionStateToast,
  useTracks,
  useConnectionState,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import { io } from 'socket.io-client';
import { api, getAccessToken, restoreSession } from './api';
import type { User } from './api';
import type { Workspace, Meeting, Member, Participant, Message, Summary } from './types';
import { Empty, ErrorBox, Submit, dateLabel } from './ui';
export function MeetingRoom({
  meeting: initial,
  user,
  workspace,
  members,
  close,
}: {
  meeting: Meeting;
  user: User;
  workspace: Workspace;
  members: Member[];
  close: () => void;
}) {
  const [meeting, setMeeting] = useState(initial);
  const [tab, setTab] = useState('chat');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [note, setNote] = useState({ text: '', revision: 0 });
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [segments, setSegments] = useState<
    { _id: string; text: string; speakerName?: string; startSeconds: number }[]
  >([]);
  const [assets, setAssets] = useState<
    { _id: string; status: string; kind: string; contentType: string }[]
  >([]);
  const [media, setMedia] = useState<{ url: string; token: string } | null>(null);
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [joined, setJoined] = useState(false);
  const [info, setInfo] = useState('');
  const host = meeting.hostId === user.id || workspace.role !== 'member';
  const participant = participants.find((p) => p.userId === user.id);
  const admitted = participant?.status === 'admitted';
  const label = (id?: string) => members.find((m) => m.userId === id)?.user?.name || 'Team member';
  const refresh = useCallback(async () => {
    const m = await api<{ meeting: Meeting }>(`/meetings/${initial._id}`);
    setMeeting(m.meeting);
    const p = await api<{ participants: Participant[] }>(`/meetings/${initial._id}/participants`);
    setParticipants(p.participants);
    const results = await Promise.allSettled([
      api<{ messages: Message[] }>(`/meetings/${initial._id}/messages`),
      api<{ note: { text: string; revision: number } }>(`/meetings/${initial._id}/notes`),
      api<{ summary: Summary | null }>(`/meetings/${initial._id}/summary`),
      api<{ segments: typeof segments }>(`/meetings/${initial._id}/transcript`),
      api<{ assets: typeof assets }>(`/meetings/${initial._id}/assets`),
    ]);
    const [a, b, c, d, e] = results;
    if (a.status === 'fulfilled')
      setMessages(a.value.messages.filter((m) => !m.deletedAt).reverse());
    if (b.status === 'fulfilled') {
      if (!dirtyRef.current) {
        setNote(b.value.note);
        setDraft(b.value.note.text);
      } else {
        setInfo('Shared notes have unsaved edits. A version conflict will preserve your draft.');
      }
    }
    if (c.status === 'fulfilled') setSummary(c.value.summary);
    if (d.status === 'fulfilled') setSegments(d.value.segments);
    if (e.status === 'fulfilled') setAssets(e.value.assets);
  }, [initial._id]);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      void refresh().catch((e) => setError(e.message));
    }, 15000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (meeting.status !== 'live' || !admitted) return;
    const socket = io(import.meta.env.VITE_SOCKET_URL || location.origin, {
      transports: ['websocket'],
      addTrailingSlash: false,
      auth: { token: getAccessToken() },
    });
    socket.on('connect', () => {
      setInfo((current) =>
        current === 'Live updates unavailable. Meeting data is refreshed periodically.'
          ? ''
          : current,
      );
      socket.emit(
        'meeting.subscribe',
        { meetingId: meeting._id },
        (r: { ok: boolean; error?: { message: string } }) => {
          if (!r.ok) setError(r.error?.message || 'Unable to subscribe');
        },
      );
      void refresh().catch((e) => setError(e.message));
    });
    socket.on('message.created', (m: Message) =>
      setMessages((old) => (old.some((i) => i._id === m._id) ? old : [...old, m])),
    );
    socket.on('message.deleted', () => void refresh().catch((e) => setError(e.message)));
    socket.on('note.updated', () => void refresh().catch((e) => setError(e.message)));
    for (const event of [
      'participant.updated',
      'meeting.admitted',
      'meeting.updated',
      'meeting.ended',
      'summary.ready',
      'transcript.segment',
      'recording.completed',
    ])
      socket.on(event, () => void refresh().catch((e) => setError(e.message)));
    socket.on('meeting.access.revoked', () => {
      setMedia(null);
      setJoined(false);
      setError('Meeting access has been revoked.');
    });
    socket.on('connect_error', () => {
      setInfo('Live updates unavailable. Meeting data is refreshed periodically.');
    });
    const timer = setInterval(() => {
      void restoreSession()
        .then(() => {
          socket.auth = { token: getAccessToken() };
          socket.disconnect().connect();
        })
        .catch(() => {
          socket.disconnect();
          setError('Please sign in again to reconnect.');
        });
    }, 8 * 60000);
    return () => {
      clearInterval(timer);
      socket.disconnect();
    };
  }, [meeting._id, meeting.status, admitted, refresh]);
  async function action(fn: () => Promise<unknown>) {
    setError('');
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to complete action');
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    setBusy(true);
    setError('');
    try {
      setMedia(await api(`/meetings/${meeting._id}/media-token`, 'POST', {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Video unavailable');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="room-shell">
      <header className="room-header">
        <button
          className="secondary compact"
          onClick={async () => {
            if (joined) {
              try {
                await api(`/meetings/${meeting._id}/leave`, 'POST', {});
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Unable to leave');
                return;
              }
            }
            setMedia(null);
            close();
          }}
        >
          <ArrowLeft size={17} />
          Workspace
        </button>
        <div>
          <h1>{meeting.title}</h1>
          <p>
            {dateLabel(meeting.startsAt)} · {meeting.durationMinutes} minutes
          </p>
        </div>
        <span className={`badge ${meeting.status}`}>{meeting.status}</span>
      </header>
      <ErrorBox message={error} />
      {info && <div className="success">{info}</div>}
      <div className="room-layout">
        <section className="video-area">
          {media && meeting.status === 'live' && admitted ? (
            <LiveKitRoom
              data-lk-theme="default"
              token={media.token}
              serverUrl={media.url}
              connect
              audio={false}
              video={false}
              onError={() =>
                setError(
                  'Video could not connect. Retry, or open IntellMeet in Chrome or Edge. Chat and notes remain available.',
                )
              }
              onDisconnected={() => setMedia(null)}
            >
              <VideoStage />
            </LiveKitRoom>
          ) : (
            <div className="join-stage">
              <div className="stage-symbol">
                <Video size={38} />
              </div>
              <div className="eyebrow">SPACE FOR A BETTER CONVERSATION</div>
              <h2>
                {meeting.status === 'ended'
                  ? 'The conversation continues.'
                  : meeting.status === 'scheduled'
                    ? 'Your meeting is ready.'
                    : meeting.status === 'cancelled'
                      ? 'This meeting was cancelled.'
                      : participant?.status === 'waiting'
                        ? 'You’re in the waiting room.'
                        : 'Ready to join your team?'}
              </h2>
              <p>
                {meeting.status === 'ended'
                  ? 'Find your notes, transcript, and next steps in the recap panel.'
                  : participant?.status === 'waiting'
                    ? 'Your host will admit you shortly.'
                    : 'Your camera and microphone start off. Enable them when you’re ready.'}
              </p>
              {meeting.status === 'scheduled' && host && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void action(() => api(`/meetings/${meeting._id}/start`, 'POST', {}))
                  }
                >
                  Start meeting
                  <Video size={18} />
                </button>
              )}
              {meeting.status === 'live' && !joined && !admitted && (
                <form
                  className="consent-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      await api(`/meetings/${meeting._id}/join`, 'POST', {
                        recordingConsent,
                        aiConsent,
                      });
                      setJoined(true);
                    });
                  }}
                >
                  {meeting.processingMode === 'standard' ? (
                    <>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={recordingConsent}
                          onChange={(e) => setRecordingConsent(e.target.checked)}
                        />
                        I consent to recording this meeting
                      </label>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={aiConsent}
                          onChange={(e) => setAiConsent(e.target.checked)}
                        />
                        I consent to AI transcription and summaries
                      </label>
                      <p className="consent-note">
                        Optional. You can join without consent. Processing requires everyone’s
                        consent.
                      </p>
                    </>
                  ) : (
                    <p>
                      <ShieldCheck size={15} />
                      Confidential meeting: recording and AI are disabled.
                    </p>
                  )}
                  <Submit busy={busy}>Join meeting</Submit>
                </form>
              )}
              {meeting.status === 'live' && admitted && (
                <button className="primary" disabled={busy} onClick={() => void connect()}>
                  <Video size={18} />
                  Connect video
                </button>
              )}
            </div>
          )}
          {meeting.status === 'live' && host && (
            <div className="host-controls">
              <span>
                <ShieldCheck size={15} />
                Host controls
              </span>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await api(`/meetings/${meeting._id}/end`, 'POST', {});
                    setMedia(null);
                  })
                }
              >
                End meeting for everyone
              </button>
            </div>
          )}
        </section>
        <aside className="room-panel">
          <div className="tabs room-tabs">
            {[
              { id: 'chat', icon: MessageSquare },
              { id: 'notes', icon: FileText },
              { id: 'people', icon: Users },
              { id: 'recap', icon: Sparkles },
            ].map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'selected' : ''}
                onClick={() => setTab(t.id)}
              >
                <t.icon size={16} />
                {t.id.charAt(0).toUpperCase() + t.id.slice(1)}
              </button>
            ))}
          </div>
          <div className="room-panel-body">
            {tab === 'chat' && (
              <>
                <h2>In the conversation</h2>
                <div className="messages">
                  {messages.length ? (
                    messages.map((m) => (
                      <article className="message" key={m._id}>
                        <div>
                          <strong>{label(m.userId || m.authorId)}</strong>
                          <small>
                            {new Date(m.createdAt).toLocaleTimeString(undefined, {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </small>
                        </div>
                        <p>{m.text}</p>
                      </article>
                    ))
                  ) : (
                    <Empty
                      title="Start a conversation"
                      detail="Messages from this meeting will appear here."
                    />
                  )}
                </div>
                <form
                  className="message-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const sent = text;
                    void action(async () => {
                      await api(`/meetings/${meeting._id}/messages`, 'POST', {
                        clientId: crypto.randomUUID(),
                        text: sent,
                        mentions: [],
                      });
                      setText('');
                    });
                  }}
                >
                  <input
                    aria-label="Message"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={4000}
                    placeholder={admitted ? 'Message your team…' : 'Join to send a message'}
                    disabled={!admitted || meeting.status !== 'live'}
                  />
                  <button
                    className="primary compact"
                    aria-label="Send message"
                    disabled={!text.trim() || busy || !admitted}
                  >
                    <Send size={17} />
                  </button>
                </form>
              </>
            )}
            {tab === 'notes' && (
              <>
                <h2>Shared notes</h2>
                <p className="muted">Capture ideas together. Revision {note.revision}.</p>
                <textarea
                  className="notes-editor"
                  aria-label="Shared notes"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setDirty(true);
                    dirtyRef.current = true;
                  }}
                  maxLength={50000}
                  disabled={meeting.status === 'live' && !admitted}
                  placeholder="The ideas worth keeping…"
                />
                <button
                  className="primary"
                  disabled={!dirty || busy}
                  onClick={() =>
                    void action(async () => {
                      await api(`/meetings/${meeting._id}/notes`, 'PUT', {
                        text: draft,
                        revision: note.revision,
                      });
                      setDirty(false);
                      dirtyRef.current = false;
                    })
                  }
                >
                  Save notes
                </button>
                {dirty && (
                  <button
                    className="text-button"
                    onClick={async () => {
                      try {
                        const r = await api<{ note: { text: string; revision: number } }>(
                          `/meetings/${meeting._id}/notes`,
                        );
                        setNote(r.note);
                        setDraft(r.note.text);
                        setDirty(false);
                        dirtyRef.current = false;
                        setInfo('Latest shared notes loaded.');
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Unable to reload notes');
                      }
                    }}
                  >
                    Discard draft and load latest notes
                  </button>
                )}
                {dirty && (
                  <p className="muted">
                    Unsaved changes. If another person updates this note, review the latest revision
                    before saving.
                  </p>
                )}
              </>
            )}
            {tab === 'people' && (
              <>
                <h2>People in this meeting</h2>
                {participants.length ? (
                  participants.map((p) => (
                    <div className="participant-row" key={p.userId}>
                      <span className="avatar small">{label(p.userId).charAt(0)}</span>
                      <div>
                        <strong>{label(p.userId)}</strong>
                        <small>{p.status}</small>
                      </div>
                      {host && p.status === 'waiting' && (
                        <button
                          className="secondary compact"
                          disabled={busy}
                          onClick={() =>
                            void action(() =>
                              api(
                                `/meetings/${meeting._id}/participants/${p.userId}/admit`,
                                'POST',
                                {},
                              ),
                            )
                          }
                        >
                          Admit
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <Empty title="A seat for everyone" detail="Participants appear after joining." />
                )}
                {admitted && meeting.processingMode === 'standard' && (
                  <div className="consent-settings">
                    <h3>Your processing choices</h3>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={participant?.recordingConsent || false}
                        disabled={busy}
                        onChange={(e) =>
                          void action(() =>
                            api(`/meetings/${meeting._id}/consent`, 'PATCH', {
                              recordingConsent: e.target.checked,
                              aiConsent: participant?.aiConsent || false,
                            }),
                          )
                        }
                      />
                      Recording consent
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={participant?.aiConsent || false}
                        disabled={busy}
                        onChange={(e) =>
                          void action(() =>
                            api(`/meetings/${meeting._id}/consent`, 'PATCH', {
                              recordingConsent: participant?.recordingConsent || false,
                              aiConsent: e.target.checked,
                            }),
                          )
                        }
                      />
                      AI processing consent
                    </label>
                  </div>
                )}
              </>
            )}
            {tab === 'recap' && (
              <>
                <h2>A little clarity, after the call</h2>
                {summary ? (
                  <>
                    <span className="badge live">AI-generated · Review before use</span>
                    <p className="summary-text">{summary.overview}</p>
                    <h3>Decisions</h3>
                    <ul>
                      {summary.decisions.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                    <h3>Suggested next steps</h3>
                    {summary.actions.map((a) => (
                      <div className="suggestion" key={a.id}>
                        <strong>{a.title}</strong>
                        <small>{a.evidence.length} transcript references</small>
                        {host && (
                          <button
                            className="secondary compact"
                            disabled={busy}
                            onClick={() =>
                              void action(async () => {
                                await api(
                                  `/meetings/${meeting._id}/actions/${a.id}/accept`,
                                  'POST',
                                  {},
                                );
                                setInfo('Action item accepted into your workspace.');
                              })
                            }
                          >
                            Accept action item
                          </button>
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <Empty
                    title="No summary yet"
                    detail={
                      meeting.processingMode === 'confidential'
                        ? 'AI processing is disabled for this confidential meeting.'
                        : 'A summary requires a transcript, consent, and a configured AI provider.'
                    }
                  />
                )}
                <h3>Transcript</h3>
                {segments.length ? (
                  segments.map((s) => (
                    <p className="transcript-line" key={s._id}>
                      <small>
                        {Math.floor(s.startSeconds / 60)}:
                        {String(Math.floor(s.startSeconds % 60)).padStart(2, '0')} {s.speakerName}
                      </small>
                      {s.text}
                    </p>
                  ))
                ) : (
                  <p className="muted">No transcript has been generated.</p>
                )}
                <h3>Meeting files</h3>
                {assets
                  .filter((a) => a.status === 'ready')
                  .map((a) => (
                    <button
                      className="secondary compact"
                      key={a._id}
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          const r = await api<{ url: string }>(`/assets/${a._id}/download`);
                          if (!/^https?:\/\//.test(r.url)) throw new Error('Invalid download URL');
                          location.assign(r.url);
                        })
                      }
                    >
                      <Download size={14} />
                      {a.kind}
                    </button>
                  ))}
                {host && meeting.status === 'ended' && meeting.processingMode === 'standard' && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api(`/meetings/${meeting._id}/summarize`, 'POST', {});
                        setInfo('Summary queued. It will appear when processing completes.');
                      })
                    }
                  >
                    <Sparkles size={16} />
                    Generate summary
                  </button>
                )}
              </>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function VideoStage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const state = useConnectionState();
  return (
    <div className="video-stage">
      <span className="media-status" data-testid="media-connection">
        {state}
      </span>
      <GridLayout tracks={tracks}>
        <ParticipantTile />
      </GridLayout>
      <ControlBar controls={{ chat: false, settings: false }} />
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </div>
  );
}
