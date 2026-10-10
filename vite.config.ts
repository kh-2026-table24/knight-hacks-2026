import { defineConfig } from "vite";

export default defineConfig({
  // Expose GEMINI_IMAGE_KEY from .env.local to the browser (import.meta.env) so it can call Gemini directly.
  envPrefix: ["VITE_", "GEMINI_IMAGE_"],
  server: {
    // The game server (server/, started alongside Vite by `npm run dev`) handles /api.
    proxy: { "/api": "http://localhost:3002" },
    // Saved games and generated assets shouldn't trigger reloads.
    watch: { ignored: ["**/server/**"] },
  },
});
