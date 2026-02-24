import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("GEMINI_API_KEY not set — direct Gemini API will not work. Set it in Secrets.");
}

export const gemini = new GoogleGenAI({ apiKey: apiKey || "placeholder" });
