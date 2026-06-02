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
const ink: MantineColorsTuple = [
  "#f4f6f7",
  "#e4e8ea",
  "#c5cccf",
  "#9aa4a9",
  "#717c82",
  "#525c61",
  "#3b4347",
  "#272d30",
  "#181d20",
  "#0e1214",
];

const sans = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
const mono = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace";

export const theme = createTheme({
  primaryColor: "accent",
  primaryShade: { light: 5, dark: 5 },
  colors: { accent, ink },
  fontFamily: sans,
  // Mono is reserved for tabular data (scores, points, money) — set explicitly
  // via ff="monospace" on those Text/Table cells, not the global default.
  fontFamilyMonospace: mono,
  headings: { fontFamily: sans, fontWeight: "700" },
  defaultRadius: "md",
});
