import { GoogleGenAI } from "@google/genai";

// Reads GEMINI_API_KEY from the environment (loaded from .env.local).
const ai = new GoogleGenAI({});

// Connection test (free tier text model): npm run gemini-text -- "your message"
const prompt = process.argv[2] ?? "Hello Gemini! Reply with a short greeting to confirm the connection works.";

try {
  console.log(`> ${prompt}\n`);
  const interaction = await ai.interactions.create({
    model: "gemini-3.8-flash",
    input: prompt,
  });
  console.log(interaction.output_text);
} catch (error) {
  console.error(error);
  process.exit(1);
}
