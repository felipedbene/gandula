import { useEffect, useRef, useState } from "react";
import { Badge, Card, Group, Stack, Text } from "@mantine/core";
import { teamById } from "../teams";
import { TeamCrest } from "./ui/TeamCrest";
import type { Match, MatchEvent } from "../types";
import { eventKindName } from "../types";

/** Tick-by-tick reveal pacing: ms of wall-clock per minute of match time.
 *  220ms/min → 90' match unrolls in ~20s, with dense periods (e.g. three
 *  subs at min 70) spaced out by MIN_EVENT_GAP_MS and calm stretches sitting
 *  still. Elifoot 98 vibe — the engine resolves the match in <5ms but the UI
 *  pretends to be a 1998 PC discovering the result tick by tick. */
export const REVEAL_MS_PER_MIN = 220;

/** Extra wall-clock delay added to second-half events so the feed pauses
 *  briefly at halftime — matches the "intervalo" beat from Elifoot where
 *  you registered "ah, primeiro tempo acabou" before the second half rolled. */
export const HALFTIME_PAUSE_MS = 1500;

/** Minimum wall-clock gap between two consecutive revealed events. Without
 *  it, a burst of lances in the same match-minute (e.g. goal + booking at
 *  70') would fire at the same instant and flash by; this keeps each one on
 *  screen long enough to read. Applied as a monotonic floor over the
 *  minute-proportional schedule, so calm stretches still pace naturally. */
const MIN_EVENT_GAP_MS = 600;

/** Per-event "linger": extra wall-clock the feed holds AFTER a big moment
 *  before the next event lands, so goals and red cards land with weight
 *  instead of scrolling past at the flat 220ms/min. Added to the next event's
 *  monotonic floor (not to the highlight's own time), so the drama sits on
 *  screen. Quiet events add nothing — the calm stretches stay calm. */
function eventLingerMs(kind: string): number {
  switch (kind) {
    case "Goal":
      return 900; // savour the goal
    case "RedCard":
    case "PenaltyAwarded":
      return 650; // a beat for the drama
    case "PenaltyMissed":
      return 500;
    default:
      return 0;
  }
}

type MatchRevealProps = {
  match: Match;
  /** Fires once when reveal completes (naturally or via skipAll). The parent
   *  owns the skip control (RevealRound's PULAR covers user-match +
   *  parallel matches together). */
  onComplete: () => void;
  /** External skip signal. Flipping to `true` jumps reveal to the end and
   *  triggers onComplete on the next tick. */
  skipAll?: boolean;
  /** When true, the feed animates only up to the `HalfTime` event and then
   *  holds (fires `onHalfTime` once) until `match` grows with the second-half
   *  events — at which point it resumes from minute 46 WITHOUT re-animating the
   *  first half. Used by the live two-phase reveal so the player can change
   *  tactics at the interval. */
  pauseAtHalfTime?: boolean;
  /** Fires once when the feed reaches the HalfTime marker under
   *  `pauseAtHalfTime`. The parent shows the half-time panel and, on confirm,
   *  swaps in the full Match. */
  onHalfTime?: () => void;
};

