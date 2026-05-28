import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Phosphor-green ramp (light → dark), index 5/6 used as the default primary
// shades. Keeps the green-on-black identity while the layout goes responsive.
const phosphor: MantineColorsTuple = [
  "#e8ffe8",
  "#c2ffc2",
  "#8dff8d",
  "#5cff5c",
  "#33ff33",
  "#22d322",
  "#1c8a1c",
  "#136413",
  "#0c420c",
  "#062306",
];

const mono = "'PxPlus IBM VGA 9x16', 'VT323', ui-monospace, monospace";

export const theme = createTheme({
  primaryColor: "phosphor",
  colors: { phosphor },
  fontFamily: mono,
  fontFamilyMonospace: mono,
  headings: { fontFamily: mono },
  defaultRadius: "sm",
});
