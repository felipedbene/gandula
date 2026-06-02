import { useMemo } from "react";

/**
 * Deterministic generated crest for a fictional club. The world has no real
 * badge/colour data (Team only carries a name), so we derive a stable,
 * recognisable mark from the name alone: a two-tone rounded shield with the
 * club's distinctive initials. Same name → same crest, every render.
 */

// Noise words to drop when picking initials, so "Associação Vitória Régia EC"
// reads as "VR" rather than "AV". Generic club words + corporate suffixes.
const NOISE = new Set([
  "associacao",
  "clube",
  "esporte",
  "esportivo",
  "sociedade",
  "real",
  "united",
  "junior",
  "central",
  "do",
  "da",
  "de",
  "dos",
  "das",
  "fc",
  "sc",
  "ac",
  "ec",
  "cf",
  "se",
  "ca",
]);

const strip = (w: string) =>
  w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // drop combining accents for noise check

/** 2–3 letter mark from the distinctive words of a club name. */
export function crestInitials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => !NOISE.has(strip(w)));
  const pick = (meaningful.length ? meaningful : words).slice(0, 3);
  if (pick.length >= 2) {
    return pick.map((w) => w[0]).join("").toUpperCase();
  }
  // Single meaningful word → first two letters (e.g. "Aurora" → "AU").
  return pick[0]?.slice(0, 2).toUpperCase() || "??";
}

// FNV-1a hash → stable per name, so colours never shuffle between renders.
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function colorsFor(name: string): { a: string; b: string; fg: string } {
  const h = hash(name);
  const hue = h % 360;
  // A complementary-ish second hue for the two-tone split.
  const hue2 = (hue + 140 + ((h >> 9) % 60)) % 360;
  const sat = 55 + ((h >> 17) % 20); // 55–74%
  const a = `hsl(${hue} ${sat}% 42%)`;
  const b = `hsl(${hue2} ${sat}% 32%)`;
  // White text reads on these mid-dark fills; good contrast across the ramp.
  return { a, b, fg: "#ffffff" };
}

export function TeamCrest({
  name,
  size = 24,
  radius = 6,
  title,
}: {
  name: string;
  /** Pixel size of the (square) crest. */
  size?: number;
  radius?: number;
  /** Tooltip / a11y label; defaults to the team name. */
  title?: string;
}) {
  const { initials, a, b, fg } = useMemo(() => {
    const c = colorsFor(name);
    return { initials: crestInitials(name), ...c };
  }, [name]);

  // Font size in viewBox (40-unit) space, independent of the rendered size.
  const fontSize = initials.length >= 3 ? 15 : 18;
  const gradId = `crest-${hash(name).toString(36)}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={title ?? name}
      style={{ display: "block", flexShrink: 0 }}
    >
      <title>{title ?? name}</title>
      <defs>
        {/* Diagonal two-tone split — the "jersey" look. */}
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={a} />
          <stop offset="50%" stopColor={a} />
          <stop offset="50%" stopColor={b} />
          <stop offset="100%" stopColor={b} />
        </linearGradient>
      </defs>
      <rect
        x="1"
        y="1"
        width="38"
        height="38"
        rx={radius}
        fill={`url(#${gradId})`}
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1"
      />
      <text
        x="20"
        y="21"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="'Inter', system-ui, sans-serif"
        fontWeight="700"
        fontSize={fontSize}
        fill={fg}
        style={{ letterSpacing: "-0.02em" }}
      >
        {initials}
      </text>
    </svg>
  );
}
