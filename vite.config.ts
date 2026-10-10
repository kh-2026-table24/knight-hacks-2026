import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // The game server (server/, started alongside Vite by `npm run dev`) handles /api.
    proxy: { "/api": "http://localhost:3002" },
    // Saved games and generated assets shouldn't trigger reloads.
    watch: { ignored: ["**/server/**"] },
  },
});
