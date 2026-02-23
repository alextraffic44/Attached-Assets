import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

const SYSTEM_PROMPT = `Ты — профессиональный веб-разработчик. Твоя задача — генерировать полный HTML-код сайта.

ВАЖНЫЕ ТРЕБОВАНИЯ:
- Генерируй ПОЛНЫЙ HTML-документ с <!DOCTYPE html>, <head> и <body>
- Весь CSS пиши внутри тега <style> в <head>
- Весь JavaScript пиши внутри тега <script> перед </body>
- Используй современные теги HTML5 и семантическую верстку для SEO
- Добавляй мета-теги (description, viewport, charset)
- Прописывай alt для всех изображений
- Используй сложные тени для скевоморфного стиля
- Добавляй интерактивные SVG-анимации где уместно
- Код должен быть адаптивным (Mobile First)
- Используй современные CSS-свойства: grid, flexbox, custom properties
- Для изображений используй placeholder от https://placehold.co/ (например https://placehold.co/600x400)
- Дизайн должен быть современным, стильным и профессиональным
- Все тексты на русском языке, если не указано иное
- НЕ используй внешние библиотеки и CDN, только чистый HTML/CSS/JS
- Отвечай ТОЛЬКО кодом HTML, без пояснений и комментариев
- Весь код должен быть в одном HTML-файле`;

function bypassAuth(req: any, res: any, next: any) {
  // Временно отключаем проверку авторизации
  if (!req.user) {
    req.user = { id: 1, credits: 999, displayName: "Гость" };
  }
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);

  app.get("/api/projects", bypassAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const userProjects = await storage.getProjectsByUser(user.id);
      res.json(userProjects);
    } catch (err) {
      res.status(500).json({ message: "Ошибка загрузки проектов" });
    }
  });

  app.get("/api/projects/:id", bypassAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) {
        return res.status(404).json({ message: "Проект не найден" });
      }
      const user = req.user as any;
      if (project.userId !== user.id) {
        return res.status(403).json({ message: "Доступ запрещён" });
      }
      res.json(project);
    } catch (err) {
      res.status(500).json({ message: "Ошибка загрузки проекта" });
    }
  });

  app.post("/api/projects", bypassAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const { title, description } = req.body;
      const project = await storage.createProject({
        userId: user.id,
        title: title || "Новый проект",
        description: description || null,
        generatedCode: "",
      });
      res.status(201).json(project);
    } catch (err) {
      res.status(500).json({ message: "Ошибка создания проекта" });
    }
  });

  app.delete("/api/projects/:id", bypassAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) {
        return res.status(404).json({ message: "Проект не найден" });
      }
      const user = req.user as any;
      if (project.userId !== user.id) {
        return res.status(403).json({ message: "Доступ запрещён" });
      }
      await storage.deleteProject(project.id);
      res.json({ message: "Проект удалён" });
    } catch (err) {
      res.status(500).json({ message: "Ошибка удаления проекта" });
    }
  });

  app.get("/api/projects/:id/messages", bypassAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) {
        return res.status(404).json({ message: "Проект не найден" });
      }
      const user = req.user as any;
      if (project.userId !== user.id) {
        return res.status(403).json({ message: "Доступ запрещён" });
      }
      const messages = await storage.getProjectMessages(project.id);
      res.json(messages);
    } catch (err) {
      res.status(500).json({ message: "Ошибка загрузки сообщений" });
    }
  });

  app.post("/api/projects/:id/generate", bypassAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) {
        return res.status(404).json({ message: "Проект не найден" });
      }
      const user = req.user as any;

      if (user.credits <= 0) {
        return res.status(403).json({ message: "Недостаточно кредитов" });
      }

      const { prompt, imageBase64 } = req.body;
      if (!prompt) {
        return res.status(400).json({ message: "Запрос обязателен" });
      }

      await storage.createProjectMessage({
        projectId: project.id,
        role: "user",
        content: prompt,
      });

      const previousMessages = await storage.getProjectMessages(project.id);
      const chatHistory: any[] = [
        { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
        { role: "model", parts: [{ text: "Понял. Я буду генерировать полный HTML-код сайта, следуя всем указанным требованиям. Готов к работе." }] },
      ];

      for (const msg of previousMessages.slice(0, -1)) {
        chatHistory.push({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.content }],
        });
      }

      const userParts: any[] = [];

      if (project.generatedCode) {
        userParts.push({ text: `Текущий код сайта:\n\`\`\`html\n${project.generatedCode}\n\`\`\`\n\nЗапрос пользователя: ${prompt}\n\nВнеси изменения и верни ПОЛНЫЙ обновлённый HTML-код.` });
      } else {
        userParts.push({ text: prompt });
      }

      if (imageBase64) {
        userParts.push({
          inlineData: {
            mimeType: "image/png",
            data: imageBase64,
          },
        });
        if (!project.generatedCode) {
          userParts[0] = { text: `Создай сайт на основе этого изображения-примера. ${prompt}` };
        }
      }

      chatHistory.push({ role: "user", parts: userParts });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let fullResponse = "";

      const stream = await ai.models.generateContentStream({
        model: "gemini-1.5-pro",
        contents: chatHistory,
        config: { maxOutputTokens: 65536 },
      });

      for await (const chunk of stream) {
        const text = chunk.text || "";
        if (text) {
          fullResponse += text;
          res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
        }
      }

      let htmlCode = fullResponse;
      const htmlMatch = fullResponse.match(/```html\n?([\s\S]*?)```/);
      if (htmlMatch) {
        htmlCode = htmlMatch[1].trim();
      } else if (fullResponse.includes("<!DOCTYPE") || fullResponse.includes("<html")) {
        htmlCode = fullResponse.trim();
      }

      await storage.updateProject(project.id, { generatedCode: htmlCode });
      await storage.createProjectMessage({
        projectId: project.id,
        role: "model",
        content: htmlCode,
      });

      // await storage.updateUserCredits(user.id, Math.max(0, user.credits - 1));

      res.write(`data: ${JSON.stringify({ done: true, code: htmlCode })}\n\n`);
      res.end();
    } catch (err: any) {
      console.error("Generation error:", err);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Ошибка генерации" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ message: "Ошибка генерации" });
      }
    }
  });

  app.put("/api/projects/:id/code", bypassAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) {
        return res.status(404).json({ message: "Проект не найден" });
      }
      const user = req.user as any;
      if (project.userId !== user.id) {
        return res.status(403).json({ message: "Доступ запрещён" });
      }
      const { generatedCode } = req.body;
      const updated = await storage.updateProject(project.id, { generatedCode });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Ошибка обновления кода" });
    }
  });

  return httpServer;
}
