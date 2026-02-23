import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";

const KIE_API_URL = "https://api.kie.ai/gemini-3-pro/v1/chat/completions";
const KIE_API_KEY = process.env.KIE_API_KEY;

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
      const chatMessages: any[] = [
        { role: "system", content: SYSTEM_PROMPT },
      ];

      for (const msg of previousMessages.slice(0, -1)) {
        chatMessages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }

      let userContent: any;

      if (imageBase64) {
        const textPart = project.generatedCode
          ? `Текущий код сайта:\n\`\`\`html\n${project.generatedCode}\n\`\`\`\n\nЗапрос пользователя: ${prompt}\n\nВнеси изменения и верни ПОЛНЫЙ обновлённый HTML-код.`
          : `Создай сайт на основе этого изображения-примера. ${prompt}`;
        userContent = [
          { type: "text", text: textPart },
          { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
        ];
      } else if (project.generatedCode) {
        userContent = `Текущий код сайта:\n\`\`\`html\n${project.generatedCode}\n\`\`\`\n\nЗапрос пользователя: ${prompt}\n\nВнеси изменения и верни ПОЛНЫЙ обновлённый HTML-код.`;
      } else {
        userContent = prompt;
      }

      chatMessages.push({ role: "user", content: userContent });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let fullResponse = "";

      try {
        const kieResponse = await fetch(KIE_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${KIE_API_KEY}`,
          },
          body: JSON.stringify({
            model: "gemini-3-pro",
            messages: chatMessages,
            max_tokens: 65536,
            stream: true,
          }),
        });

        console.log("KIE API response status:", kieResponse.status);
        console.log("KIE API response headers:", Object.fromEntries(kieResponse.headers.entries()));

        if (!kieResponse.ok) {
          const errText = await kieResponse.text();
          console.error("KIE API error body:", errText);
          throw new Error(`KIE API error: ${kieResponse.status} - ${errText}`);
        }

        const contentType = kieResponse.headers.get("content-type") || "";
        console.log("KIE API content-type:", contentType);

        if (contentType.includes("text/event-stream")) {
          const reader = kieResponse.body?.getReader();
          if (!reader) throw new Error("No response body");

          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data: ")) continue;
              const dataStr = trimmed.slice(6);
              if (dataStr === "[DONE]") continue;

              try {
                const parsed = JSON.parse(dataStr);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  fullResponse += delta;
                  res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
                }
              } catch (parseErr) {
                console.log("SSE parse chunk:", dataStr.substring(0, 200));
              }
            }
          }
        } else {
          const jsonBody = await kieResponse.json();
          console.log("KIE API JSON response keys:", Object.keys(jsonBody));
          const content = jsonBody.choices?.[0]?.message?.content || "";
          fullResponse = content;
          if (content) {
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        }
      } catch (fetchErr: any) {
        console.error("KIE fetch error:", fetchErr.message);

        if (!fullResponse) {
          console.log("Falling back to non-streaming request...");
          const fallbackResponse = await fetch(KIE_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${KIE_API_KEY}`,
            },
            body: JSON.stringify({
              model: "gemini-3-pro",
              messages: chatMessages,
              max_tokens: 65536,
              stream: false,
            }),
          });

          console.log("Fallback status:", fallbackResponse.status);
          const fallbackBody = await fallbackResponse.json();
          console.log("Fallback response keys:", Object.keys(fallbackBody));
          const content = fallbackBody.choices?.[0]?.message?.content || "";
          fullResponse = content;
          if (content) {
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        }
      }

      console.log("Total response length:", fullResponse.length);
      console.log("Response preview:", fullResponse.substring(0, 200));

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