export default function MatchReveal({
  match,
  onComplete,
  skipAll,
  pauseAtHalfTime,
  onHalfTime,
}: MatchRevealProps) {
  const home = teamById(match.home)?.name ?? `Time ${match.home}`;
  const away = teamById(match.away)?.name ?? `Time ${match.away}`;

  // Final whistle minute — last event is the FullTime marker (usually 90').
  const finalMinute =
    match.events.length > 0
      ? match.events[match.events.length - 1].minute
      : 90;

  const [revealed, setRevealed] = useState(0);
  // Guards onComplete from firing twice: once when naturally hitting the last
  // event, and again if skipAll flips true after that.
  const completedRef = useRef(false);
  // How many events are already on screen — read by the resume path so the
  // second half doesn't re-animate the first.
  const revealedRef = useRef(0);
  revealedRef.current = revealed;
  // onHalfTime fires at most once across the pause.
  const halfTimeFiredRef = useRef(false);

  // Continuous match clock — counts up during the calm stretches between
  // lances instead of standing still on the last event's minute.
  const clockMinute = useMatchClock(finalMinute, !!skipAll, match);

  // Index of the HalfTime marker, if any (the pause point).
  const halfTimeIdx = match.events.findIndex(
    (e) => eventKindName(e.kind) === "HalfTime",
  );

  useEffect(() => {
    // Resume detection: if we're already mid-reveal (first half shown) and the
    // match has now grown past the half-time marker, schedule ONLY the new
    // (second-half) events, rebased to start shortly from now — the first half
    // stays exactly as-is on screen.
    const startFrom = revealedRef.current > 0 ? revealedRef.current : 0;
    if (startFrom === 0) {
      setRevealed(0);
      completedRef.current = false;
    }

    // Under pause, hold once the HalfTime marker is the LAST event present
    // (no second half yet). `pauseAtHalfTime` is the parent's intent.
    const pausedHere =
      !!pauseAtHalfTime &&
      halfTimeIdx >= 0 &&
      halfTimeIdx === match.events.length - 1;
    const stopAt = match.events.length;

    // Nothing new to schedule (e.g. the effect re-ran while paused because the
    // onHalfTime callback identity changed). Don't touch the timers or index an
    // out-of-range event — just keep what's on screen.
    if (startFrom >= stopAt) {
      return;
    }

    const resuming = startFrom > 0;
    // On a fresh pass, time each event from kickoff (absolute minute timing).
    // On resume, the absolute times are in the past, so drive purely off the
    // gap+linger spacing with a half-time-length lead-in beat before 46'.
    const resumeMinuteBase = resuming
      ? match.events[startFrom].minute * REVEAL_MS_PER_MIN
      : 0;
    let prev = -MIN_EVENT_GAP_MS;
    let linger = 0;
    const timers: number[] = [];
    for (let i = startFrom; i < stopAt; i++) {
      const e = match.events[i];
      const absolute =
        e.minute * REVEAL_MS_PER_MIN + (e.minute > 45 ? HALFTIME_PAUSE_MS : 0);
      // Resume: rebase to ~0 + a lead-in so the second half doesn't fire all at
      // once; fresh pass: keep the real minute-proportional time.
      const base = resuming
        ? HALFTIME_PAUSE_MS + (absolute - resumeMinuteBase)
        : absolute;
      const at = Math.max(base, prev + MIN_EVENT_GAP_MS + linger);
      prev = at;
      linger = eventLingerMs(eventKindName(e.kind));
      const idx = i;
      timers.push(
        window.setTimeout(() => {
          setRevealed(idx + 1);
          if (pausedHere && idx === halfTimeIdx && !halfTimeFiredRef.current) {
            halfTimeFiredRef.current = true;
            onHalfTime?.();
          }
        }, at),
      );
    }
    return () => timers.forEach(window.clearTimeout);
  }, [match, pauseAtHalfTime, halfTimeIdx, onHalfTime]);

  // While the feed is paused at half-time (only first-half events present), the
  // match isn't over — skip jumps to the marker, and onComplete must not fire.
  const pausedAtHalfTime =
    !!pauseAtHalfTime && halfTimeIdx >= 0 && match.events.length === halfTimeIdx + 1;

  useEffect(() => {
    if (skipAll) {
      setRevealed(match.events.length);
    }
  }, [skipAll, match.events.length]);

  useEffect(() => {
    if (
      !pausedAtHalfTime &&
      !completedRef.current &&
      revealed >= match.events.length &&
      match.events.length > 0
    ) {
      completedRef.current = true;
      onComplete();
    }
  }, [revealed, match.events.length, onComplete, pausedAtHalfTime]);

  // Keep the most recent event in view as new ones land.
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
  // Drive the scoreboard styling off who's ahead so the two goal counts read
  // as distinct states rather than an identical, flat "1 x 0".
  const homeLeading = runningHome > runningAway;
  const awayLeading = runningAway > runningHome;

  return (
    <Card withBorder radius="xl" padding={0} className="glass-panel">
      <Stack
        gap={6}
        p="md"
        style={{ 
          background: "linear-gradient(180deg, rgba(21, 184, 101, 0.15) 0%, rgba(0,0,0,0) 100%)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.15)",
          clipPath: "polygon(0 0, 100% 0, 100% 85%, 95% 100%, 5% 100%, 0 85%)"
        }}
      >
        <Group gap="sm" wrap="nowrap" align="center">
          <Stack gap={6} align="center" style={{ flex: 1, minWidth: 0 }}>
            <TeamCrest name={home} size={42} radius={8} />
            <Text
              fw={homeLeading ? 800 : 600}
              c={homeLeading ? "white" : "dimmed"}
              ta="center"
              size="sm"
              lineClamp={2}
            >
              {home}
            </Text>
          </Stack>
          <Group gap={12} wrap="nowrap" align="center" style={{ flexShrink: 0 }}>
            {/* key={score} remounts the number when its side scores, which
                re-fires the goal-pulse CSS animation. Guarded at >0 so 0-0
                doesn't pulse on first paint. */}
            <Text
              key={`home-${runningHome}`}
              className={runningHome > 0 ? "goal-pulse" : undefined}
              fw={800}
              fz={40}
              c={homeLeading ? "accent.4" : awayLeading ? "dimmed" : "white"}
              style={{ 
                fontVariantNumeric: "tabular-nums", 
                lineHeight: 1,
                textShadow: homeLeading ? "0 0 20px rgba(21, 184, 101, 0.8)" : "none"
              }}
            >
              {runningHome}
            </Text>
            <Text span c="dimmed" fz="xl" opacity={0.5}>
              –
            </Text>
            <Text
              key={`away-${runningAway}`}
              className={runningAway > 0 ? "goal-pulse" : undefined}
              fw={800}
              fz={40}
              c={awayLeading ? "accent.4" : homeLeading ? "dimmed" : "white"}
              style={{ 
                fontVariantNumeric: "tabular-nums", 
                lineHeight: 1,
                textShadow: awayLeading ? "0 0 20px rgba(21, 184, 101, 0.8)" : "none"
              }}
            >
              {runningAway}
            </Text>
          </Group>
          <Stack gap={6} align="center" style={{ flex: 1, minWidth: 0 }}>
            <TeamCrest name={away} size={42} radius={8} />
            <Text
              fw={awayLeading ? 800 : 600}
              c={awayLeading ? "white" : "dimmed"}
              ta="center"
              size="sm"
              lineClamp={2}
            >
              {away}
            </Text>
          </Stack>
        </Group>
        <Group justify="center" mt={4}>
          <Badge variant="filled" color="dark.8" radius="xs" style={{ border: "1px solid rgba(255,255,255,0.2)", textShadow: "0 0 8px rgba(255,255,255,0.5)" }}>
            {clockMinute}'
          </Badge>
        </Group>
      </Stack>

      <ol
        ref={feedRef}
        style={{
          listStyle: "none",
          margin: 0,
          padding: "8px 0",
          maxHeight: 340,
          overflowY: "auto",
        }}
      >
        {visible.map((e, i) => (
          <EventRow key={i} event={e} />
        ))}
      </ol>
    </Card>
  );
}

