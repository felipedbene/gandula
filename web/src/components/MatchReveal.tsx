import { useEffect, useRef, useState } from "react";
import { Badge, Card, Group, Text } from "@mantine/core";
import { teamById } from "../teams";
import type { Match, MatchEvent } from "../types";
import { eventKindName } from "../types";

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

  const [revealed, setRevealed] = useState(0);
  // Guards onComplete from firing twice: once when naturally hitting the last
  // event, and again if skipAll flips true after that.
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
  const clock = visible.length > 0 ? visible[visible.length - 1].minute : 0;

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
          {clock}'
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
