import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import pkg from "./package.json" with { type: "json" };

// SRCL primitives import via @components/* and @common/*. Mirror those
// aliases here so we can drop SRCL source files in unchanged — keeps future
// upstream diffs trivial.
export default defineConfig({
  plugins: [react()],
  assetsInclude: ["**/*.wasm"],
  // Single source of truth for the app version: the UI reads __APP_VERSION__
  // (defined from package.json) so the header can't drift from the real
  // version again. Stringified per Vite's `define` contract.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@components": fileURLToPath(new URL("./src/srcl", import.meta.url)),
      "@common": fileURLToPath(new URL("./src/srcl/common", import.meta.url)),
    },
  },
});
