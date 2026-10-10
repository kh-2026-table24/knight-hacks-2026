import { defineConfig } from "vite";

export default defineConfig({
  // Expose GEMINI_IMAGE_KEY from .env.local to the browser (import.meta.env) so it can call Gemini directly.
  envPrefix: ["VITE_", "GEMINI_IMAGE_"],
});
