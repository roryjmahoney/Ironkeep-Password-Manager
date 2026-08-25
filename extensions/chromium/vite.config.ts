import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: fromRoot("./popup.html"),
        clipboard: fromRoot("./clipboard.html"),
        background: fromRoot("./src/background.ts"),
      },
      output: {
        entryFileNames: (chunk) => chunk.name === "popup" ? "assets/[name]-[hash].js" : "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
