import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Electric-blue accent for actions, highlights and the active team. Index 5/6
// are the default primary shades; the brighter low indices read well on dark.
const accent: MantineColorsTuple = [
  "#e6f3ff",
  "#cde3ff",
  "#9cc4ff",
  "#66a3ff",
  "#3d87ff",
  "#1f74ff", // primary
  "#0f63f0",
  "#0a4fc4",
  "#093f99",
  "#062c6e",
];

// Neutral ink ramp: app background (9) → card surfaces (8/7) → text (0/1).
// Replaces the old green-on-black with a calmer, modern "stadium night" dark.
// Ultra-deep space dark ramp for maximum contrast
const ink: MantineColorsTuple = [
  "#f4f6f7",
  "#d6dbde",
  "#a2aeb5",
  "#6b7a84",
  "#4d5a62",
  "#343d43",
  "#21282c",
  "#14181a",
  "#0a0c0d", // base cards
  "#050608", // app background
];

const sans = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
const mono = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace";
const display = "'Outfit', system-ui, sans-serif";

// Secondary gold/amber accent for milestones, championships
const gold: MantineColorsTuple = [
  "#fff8e1",
  "#ffecb3",
  "#ffe082",
  "#ffd54f",
  "#ffca28",
  "#ffc107", // primary
  "#ffb300",
  "#ffa000",
  "#ff8f00",
  "#ff6f00",
];

export const theme = createTheme({
  primaryColor: "accent",
  primaryShade: { light: 5, dark: 5 },
  colors: { accent, ink, gold },
  fontFamily: sans,
  // Mono is reserved for tabular data (scores, points, money) — set explicitly
  // via ff="monospace" on those Text/Table cells, not the global default.
  fontFamilyMonospace: mono,
  headings: { fontFamily: display, fontWeight: "700" },
  defaultRadius: "md",
  components: {
    Button: {
      defaultProps: {
        radius: "xl",
        fw: 600,
        ff: display,
      },
      styles: {
        root: {
          transition: "transform 0.15s ease, box-shadow 0.15s ease",
        },
      },
    },
    Title: {
      defaultProps: {
        ff: display,
      },
    },
    Card: {
      defaultProps: {
        radius: "lg",
      },
    },
    Badge: {
      defaultProps: {
        radius: "sm",
      },
    },
  },
});
