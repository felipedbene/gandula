# Gandula UI — DOS/Elifoot redesign

This folder contains the design brief for migrating the web UI from its current
generic "sepia + monospace" look to a committed DOS/Elifoot 98 aesthetic. The
engine doesn't change. Only `web/src/styles.css`, the JSX in
`web/src/components/`, and possibly `index.html` (fonts) are in scope.

## Why this aesthetic

The README and ARCHITECTURE.md already describe Gandula as a love letter to
1998-era PT-BR football management games. The Phase 5 notes literally say
*"Matches the CLI's tight-numbers, terminal-y feel"*. The current UI doesn't
deliver on that promise — it's a competent generic web app. This redesign
commits to the terminal/DOS reading of that intent.

Reference: Elifoot 98, Brasfoot, the dBase/Norton Commander/Turbo Pascal
visual grammar that every PT-BR 90s gamer grew up with.

## Open in a browser to see the target

`mockup.html` is a standalone, dependency-free HTML file. Open it in any
modern browser to see exactly what the UI should look like after the
redesign. It uses the same data as the current screenshots so visual diff
against the live app is direct.

## Design tokens (the "what")

All values here belong in `:root` in `styles.css` as CSS custom properties.

| Token                | Value         | Used for                            |
|----------------------|---------------|-------------------------------------|
| `--bg`               | `#0a0a0a`     | App background (near-black, not pure black — pure black kills CRT vibe) |
| `--fg`               | `#33ff33`     | Default phosphor green text         |
| `--fg-dim`           | `#1c8a1c`     | Borders, minute markers, muted info |
| `--fg-hi`            | `#ffffff`     | Team names, scorelines, emphasis    |
| `--accent-gol`       | `#aaff66`     | Goal events (light green, glows)    |
| `--accent-red`       | `#ff4040`     | Red cards, errors                   |
| `--accent-yel`       | `#ffd633`     | Yellow cards, warnings              |
| `--accent-sub`       | `#66ccff`     | Substitutions (cyan, italic)        |
| `--glow`             | `0 0 2px rgba(51,255,51,0.6), 0 0 8px rgba(51,255,51,0.25)` | Default text shadow |
| `--glow-gol`         | `0 0 4px #aaff66, 0 0 12px rgba(170,255,102,0.55)` | Goal glow |
| `--glow-red`         | `0 0 4px #ff4040, 0 0 10px rgba(255,64,64,0.5)`    | Red card glow |
| `--font-mono`        | `"VT323", ui-monospace, "Courier New", monospace`  | Everything. No second font. |
| `--font-size`        | `17px`        | Body. Bigger than usual because VT323 reads smaller per em |
| `--line-height`      | `1.25`        | Tight, terminal-like                |

### Font

Use **VT323** from Google Fonts as primary. It's the canonical CRT terminal
font, free, single weight, ~30KB. Add to `index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=VT323&display=swap" rel="stylesheet">
```

Fallback chain handles offline / first-paint correctly.

## Visual primitives (the "how")

### 1. CRT envelope

The whole app sits inside a single panel with three layers stacked via
pseudo-elements. Order matters:

```css
.crt {
  background: var(--bg);
  position: relative;
  overflow: hidden;
  box-shadow:
    0 0 40px rgba(51,255,51,0.15) inset,
    0 0 30px rgba(51,255,51,0.20);
  /* text-shadow on body text provides the per-character glow */
}
.crt::before {  /* scanlines */
  content: "";
  position: absolute; inset: 0;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0 2px,
    rgba(0,0,0,0.22) 3px,
    transparent 4px
  );
  pointer-events: none;
  z-index: 2;
}
.crt::after {   /* vignette */
  content: "";
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.6) 100%);
  pointer-events: none;
  z-index: 3;
}
.crt > * { position: relative; z-index: 1; }
```

The vignette and scanlines are non-negotiable — they're 80% of the "this is
a CRT" feeling. Glow is the other 20%.

### 2. ASCII boxes

