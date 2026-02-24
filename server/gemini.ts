import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

if (!apiKey) {
  console.warn("No Gemini API key found — AI features will not work.");
}

const config: any = { apiKey: apiKey || "placeholder" };
if (baseUrl) {
  config.httpOptions = { baseUrl, apiVersion: "" };
}

export const gemini = new GoogleGenAI(config);
