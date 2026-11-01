import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({command}) => ({
  define: command === "serve" ? {"import.meta.env.VITE_API_URL": JSON.stringify("")} : {},
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": { target: "http://127.0.0.1:8100", ws: true }, "/health": "http://127.0.0.1:8100" } },
  build: { chunkSizeWarningLimit: 1100 },
}));