function EventRow({ event }: { event: MatchEvent }) {
  const k = eventKindName(event.kind);
  const isAway = event.side === "Away";
  const isWhistle = k === "HalfTime" || k === "FullTime";
  const { c, fw, fs, big } = eventStyle(k);
  const glyph = eventGlyph(k);
  const size = big ? "md" : "sm";
  const m = event.text.match(/^(\d+'?)\s+(.*)$/);
  const minute = m ? m[1] : undefined;
  const rest = m ? m[2] : event.text;

  return (
    <li className="feed-item" style={{ padding: "6px 16px" }}>
      <Group
        gap="xs"
        wrap="nowrap"
        justify={isWhistle ? "center" : isAway ? "flex-end" : "flex-start"}
      >
        {!isWhistle && minute && (
          <Text span size="sm" c="dimmed" style={{ minWidth: 34 }}>
            {minute}
          </Text>
        )}
        {glyph && (
          <Text span size={size} c={c}>
            {glyph}
          </Text>
        )}
        <Text span size={size} c={c} fw={fw} fs={fs}>
          {rest}
        </Text>
      </Group>
    </li>
  );
}

/** Inverse of the reveal schedule: given wall-clock ms since kickoff, return
 *  the match minute the clock should show. Linear 0→45 in the first half, a
 *  flat hold at 45 during the halftime pause, then linear 45→90. */
function minuteAtElapsed(elapsedMs: number): number {
  const firstHalfMs = 45 * REVEAL_MS_PER_MIN;
  if (elapsedMs <= firstHalfMs) return elapsedMs / REVEAL_MS_PER_MIN;
  if (elapsedMs <= firstHalfMs + HALFTIME_PAUSE_MS) return 45;
  return 45 + (elapsedMs - firstHalfMs - HALFTIME_PAUSE_MS) / REVEAL_MS_PER_MIN;
}

/**
 * Continuous match clock: ticks 0 → `finalMinute` mapped from wall-clock
 * (with the halftime hold), restarting whenever `resetKey` changes. `skip`
 * snaps to full time. `active` lets a caller mount it without running a timer
 * (so a non-bye RevealRound doesn't spin a second interval next to
 * MatchReveal's). Shared by MatchReveal (the user's match) and RevealRound's
 * bye-round header, so the clock shows even when the user doesn't play.
 */
export function useMatchClock(
  finalMinute: number,
  skip: boolean,
  resetKey: unknown,
  active = true,
): number {
  const [minute, setMinute] = useState(0);
  useEffect(() => {
    if (!active) return;
    setMinute(0);
    const start = performance.now();
    const id = window.setInterval(() => {
      const m = Math.min(
        Math.floor(minuteAtElapsed(performance.now() - start)),
        finalMinute,
      );
      setMinute(m);
      if (m >= finalMinute) window.clearInterval(id);
    }, 100);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalMinute, resetKey, active]);
  useEffect(() => {
    if (skip) setMinute(finalMinute);
  }, [skip, finalMinute]);
  return minute;
}

/** `big` flags an event that should render a touch larger (the moments that
 *  earn a linger above), so highlights read as highlights, not just colour. */
function eventStyle(k: string): {
  c?: string;
  fw?: number;
  fs?: "italic";
  big?: boolean;
} {
  switch (k) {
    case "Goal":
      return { c: "accent.4", fw: 700, big: true };
    case "RedCard":
      return { c: "red.5", fw: 700, big: true };
    case "PenaltyAwarded":
      return { c: "accent.4", fw: 700, big: true };
    case "PenaltyMissed":
      return { c: "red.5", fw: 700 };
    case "YellowCard":
      return { c: "yellow.5" };
    case "Substitution":
      return { c: "teal.4", fs: "italic" };
    case "NearMiss":
      return { c: "dimmed", fs: "italic" };
    case "HalfTime":
    case "FullTime":
      return { c: "dimmed" };
    default:
      return {};
  }
}

function eventGlyph(k: string): string {
  switch (k) {
    case "Goal":
      return "►►►";
    case "RedCard":
      return "██";
    case "YellowCard":
      return "▓";
    case "PenaltyAwarded":
      return "◎";
    case "PenaltyMissed":
      return "✗";
    case "Substitution":
      return "↔";
    case "NearMiss":
      return "·";
    case "HalfTime":
    case "FullTime":
      return "───";
    default:
      return "";
  }
}
