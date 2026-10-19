import { useState } from 'react';
import type { CSSProperties } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Sparkles,
  ShieldCheck,
  CalendarDays,
  Check,
  CheckCheck,
  ListTodo,
  ChevronRight,
  Plus,
  Menu,
  X,
  Play,
  LockKeyhole,
  AudioLines,
} from 'lucide-react';
import { SignalMark } from './Brand';
import { Modal } from './ui';
import './StudioLanding.css';

type View = 'workspace' | 'meeting' | 'recap';
const currentYear = new Date().getFullYear();
const steps: { id: View; label: string; icon: typeof Video; detail: string }[] = [
  {
    id: 'workspace',
    label: 'Before the meeting',
    icon: CalendarDays,
    detail:
      'Give every conversation a home. Set the agenda, bring the right people together, and see what is coming next.',
  },
  {
    id: 'meeting',
    label: 'In the moment',
    icon: Video,
    detail:
      'Make room for real conversation with video, screen sharing, shared notes, and a team that stays in sync.',
  },
  {
    id: 'recap',
    label: 'After the conversation',
    icon: Sparkles,
    detail:
      'Review a clear recap, check the decisions, and turn agreed next steps into action items with an owner.',
  },
];
function Tour({ view, setView }: { view: View; setView: (view: View) => void }) {
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  const [completed, setCompleted] = useState<string[]>([]);
  const [detail, setDetail] = useState<string | null>(null);
  return (
    <div className="st-tour">
      <div className="st-chrome">
        <span className="st-dots">
          <i />
          <i />
          <i />
        </span>
        <span>
          <LockKeyhole size={11} /> intellmeet / studio workspace
        </span>
        <span className="st-sample">SAMPLE WORKSPACE</span>
      </div>
      <div className="st-app">
        <aside className="st-sidebar">
          <div className="st-brand">
            <SignalMark />
            <b>IntellMeet</b>
          </div>
          <div className="st-team">
            <span>S</span>
            <div>
              Studio team<small>Our shared space</small>
            </div>
          </div>
          <span className="st-nav-caption">WORKSPACE</span>
          {steps.map((s) => (
            <button
              key={s.id}
              className={view === s.id ? 'selected' : ''}
              onClick={() => setView(s.id)}
              aria-pressed={view === s.id}
            >
              <s.icon size={15} />
              {s.id === 'workspace'
                ? 'Overview'
                : s.id === 'meeting'
                  ? 'Meeting room'
                  : 'Meeting recap'}
              {view === s.id && <span className="st-nav-dot" />}
            </button>
          ))}
          <div className="st-sidebar-bottom">
            <span className="st-avatar">JD</span>
            <div>
              Jamie Davis<small>Workspace owner</small>
            </div>
          </div>
        </aside>
        <div className="st-body">
          <div className="st-topline">
            <span>
              Studio team <ChevronRight size={12} />{' '}
              {view === 'workspace'
                ? 'Overview'
                : view === 'meeting'
                  ? 'Design sync'
                  : 'Meeting recap'}
            </span>
            <span>
              <ShieldCheck size={14} /> Private
            </span>
          </div>
          {view === 'workspace' && (
            <div className="st-overview">
              <div className="st-greeting">
                <div>
                  <span className="st-mini-label">A LITTLE CLARITY FOR YOUR DAY</span>
                  <h3>
                    Good morning, Jamie <span>✳</span>
                  </h3>
                  <p>Your people, plans, and next steps. All together.</p>
                </div>
                <span className="st-date">
                  MON
                  <br />
                  <b>24</b>
                </span>
              </div>
              <div className="st-meeting-card">
                <div>
                  <span className="st-mini-label">
                    <i className="st-pip" /> UP NEXT · 10:30 AM
                  </span>
                  <h4>Good ideas start here.</h4>
                  <p>Weekly design sync · 30 minutes</p>
                  <div className="st-card-bottom">
                    <div className="st-avatars">
                      <span>JD</span>
                      <span>AL</span>
                      <span>MK</span>
                      <small>+2</small>
                    </div>
                    <button onClick={() => setView('meeting')}>
                      Enter room <ArrowUpRight size={14} />
                    </button>
                  </div>
                </div>
                <div className="st-orbit" aria-hidden="true">
                  <div />
                  <div />
                  <div />
                  <AudioLines size={49} strokeWidth={1.2} />
                </div>
              </div>
              <div className="st-two-columns">
                <div className="st-agenda">
                  <h4>
                    On the agenda <span>02</span>
                  </h4>
                  <button onClick={() => setDetail('Product check-in')}>
                    <span className="st-time">13:00</span>
                    <span>
                      Product check-in<small>Product · 45 min</small>
                    </span>
                    <ArrowUpRight size={13} />
                  </button>
                  <button onClick={() => setDetail('A little room to think')}>
                    <span className="st-time">15:30</span>
                    <span>
                      A little room to think<small>Creative · 30 min</small>
                    </span>
                    <ArrowUpRight size={13} />
                  </button>
                </div>
                <div className="st-actions">
                  <h4>
                    Keep things moving <ListTodo size={15} />
                  </h4>
                  {['Share the first concept', 'Review the onboarding flow'].map((title) => (
                    <button
                      key={title}
                      className={completed.includes(title) ? 'is-done' : ''}
                      onClick={() =>
                        setCompleted((c) =>
                          c.includes(title) ? c.filter((t) => t !== title) : [...c, title],
                        )
                      }
                      aria-pressed={completed.includes(title)}
                    >
                      <span className="st-check">
                        {completed.includes(title) && <Check size={11} />}
                      </span>
                      {title}
                    </button>
                  ))}
                  <small aria-live="polite">{completed.length} of 2 actions complete</small>
                </div>
              </div>
            </div>
          )}
          {view === 'meeting' && (
            <div className="st-call">
              <div className="st-call-title">
                <h3>Weekly design sync</h3>
                <span>
                  <i className="st-pip" /> Preview room
                </span>
              </div>
              <div className="st-tiles">
                <div className="st-person first">
                  <div className="st-portrait">
                    <span>AL</span>
                  </div>
                  <span className="st-person-tag">
                    Alex Lee <AudioLines size={13} />
                  </span>
                </div>
                <div className="st-person second">
                  <div className="st-portrait">
                    <span>{camera ? 'JD' : <VideoOff size={30} />}</span>
                  </div>
                  <span className="st-person-tag">
                    Jamie · You {mic ? <Mic size={13} /> : <MicOff size={13} />}
                  </span>
                </div>
              </div>
              <div className="st-call-note">
                <Sparkles size={17} />
                <span>
                  Room for conversation.<small>Room for what comes next.</small>
                </span>
                <button onClick={() => setView('recap')}>
                  See the recap <ArrowRight size={14} />
                </button>
              </div>
              <div className="st-call-controls">
                <button
                  aria-label="Toggle preview microphone"
                  aria-pressed={mic}
                  onClick={() => setMic(!mic)}
                >
                  {mic ? <Mic size={18} /> : <MicOff size={18} />}
                </button>
                <button
                  aria-label="Toggle preview camera"
                  aria-pressed={camera}
                  onClick={() => setCamera(!camera)}
                >
                  {camera ? <Video size={18} /> : <VideoOff size={18} />}
                </button>
                <span>Interactive preview · no devices accessed</span>
                <button className="st-leave" onClick={() => setView('recap')}>
                  Leave
                </button>
              </div>
            </div>
          )}
          {view === 'recap' && (
            <div className="st-recap">
              <span className="st-mini-label">
                <Sparkles size={13} /> SAMPLE AI RECAP
              </span>
              <h3>
                Great conversation.
                <br />
                Clear next steps.
              </h3>
              <p>Weekly design sync · 30 minutes · 5 participants</p>
              <div className="st-summary">
                <h4>The big picture</h4>
                <p>
                  The team aligned on a simpler onboarding experience. We’ll explore one focused
                  concept and review the first prototype together.
                </p>
                <h4>
                  <CheckCheck size={15} /> Decisions made
                </h4>
                <p>
                  Keep the first step simple. Lead with the workspace. Give every new teammate a
                  clear starting point.
                </p>
              </div>
              <button className="st-recap-action" onClick={() => setView('workspace')}>
                Back to the workspace <ArrowUpRight size={15} />
              </button>
            </div>
          )}
        </div>
      </div>
      {detail && (
        <Modal title={detail} close={() => setDetail(null)}>
          <p className="muted">
            This is an interactive example. In your workspace, meeting details include your agenda,
            participants, permissions, and join controls.
          </p>
          <a className="primary" href="/register">
            Create your own workspace <ArrowUpRight size={16} />
          </a>
        </Modal>
      )}
    </div>
  );
}
export function StudioLanding() {
  const [view, setView] = useState<View>('workspace');
  const [mobile, setMobile] = useState(false);
  function explore(next: View) {
    setView(next);
    document.getElementById('product-tour')?.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'center',
    });
  }
  return (
    <div className="studio-landing">
      <a className="skip-link" href="#landing-main">
        Skip to content
      </a>
      <header className="st-nav">
        <a className="brand" href="/" aria-label="IntellMeet home">
          <span className="brand-icon">
            <SignalMark />
          </span>
          IntellMeet<span className="st-tagline">A clearer way to meet</span>
        </a>
        <nav className={mobile ? 'is-open' : ''} aria-label="Main navigation">
          <a href="#workspace" onClick={() => setMobile(false)}>
            The workspace
          </a>
          <a href="#how-it-works" onClick={() => setMobile(false)}>
            How it works
          </a>
          <a href="#questions" onClick={() => setMobile(false)}>
            Good to know
          </a>
        </nav>
        <div className="st-account">
          <a href="/login">Sign in</a>
          <a className="primary" href="/register">
            Get started <ArrowUpRight size={15} />
          </a>
          <button
            className="st-menu"
            aria-expanded={mobile}
            aria-label="Toggle navigation"
            onClick={() => setMobile(!mobile)}
          >
            {mobile ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </header>
      <main id="landing-main">
        <section className="st-hero">
          <div className="st-intro">
            <span className="st-eyebrow">
              <span className="st-star">✳</span> FOR THE WAY GREAT TEAMS THINK
            </span>
            <h1>
              Less meeting.
              <br />
              More <em>meaning.</em>
              <span className="st-asterisk">*</span>
            </h1>
            <p>
              A little more connection. A lot more clarity. Bring your people, conversations, and
              next steps into one thoughtful workspace.
            </p>
            <div className="st-hero-actions">
              <a className="primary" href="/register">
                Make room for better work <ArrowUpRight size={18} />
              </a>
              <button className="st-tour-trigger" onClick={() => explore('meeting')}>
                <span>
                  <Play size={12} fill="currentColor" />
                </span>
                Take a little tour
              </button>
            </div>
            <div className="st-footnote">
              <ShieldCheck size={15} /> Your space. Your team. Your control.
            </div>
          </div>
          <div className="st-hero-art" aria-label="From many voices to one shared direction">
            <div className="st-art-grid" />
            <div className="st-art-label">
              <span>THE ART OF COMING TOGETHER</span>
              <span>01 — ∞</span>
            </div>
            <div className="st-ribbons" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <i key={i} style={{ '--i': i } as CSSProperties} />
              ))}
              <span>✳</span>
            </div>
            <div className="st-art-note">
              <span>
                <Check size={15} />
              </span>
              <div>
                A conversation, continued.
                <small>Good ideas don’t end with the call.</small>
              </div>
            </div>
            <div className="st-art-caption">
              <span>Many voices.</span>
              <span>One shared direction. ↗</span>
            </div>
          </div>
        </section>
        <div className="st-value-strip">
          <span>
            <Video size={17} /> Meet with intention
          </span>
          <span>
            <AudioLines size={17} /> Be in the conversation
          </span>
          <span>
            <Sparkles size={17} /> Leave with clarity
          </span>
          <span>
            <CheckCheck size={17} /> Keep the momentum
          </span>
        </div>
        <section className="st-workspace" id="workspace">
          <div className="st-section-heading">
            <div>
              <span className="st-eyebrow">YOUR TEAM’S NEW COMMON GROUND</span>
              <h2>
                Everything in its place.
                <br />
                <em>Everyone in the loop.</em>
              </h2>
            </div>
            <p>
              From “shall we talk?” to “here’s what’s next.”
              <br />
              One space for the work you do together.
            </p>
          </div>
          <div id="product-tour">
            <div className="st-picker" role="group" aria-label="Explore the product">
              <span>
                <i className="st-pip" /> TAKE A LOOK AROUND
              </span>
              <div>
                {steps.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setView(s.id)}
                    aria-pressed={view === s.id}
                    className={view === s.id ? 'active' : ''}
                  >
                    <s.icon size={15} />
                    {s.id === 'workspace'
                      ? 'Your workspace'
                      : s.id === 'meeting'
                        ? 'The conversation'
                        : 'The next steps'}
                  </button>
                ))}
              </div>
            </div>
            <Tour view={view} setView={setView} />
            <div className="st-tour-caption">
              <span>Interactive product tour · sample data</span>
              <span>
                Try the tabs, meeting controls, and action items <ArrowUpRight size={13} />
              </span>
            </div>
          </div>
        </section>
        <section className="st-flow" id="how-it-works">
          <div>
            <span className="st-eyebrow">A BETTER RHYTHM FOR YOUR TEAM</span>
            <h2>
              Before. During.
              <br />
              <em>And what comes after.</em>
            </h2>
            <p>
              Great collaboration is more than a call.
              <br />
              It’s everything that happens around it.
            </p>
          </div>
          <div className="st-steps">
            {steps.map((s, i) => (
              <button
                className={view === s.id ? 'active' : ''}
                key={s.id}
                onClick={() => setView(s.id)}
                aria-expanded={view === s.id}
              >
                <span className="st-step-number">0{i + 1}</span>
                <div>
                  <h3>{s.label}</h3>
                  {view === s.id && <p>{s.detail}</p>}
                </div>
                <Plus size={17} />
              </button>
            ))}
            <button className="st-explore-step" onClick={() => explore(view)}>
              Explore this moment <ArrowRight size={15} />
            </button>
          </div>
        </section>
        <section className="st-features">
          <div className="st-feature-intro">
            <span className="st-eyebrow">THOUGHTFUL BY DEFAULT</span>
            <h2>
              Powerful where it matters.
              <br />
              <em>Simple where it should be.</em>
            </h2>
          </div>
          <div className="st-feature-grid">
            <article className="st-feature lime">
              <span className="st-feature-index">01 / TOGETHER</span>
              <div className="st-feature-art circles" aria-hidden="true">
                <span>YOU</span>
                <span>US</span>
                <span>IDEAS</span>
              </div>
              <h3>A room for every perspective.</h3>
              <p>
                Video, shared notes, and meeting chat keep your team connected and the conversation
                moving.
              </p>
              <button onClick={() => explore('meeting')}>
                Find your common ground <ArrowUpRight size={16} />
              </button>
            </article>
            <article className="st-feature paper">
              <span className="st-feature-index">02 / FORWARD</span>
              <div className="st-feature-art paper-note" aria-hidden="true">
                <Sparkles size={18} />
                <b>
                  From conversation
                  <br />
                  to a clear direction.
                </b>
                <span>
                  <Check size={13} /> A decision worth keeping
                </span>
                <span>
                  <Check size={13} /> A next step with an owner
                </span>
              </div>
              <h3>Good ideas deserve a next step.</h3>
              <p>
                Review AI summaries and suggested actions when processing is enabled. Your team
                makes the final call.
              </p>
              <button onClick={() => explore('recap')}>
                See what happens next <ArrowUpRight size={16} />
              </button>
            </article>
            <article className="st-feature dark">
              <span className="st-feature-index">03 / IN CONTROL</span>
              <div className="st-feature-art lock-art" aria-hidden="true">
                <span />
                <span />
                <LockKeyhole size={42} strokeWidth={1.3} />
              </div>
              <h3>Trust is part of the workspace.</h3>
              <p>
                Workspace permissions, meeting lobbies, and consent controls put access and
                participation in your hands.
              </p>
              <a href="#questions">
                A little peace of mind <ArrowUpRight size={16} />
              </a>
            </article>
          </div>
        </section>
        <section className="st-faq" id="questions">
          <div>
            <span className="st-eyebrow">GOOD TO KNOW</span>
            <h2>
              A few things
              <br />
              <em>you might be wondering.</em>
            </h2>
            <p>Clear answers. Before the first hello.</p>
          </div>
          <div className="st-faq-list">
            {[
              [
                'What can my team do with IntellMeet?',
                'Create a shared workspace, schedule meetings, collaborate through chat and notes, and track action items with clear ownership. Video and AI features depend on your organization’s configured services.',
              ],
              [
                'Do we stay in control of recording and AI?',
                'Yes. Recording and AI processing depend on workspace policy and participant consent. Confidential meetings disable server recording and AI. This mode does not, by itself, provide end-to-end media encryption.',
              ],
              [
                'Can I explore before creating an account?',
                'Absolutely. The interactive workspace above uses sample data. Try switching between the workspace, meeting room, and recap. Preview controls do not access your camera or microphone.',
              ],
              [
                'How do we get started?',
                'Create an account, follow the sign-in prompts, and create your first workspace. Then invite your teammates and schedule a conversation. Your organization manages production hosting and service setup.',
              ],
            ].map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <Plus size={17} />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="st-cta">
          <span className="st-eyebrow">LESS FRICTION. MORE FORWARD.</span>
          <h2>
            Your next great idea
            <br />
            starts with <em>hello.</em>
            <span>✳</span>
          </h2>
          <a className="primary" href="/register">
            Let’s bring your team together <ArrowUpRight size={18} />
          </a>
          <p>A shared space for what comes next.</p>
        </section>
      </main>
      <footer className="st-footer">
        <a className="brand" href="/">
          <span className="brand-icon">
            <SignalMark />
          </span>
          IntellMeet
        </a>
        <span>Made for a more thoughtful way of working.</span>
        <div>
          <a href="#workspace">Workspace</a>
          <a href="#questions">Questions</a>
          <a href="/login">
            Sign in <ArrowUpRight size={13} />
          </a>
        </div>
        <small>© {currentYear} IntellMeet</small>
      </footer>
    </div>
  );
}
