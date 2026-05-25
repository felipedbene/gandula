import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Allow .wasm asset imports; wasm-pack output works as ES module.
  assetsInclude: ["**/*.wasm"],
});
