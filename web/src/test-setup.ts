// Vitest setup file (referenced from vitest.config.ts).
// Registers @testing-library/jest-dom's matchers (toBeDisabled, toHaveValue,
// toBeInTheDocument, etc.) so component tests can use them without per-file
// imports.
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// happy-dom doesn't implement matchMedia / ResizeObserver, which Mantine
// components touch on mount. Stub them so Mantine UI can render in tests.
// Guarded by `typeof window` because the util test files run in a Node env
// (no DOM) under the same shared setup.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
