import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// SRCL primitives import via @components/* and @common/*. Mirror those
// aliases here so we can drop SRCL source files in unchanged — keeps future
// upstream diffs trivial.
export default defineConfig({
  plugins: [react()],
  assetsInclude: ["**/*.wasm"],
  resolve: {
    alias: {
      "@components": fileURLToPath(new URL("./src/srcl", import.meta.url)),
      "@common": fileURLToPath(new URL("./src/srcl/common", import.meta.url)),
    },
  },
});
