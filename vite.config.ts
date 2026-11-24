import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "bundle-font-licenses",
      apply: "build",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "licenses/ibm-plex-sans.txt",
          source: readFileSync(
            require.resolve("@fontsource-variable/ibm-plex-sans/LICENSE"),
          ),
        });
        // Fontsource's Commit Mono license omits the upstream copyright notice.
        this.emitFile({
          type: "asset",
          fileName: "licenses/commit-mono.txt",
          source:
            "Copyright (c) 2023 Eigil Nikolajsen (eigi0088@gmail.com)\n\n" +
            readFileSync(
              require.resolve("@fontsource/commit-mono/LICENSE"),
              "utf8",
            ),
        });
      },
    },
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  optimizeDeps: {
    include: [
      "@uiw/react-codemirror",
      "@codemirror/lang-sql",
      "@codemirror/language",
      "@lezer/highlight",
    ],
  },
  clearScreen: false,
});
