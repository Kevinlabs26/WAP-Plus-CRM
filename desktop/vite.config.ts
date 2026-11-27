import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  clearScreen: false,
  server: {
    // The usual local dev ports are occupied on this workstation.
    port: 43871,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // Tauri signing secrets must never enter import.meta.env.
  envPrefix: ["VITE_"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        museWorkspace: path.resolve(__dirname, "muse-workspace.html"),
      },
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (normalized.includes("/node_modules/")) {
            if (
              normalized.includes("/react/") ||
              normalized.includes("/react-dom/") ||
              normalized.includes("/scheduler/") ||
              normalized.includes("/zustand/")
            ) {
              return "vendor-react";
            }
            if (normalized.includes("/@tauri-apps/")) {
              return "vendor-tauri";
            }
            if (normalized.includes("/lucide-react/")) {
              return "vendor-icons";
            }
            if (normalized.includes("/react-virtuoso/")) {
              return "vendor-virtuoso";
            }
            if (normalized.includes("/xlsx/")) {
              return "vendor-xlsx";
            }
            return undefined;
          }
          if (normalized.includes("/src/i18n/locales/zh-CN")) {
            return "locale-zh-CN";
          }
          if (normalized.includes("/src/i18n/locales/en")) {
            return "locale-en";
          }
          if (normalized.includes("/src/i18n/locales/fr")) {
            return "locale-fr";
          }
          return undefined;
        },
      },
    },
  },
});
