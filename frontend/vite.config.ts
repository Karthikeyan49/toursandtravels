import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  // Relative base: the built SPA is dropped into public_html/ on shared hosting
  // and must work whether it is served from / or a sub-path.
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 8080,
    proxy: {
      // Local dev: `php -S localhost:8000 -t api` serves the REST API, so the
      // SPA can keep using the same relative "/api" base as in production.
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep the heavyweight export/report libraries out of the entry chunk;
        // most sessions never open a PDF or an XLSX export.
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          export: ["jspdf", "jspdf-autotable", "xlsx"],
        },
      },
    },
  },
});
