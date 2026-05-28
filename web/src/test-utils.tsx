import type { ReactElement, ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { render as rtlRender, type RenderOptions } from "@testing-library/react";
import { theme } from "./theme";

// Custom render that wraps the tree in MantineProvider, so component tests
// that mount Mantine UI don't throw "MantineProvider was not found". Mirrors
// the provider setup in main.tsx.
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      {children}
    </MantineProvider>
  );
}

function render(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return rtlRender(ui, { wrapper: Wrapper, ...options });
}

// Re-export the rest of the testing-library API; the local `render` shadows
// the star-exported one.
export * from "@testing-library/react";
export { render };
