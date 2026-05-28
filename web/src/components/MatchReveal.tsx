import { useEffect, useRef, useState } from "react";
import { Badge, Card, Group, Text } from "@mantine/core";
import { teamById } from "../teams";
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

type MatchRevealProps = {
  match: Match;
  /** Fires once when reveal completes (naturally or via skipAll). The parent
   *  owns the skip control (RevealRound's PULAR covers user-match +
   *  parallel matches together). */
  onComplete: () => void;
  /** External skip signal. Flipping to `true` jumps reveal to the end and
   *  triggers onComplete on the next tick. */
  skipAll?: boolean;
};

export default function MatchReveal({ match, onComplete, skipAll }: MatchRevealProps) {
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

  // Continuous match clock — counts up during the calm stretches between
  // lances instead of standing still on the last event's minute.
  const clockMinute = useMatchClock(finalMinute, !!skipAll, match);

  useEffect(() => {
    setRevealed(0);
    completedRef.current = false;
    // Walk events in order, scheduling each at its minute-proportional time
    // but never closer than MIN_EVENT_GAP_MS to the previous one. Seeding
    // `prev` at -gap lets the first event keep its natural (ungapped) time.
    let prev = -MIN_EVENT_GAP_MS;
    const timers = match.events.map((e, i) => {
      const base =
        e.minute * REVEAL_MS_PER_MIN +
        (e.minute > 45 ? HALFTIME_PAUSE_MS : 0);
      const at = Math.max(base, prev + MIN_EVENT_GAP_MS);
      prev = at;
      return window.setTimeout(() => setRevealed(i + 1), at);
    });
    return () => timers.forEach(window.clearTimeout);
  }, [match]);

  useEffect(() => {
    if (skipAll) {
      setRevealed(match.events.length);
    }
  }, [skipAll, match.events.length]);

  useEffect(() => {
    if (!completedRef.current && revealed >= match.events.length && match.events.length > 0) {
      completedRef.current = true;
      onComplete();
    }
  }, [revealed, match.events.length, onComplete]);

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

  return (
    <Card withBorder radius="md" padding={0}>
      <Group
        gap="md"
        p="md"
        wrap="nowrap"
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Text fw={700} ta="right" style={{ flex: 1 }}>
          {home.toUpperCase()}
        </Text>
        <Text
          fw={800}
          fz="xl"
          style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
        >
          {runningHome} <Text span c="dimmed">x</Text> {runningAway}
        </Text>
        <Text fw={700} ta="left" style={{ flex: 1 }}>
          {away.toUpperCase()}
        </Text>
        <Badge variant="outline" color="phosphor" radius="xl">
          {clockMinute}'
        </Badge>
      </Group>

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
  const { c, fw, fs } = eventStyle(k);
  const glyph = eventGlyph(k);
  const m = event.text.match(/^(\d+'?)\s+(.*)$/);
  const minute = m ? m[1] : undefined;
  const rest = m ? m[2] : event.text;

  return (
    <li style={{ padding: "6px 16px" }}>
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
          <Text span size="sm" c={c}>
            {glyph}
          </Text>
        )}
        <Text span size="sm" c={c} fw={fw} fs={fs}>
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

function eventStyle(k: string): { c?: string; fw?: number; fs?: "italic" } {
  switch (k) {
    case "Goal":
      return { c: "phosphor.4", fw: 700 };
    case "RedCard":
      return { c: "red.5", fw: 700 };
    case "YellowCard":
      return { c: "yellow.5" };
    case "Substitution":
      return { c: "blue.4", fs: "italic" };
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
    case "Substitution":
      return "↔";
    case "HalfTime":
    case "FullTime":
      return "───";
    default:
      return "";
  }
}
