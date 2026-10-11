import {
  ArrowUpRight,
  ArrowRight,
  Video,
  MessageSquare,
  Check,
  ShieldCheck,
  CalendarDays,
  FileText,
  MicOff,
  Monitor,
  Sparkles,
} from 'lucide-react';
import { SignalMark } from './Brand';
import './Landing.css';

export function Landing() {
  return (
    <div className="landing">
      <a className="skip-link" href="#landing-main">
        Skip to content
      </a>
      <header className="landing-nav">
        <a className="brand" href="/" aria-label="IntellMeet home">
          <span className="brand-icon">
            <SignalMark />
          </span>
          IntellMeet
        </a>
        <nav aria-label="Main navigation">
          <a href="#possibilities">The workspace</a>
          <a href="#how-it-works">How it works</a>
          <a href="#questions">Questions</a>
        </nav>
        <div className="landing-account">
          <a href="/login">Sign in</a>
          <a className="primary" href="/register">
            Get started <ArrowUpRight size={16} />
          </a>
        </div>
      </header>
      <main id="landing-main">
        <section className="landing-hero">
          <div className="hero-intro">
            <span className="landing-eyebrow">
              <span />A LITTLE MORE HUMAN. A LOT MORE CONNECTED.
            </span>
            <h1>
              Great minds.
              <br />
              Better <em>together.</em>
            </h1>
            <p>
              A thoughtful home for your meetings, ideas, and next steps. Bring everyone into the
              conversation—and keep the good work going.
            </p>
            <div className="hero-actions">
              <a className="primary" href="/register">
                Make room for your team <ArrowUpRight size={18} />
              </a>
              <a className="text-button" href="#possibilities">
                Take a closer look <ArrowRight size={17} />
              </a>
            </div>
            <div className="hero-footnote">
              <ShieldCheck size={15} />
              Your camera, microphone, and consent stay in your control.
            </div>
          </div>
          <div className="hero-signal" aria-hidden="true">
            <div className="signal-orbit" />
            <SignalMark large />
            <span>MANY VOICES. ONE DIRECTION.</span>
          </div>
        </section>
        <section className="product-window" aria-label="Illustrative meeting workspace preview">
          <div className="preview-bar">
            <span>
              <i />
              <i />
              <i />
            </span>
            <span>IntellMeet / The creative room</span>
            <small>Illustrative preview</small>
          </div>
          <div className="preview-content">
            <div className="preview-meeting">
              <div className="preview-title">
                <span>
                  <span className="signal-dot" /> A SPACE TO THINK TOGETHER
                </span>
                <Video size={20} />
              </div>
              <div className="preview-people">
                <div className="person-card person-one">
                  <span className="initial-art">A</span>
                  <small>
                    Alex <MicOff size={12} />
                  </small>
                </div>
                <div className="person-card person-two">
                  <span className="initial-art">J</span>
                  <small>
                    Jordan <MicOff size={12} />
                  </small>
                </div>
                <div className="person-card person-three">
                  <span className="initial-art">S</span>
                  <small>
                    Sam <MicOff size={12} />
                  </small>
                </div>
              </div>
              <div className="preview-controls" aria-hidden="true">
                <span>
                  <MicOff size={17} />
                </span>
                <span>
                  <Video size={17} />
                </span>
                <span>
                  <Monitor size={17} />
                </span>
                <span>
                  <MessageSquare size={17} />
                </span>
                <b>In good company.</b>
              </div>
            </div>
            <div className="preview-notes">
              <span className="landing-eyebrow">
                <FileText size={14} /> SHARED NOTES
              </span>
              <h3>
                Good ideas deserve
                <br />a next chapter.
              </h3>
              <p>A place for the decisions that matter and the details you want to remember.</p>
              <div className="preview-note">
                <Check size={15} />
                <span>
                  Align on the big idea<small>A shared direction for the team</small>
                </span>
              </div>
              <div className="preview-note">
                <Check size={15} />
                <span>
                  Give the next step an owner<small>Clarity that lasts beyond the call</small>
                </span>
              </div>
              <span className="preview-note-label">
                Example content · your workspace starts fresh
              </span>
            </div>
          </div>
        </section>
        <div className="landing-strip">
          <span>BEFORE THE CALL.</span>
          <span>IN THE MOMENT.</span>
          <span>LONG AFTER “GOODBYE.”</span>
        </div>
        <section id="possibilities" className="landing-section">
          <div className="section-intro">
            <span className="landing-eyebrow">ONE PLACE. A BETTER RHYTHM.</span>
            <h2>
              Less scattered.
              <br />
              More <em>in sync.</em>
            </h2>
            <p>
              From the first invitation to the final action item, keep the context close and your
              people closer.
            </p>
          </div>
          <div className="feature-mosaic">
            <article className="feature-main">
              <Video size={28} />
              <h3>Meet with presence.</h3>
              <p>
                Video, screen sharing, and a shared conversation. Your camera and microphone start
                off, so you choose when to join in.
              </p>
              <div className="feature-wave" aria-hidden="true">
                <SignalMark large />
              </div>
            </article>
            <article>
              <CalendarDays size={25} />
              <h3>Find your team's rhythm.</h3>
              <p>Schedule conversations and see the week ahead in one clear agenda.</p>
            </article>
            <article>
              <MessageSquare size={25} />
              <h3>Keep the context.</h3>
              <p>Persistent chat and shared notes give every idea somewhere to live.</p>
            </article>
            <article className="feature-action">
              <Check size={25} />
              <h3>Turn “we should” into “done.”</h3>
              <p>Capture action items, assign owners, and track progress together.</p>
            </article>
            <article className="feature-ai">
              <Sparkles size={25} />
              <h3>Make space for insight.</h3>
              <p>
                Review transcripts and AI summaries when enabled by your organization. AI processing
                requires participant consent and configured services.
              </p>
            </article>
          </div>
        </section>
        <section id="how-it-works" className="landing-section workflow">
          <div className="section-intro">
            <span className="landing-eyebrow">A SIMPLE WAY FORWARD</span>
            <h2>
              From hello
              <br />
              to <em>what’s next.</em>
            </h2>
          </div>
          <div className="workflow-steps">
            {[
              {
                n: '01',
                title: 'Make yourself at home.',
                text: 'Create your account, verify your email, and set up a workspace for your team.',
              },
              {
                n: '02',
                title: 'Bring the right minds together.',
                text: 'Invite teammates, plan a meeting, and share the conversation in one place.',
              },
              {
                n: '03',
                title: 'Leave with a little more clarity.',
                text: 'Keep your notes, review decisions, and give each next step a clear owner.',
              },
            ].map((s) => (
              <article key={s.n}>
                <span>{s.n}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="privacy-band">
          <ShieldCheck size={34} />
          <div>
            <span className="landing-eyebrow">TRUST IS PART OF THE CONVERSATION</span>
            <h2>Your team. Your space. Your choice.</h2>
            <p>
              Workspace permissions, waiting-room admission, optional MFA, and explicit recording
              and AI consent put control where it belongs.
            </p>
          </div>
          <a href="/register" className="secondary">
            Create your workspace <ArrowUpRight size={17} />
          </a>
        </section>
        <section id="questions" className="landing-section faq">
          <div className="section-intro">
            <span className="landing-eyebrow">BEFORE WE MEET</span>
            <h2>
              A few good
              <br />
              <em>questions.</em>
            </h2>
          </div>
          <div>
            {[
              {
                q: 'How do I get started?',
                a: 'Create an account, verify your email, and sign in. You can then create a workspace, invite teammates, and schedule your first meeting.',
              },
              {
                q: 'Do I need to turn on my camera?',
                a: 'No. Camera and microphone begin off. You choose when to enable them during the meeting.',
              },
              {
                q: 'Are meetings automatically recorded or processed by AI?',
                a: 'No. Recording and AI processing require participant consent and enabled services. Confidential meetings disable both.',
              },
              {
                q: 'Are AI summaries available in this preview?',
                a: 'The workspace supports reviewing transcripts, summaries, and suggested actions. Live AI processing and recording require your organization’s service configuration; the current local preview does not have them enabled.',
              },
              {
                q: 'Where will my verification email arrive?',
                a: 'This preview can deliver verification to the configured Resend account email. Other addresses use the local development inbox. General email delivery will be enabled when the organization configures its sending domain.',
              },
            ].map((item) => (
              <details key={item.q}>
                <summary>
                  {item.q}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="landing-cta">
          <SignalMark />
          <h2>
            Make room for
            <br />
            <em>something good.</em>
          </h2>
          <p>Your next great conversation starts here.</p>
          <a className="spotlight-button" href="/register">
            Get started with IntellMeet <ArrowUpRight size={18} />
          </a>
        </section>
      </main>
      <footer className="landing-footer">
        <a className="brand" href="/">
          <span className="brand-icon">
            <SignalMark />
          </span>
          IntellMeet
        </a>
        <span>Thoughtful meetings. Meaningful progress.</span>
        <a href="/login">
          Sign in <ArrowUpRight size={15} />
        </a>
      </footer>
    </div>
  );
}