Boxes are drawn with Unicode box-drawing characters, not CSS borders. This
is the single biggest aesthetic commitment.

```
╔═══════════╗   <- title bar / app header (double-line)
║           ║
╠═══════════╣   <- divider inside double-line box
║           ║
╚═══════════╝

┌───────────┐   <- content panel (single-line)
│           │
└───────────┘
```

The mockup shows both styles in use:
- **Double-line** (`╔═╗║╚╝`) for the top-level app chrome and for the match
  feed (it's "the main event").
- **Single-line** (`┌─┐│└┘`) for forms, panels, secondary content.

**Implementation:** Each box is a `<pre>` block (or a `<div>` with
`white-space: pre` and monospace font). The corners and edges are real
characters in the markup, not CSS. To make this maintainable in React, build
a small `<AsciiBox title="CONFRONTO" double={false}>{children}</AsciiBox>`
component that:
- Renders the top border with the title embedded (`┌─ TITLE ──────┐`)
- Renders side borders as a flexbox with `│` columns wrapping `{children}`
- Renders the bottom border with optional right-aligned hint text
  (`└──────────── [↑↓] rolar  [ESC] voltar ─┘`)

Width should be **fixed to a column count** (e.g. 78 chars) and the parent
container should be `max-width: ~80ch` to keep the grid honest. This is the
opposite of fluid responsive design and that's the point.

### 3. Tabs as inverted text

The active tab is **reverse video** — green background, dark text, no glow.
Inactive tabs are dim green on dark background.

```html
<nav class="tabs">
  <button class="tab active">[ PARTIDA ]</button>
  <button class="tab">[ TEMPORADA ]</button>
</nav>
```

```css
.tab {
  background: transparent;
  color: var(--fg-dim);
  font: inherit;
  border: none;
  padding: 0 4px;
  cursor: pointer;
  text-shadow: var(--glow);
}
.tab.active {
  background: var(--fg);
  color: var(--bg);
  text-shadow: none;
}
.tab:hover:not(.active) {
  color: var(--fg);
}
```

The square brackets are part of the label string, not CSS. Treat them as
typography.

### 4. Buttons

Same logic as tabs. No `border-radius`, no gradients, no shadows. Pure
reverse-video on active state.

```
[ JOGAR ]    [ SAIR ]
```

The "highlighted" button (default action) is reverse-video with a wider
visual weight: `[ JOGAR ]` becomes `[ JOGAR ]` with green fill.

### 5. Event feed

The current `.feed > .event` structure stays — only the *styling* changes.
Each event line is one row, no list bullets, optional left-side glyph for
visual scanning:

| Event       | Glyph     | Color class       |
|-------------|-----------|-------------------|
| Goal        | `►►►`     | `.event.goal`     |
| Yellow card | `▓`       | `.event.yellow`   |
| Red card    | `██`      | `.event.red`      |
| Substitution| `↔`       | `.event.sub` (italic) |
| Half/full   | `───`     | `.event.whistle` (bright white) |
| Generic shot| (nothing) | `.event`          |

Glyphs come from the renderer, not from the engine. The engine still emits
its existing `MatchEvent` shape; the React side maps `event.kind` to a
glyph and class. This keeps the engine unchanged.

Wrap the whole feed in a double-line ASCII box with the scoreline embedded
in the top border:

```
╔══ SANTOS IMPERIAL  4 x 0  FLAMENGUINHO FC ═══════════════╗
║  11'  ►►► GOOOL DO SANTOS IMPERIAL! ...                  ║
║  ...                                                     ║
╚════════════════════════════════════ [↑↓] rolar  [ESC] ═══╝
```

If the feed overflows, scroll the *contents* vertically without breaking
the box (use a flex layout where the side borders and bottom are sticky,
the middle scrolls). Acceptable simpler alternative: just `max-height` +
`overflow-y: auto` on the content area, with the box around it being a
container that doesn't scroll.

### 6. Standings table

Table renders inside a single-line box. No `<table>` borders — use the
ASCII frame. Column headers in `--fg-dim`, leader's name and points in
`--fg-hi`. Goal difference uses `+N` / `-N` with no special color (resist
the urge to color positive green / negative red — the table is busy
enough).

### 7. Footer status line

A single `> ...` line at the bottom of the app reads like a shell prompt
and reports last action:

```
> partida concluída em 47ms · seed 1998 · build wasm-37c4a1
```

With a blinking block cursor `█` at the end. Make sure the blink has
`steps(2, start)` timing so it snaps on/off, not fades. Fade = modern.

```css
.cursor {
  display: inline-block;
  width: 0.6em;
  background: var(--fg);
  animation: blink 1.1s steps(2, start) infinite;
}
@keyframes blink { to { visibility: hidden; } }
```

## What NOT to do

These are easy mistakes that ruin the aesthetic. Resist all of them.

- **No `border-radius`.** Anywhere. Not on buttons, not on inputs, not on
  panels. Round corners didn't exist in DOS. Setting it to even `2px`
  immediately breaks the feel.
- **No CSS transitions or animations** except the cursor blink (and maybe
  a single-frame "flash" on goal events if it's added later, but skip for v1).
  Hover states should snap, not fade.
- **No gradients, no shadows** on UI elements. The only "shadows" are
  `text-shadow` for character glow and the inset box-shadow on the CRT
  envelope. No drop shadows on panels.
- **No icons / SVGs / emoji.** Everything is typography. The glyph table
  above is the entire icon set. ⚽ would feel wrong; `►►►` feels right.
- **No second font.** VT323 everywhere. Mixing in a sans-serif "for headings"
  destroys the terminal coherence.
- **No `<form>` styling that makes inputs look modern.** Inputs should look
  like text fields in a DOS dialog: dark background, green text, no
  border-radius, optional 1px solid `--fg-dim` border. Focused state: full
  green border, no glow, no outline-offset.
- **No mobile responsive layout** in v1. Desktop-first, 80-column rigid.
  Adapt later if needed. The fixed-width layout is *part of the aesthetic*.

## Phase order (suggested)

1. **Tokens + global**: replace `:root` in `styles.css` with the new tokens.
   Update `html, body` background, base color, font, line-height, and add
   the global `text-shadow: var(--glow)` on body or `.app`.
2. **CRT envelope**: wrap `<main className="app">` content in a `.crt`
   container with the scanline + vignette pseudo-elements. Verify on a real
   match that the glow + scanlines feel right.
3. **`AsciiBox` component**: build the reusable box component. Use it first
   for the app header (double-line) and the form (single-line). Validate
   that fixed-width text wrapping behaves.
4. **Tabs and buttons**: rewrite the tab nav and the Jogar/Rodar Temporada
   buttons to use bracket notation + reverse-video active state.
5. **Match feed**: wrap in `AsciiBox` with the scoreline in the title.
   Update event classes/glyphs per the table above.
6. **Standings**: wrap in `AsciiBox`, drop the `<table>` borders, restyle
   header row in `--fg-dim`, leader's row in `--fg-hi`.
7. **Footer status line**: add a tiny component that shows the last action
   summary with the blinking cursor.
8. **QA pass**: open `mockup.html` side-by-side with `npm run dev` and walk
   through both screens. Anything that diverges from the mockup without a
   conscious reason gets fixed.

## What stays untouched

- `core/`, `cli/`, `wasm/` — none of this redesign touches Rust code.
- `web/src/teams.ts`, `web/src/types.ts` — domain types and sample data
  unchanged.
- The engine output (event log, scoreline, standings shape) is the input
  to this UI. Don't modify the engine to "help" the UI; do all formatting
  in the React layer.

## After this lands

Phase 2 (optional, not in scope for this prompt):
- Tactics screen with formation picker (drawing the 11 dots on an ASCII
  pitch, navigable with arrows).
- Sound: a single soft "beep" via WebAudio on goal events. Off by default,
  toggle in a settings dialog.
- Tick-by-tick live playback (the engine already supports this conceptually
  — Phase 5 simplification list mentions it as deferred).
