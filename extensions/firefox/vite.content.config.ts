import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL("./src/content.ts", import.meta.url)),
      formats: ["iife"],
      name: "IronkeepContent",
      fileName: () => "content.js",
    },
  },
});
