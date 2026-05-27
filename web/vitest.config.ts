import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Mirror vite.config.ts's plugin chain + path aliases so test files resolve
// imports identically to the build (especially the SRCL @components / @common
// aliases). vite handles .wasm as an asset, but tests load the .wasm bytes
// directly via fs in test setup — see resimulate.test.ts.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@components": fileURLToPath(new URL("./src/srcl", import.meta.url)),
      "@common": fileURLToPath(new URL("./src/srcl/common", import.meta.url)),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // Note: happy-dom resolves import.meta.url differently based on extension:
    //   .test.ts  → http://localhost:3000/... (fileURLToPath throws)
    //   .test.tsx → file:///... (file-anchor works directly)
    // Tests loading the WASM binary must therefore either:
    //   (a) use .tsx + fileURLToPath(import.meta.url)
    //   (b) use .ts + cwd-relative path (resolve("src/wasm/..."))
    //   (c) add `// @vitest-environment node` at file top
    // See resimulate.test.ts (pattern c) and TacticsView.test.tsx (pattern a).
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "src/wasm/**"],
  },
});
