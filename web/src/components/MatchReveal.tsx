import { useEffect, useRef, useState } from "react";
import { teamById } from "../teams";
import type { Match, MatchEvent } from "../types";
import { eventKindName } from "../types";
import CardDouble from "../srcl/CardDouble";

/** Tick-by-tick reveal pacing: ms of wall-clock per minute of match time.
 *  80ms/min → 90' match unrolls in ~7.2s, with dense periods (e.g. three
 *  subs at min 70) appearing in a burst and calm stretches sitting still.
 *  Elifoot 98 vibe — the engine resolves the match in <5ms but the UI
 *  pretends to be a 1998 PC discovering the result tick by tick. */
export const REVEAL_MS_PER_MIN = 80;

/** Extra wall-clock delay added to second-half events so the feed pauses
 *  briefly at halftime — matches the "intervalo" beat from Elifoot where
 *  you registered "ah, primeiro tempo acabou" before the second half rolled. */
export const HALFTIME_PAUSE_MS = 1500;

type MatchRevealProps = {
  match: Match;
  /** Fires once when reveal completes (naturally or via skipAll). The parent
   *  owns the skip control (RevealRound's [ PULAR ] covers user-match +
   *  parallel matches together). */
  onComplete: () => void;
  /** External skip signal. Flipping to `true` jumps reveal to the end and
   *  triggers onComplete on the next tick. */
  skipAll?: boolean;
};

export default function MatchReveal({ match, onComplete, skipAll }: MatchRevealProps) {
  const home = teamById(match.home)?.name ?? `Time ${match.home}`;
  const away = teamById(match.away)?.name ?? `Time ${match.away}`;

  const [revealed, setRevealed] = useState(0);
  // Guards onComplete from firing twice: once when naturally hitting the last
  // event, and again if skipAll flips true after that. Refs survive renders
  // without triggering re-renders themselves.
  const completedRef = useRef(false);

  useEffect(() => {
    setRevealed(0);
    completedRef.current = false;
    const timers = match.events.map((e, i) => {
      const delay =
        e.minute * REVEAL_MS_PER_MIN +
        (e.minute > 45 ? HALFTIME_PAUSE_MS : 0);
      return window.setTimeout(() => setRevealed(i + 1), delay);
    });
    return () => timers.forEach(window.clearTimeout);
  }, [match]);

  // External skip — jump to the end immediately when the prop flips true.
  useEffect(() => {
    if (skipAll) {
      setRevealed(match.events.length);
    }
  }, [skipAll, match.events.length]);

  // Fire onComplete once when reveal reaches the end.
  useEffect(() => {
    if (!completedRef.current && revealed >= match.events.length && match.events.length > 0) {
      completedRef.current = true;
      onComplete();
    }
  }, [revealed, match.events.length, onComplete]);

  // Keep the most recent event in view as new ones land. Effect fires after
  // React commits the new <li>, so scrollHeight already reflects it.
  const feedRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [revealed]);

  const visible = match.events.slice(0, revealed);
  const runningHome = visible.filter(
    (e) => eventKindName(e.kind) === "Goal" && e.side === "Home",
  ).length;
  const runningAway = visible.filter(
    (e) => eventKindName(e.kind) === "Goal" && e.side === "Away",
  ).length;
  const clock = visible.length > 0 ? visible[visible.length - 1].minute : 0;
  const title =
    `${home.toUpperCase()}  ${runningHome} x ${runningAway}  ${away.toUpperCase()}  ${clock}'`;

  return (
    <div className="match-result">
      <CardDouble title={title}>
        <ol className="feed" ref={feedRef}>
          {visible.map((e, i) => {
            const side = e.side === "Away" ? " event--away" : "";
            const klass = `event ${eventClass(e)}${side}`;
            const glyph = eventGlyph(e);
            const m = e.text.match(/^(\d+'?)\s+(.*)$/);
            if (m) {
              const [, minute, rest] = m;
              return (
                <li key={i} className={klass}>
                  <span className="event__minute">{minute}</span>
                  {glyph && <span className="event__glyph">{glyph}</span>}
                  {rest}
                </li>
              );
            }
            return (
              <li key={i} className={klass}>
                {glyph && <span className="event__glyph">{glyph}</span>}
                {e.text}
              </li>
            );
          })}
        </ol>
      </CardDouble>
    </div>
  );
}

function eventClass(e: MatchEvent): string {
  const k = eventKindName(e.kind);
  switch (k) {
    case "Goal":
      return "goal";
    case "RedCard":
      return "red";
    case "YellowCard":
      return "yellow";
    case "Substitution":
      return "sub";
    case "HalfTime":
    case "FullTime":
      return "whistle";
    default:
      return "";
  }
}

function eventGlyph(e: MatchEvent): string {
  const k = eventKindName(e.kind);
  switch (k) {
    case "Goal":
      return "►►►";
    case "RedCard":
      return "██";
    case "YellowCard":
      return "▓";
    case "Substitution":
      return "↔";
    case "HalfTime":
    case "FullTime":
      return "───";
    default:
      return "";
  }
}
