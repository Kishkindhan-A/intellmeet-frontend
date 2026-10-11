import { ArrowUpRight, CalendarDays, Clock3, Video } from 'lucide-react';
import type { Meeting } from './types';
import type { CSSProperties } from 'react';

export function SignalMark({ large = false }: { large?: boolean }) {
  return (
    <span className={large ? 'signal-sculpture' : 'signal-mark'} aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} style={{ '--bar': i } as CSSProperties} />
      ))}
    </span>
  );
}

export function MeetingSpotlight({
  meeting,
  open,
  schedule,
}: {
  meeting?: Meeting;
  open: (m: Meeting) => void;
  schedule: () => void;
}) {
  return (
    <section className="meeting-spotlight" aria-label="Next meeting">
      <div className="spotlight-copy">
        <span className="spotlight-kicker">
          <span className="signal-dot" />
          {meeting?.status === 'live'
            ? 'A CONVERSATION IS HAPPENING'
            : meeting
              ? 'NEXT ON YOUR AGENDA'
              : 'SPACE FOR YOUR NEXT BIG IDEA'}
        </span>
        <h2>
          {meeting ? (
            meeting.title
          ) : (
            <>
              Great work starts
              <br />
              with a conversation.
            </>
          )}
        </h2>
        <p>
          {meeting
            ? meeting.description || 'Bring your perspective. Leave with a clear next step.'
            : 'Bring your people together. Make a little room for what’s next.'}
        </p>
        {meeting && (
          <div className="spotlight-meta">
            <span>
              <CalendarDays size={15} />
              {new Date(meeting.startsAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <span>
              <Clock3 size={15} />
              {new Date(meeting.startsAt).toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
              })}{' '}
              · {meeting.durationMinutes} min
            </span>
          </div>
        )}
        <button className="spotlight-button" onClick={() => (meeting ? open(meeting) : schedule())}>
          <Video size={18} />
          {meeting?.status === 'live'
            ? 'Enter meeting'
            : meeting
              ? 'Open meeting'
              : 'Schedule a conversation'}
          <ArrowUpRight size={18} />
        </button>
      </div>
      <div className="spotlight-art" aria-hidden="true">
        <div className="signal-orbit" />
        <SignalMark large />
        <span className="art-caption">MANY VOICES. ONE DIRECTION.</span>
      </div>
    </section>
  );
}
