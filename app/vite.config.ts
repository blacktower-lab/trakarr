import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base so the build can be served from any path. In development the
// API is on trakarr's port, and the UI reaches it through this proxy, and the
// dev server may serve the repository's assets/, where the brand's mark lives.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  server: { fs: { allow: [".."] }, proxy: { "/api": "http://localhost:7478" } },
});
