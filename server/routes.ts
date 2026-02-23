import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";

const KIE_API_URL = "https://api.kie.ai/gemini-3-pro/v1/chat/completions";
const KIE_API_KEY = process.env.KIE_API_KEY;

const NANO_BANANA_CREATE_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const NANO_BANANA_STATUS_URL = "https://api.kie.ai/api/v1/jobs/recordInfo";

async function pollNanoBananaTask(taskId: string, maxAttempts = 60): Promise<string[]> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const resp = await fetch(`${NANO_BANANA_STATUS_URL}?taskId=${taskId}`, {
      headers: { "Authorization": `Bearer ${KIE_API_KEY}` },
    });
    const body = await resp.json();
    if (body.code !== 200) throw new Error(body.msg || "Ошибка проверки статуса");
    const state = body.data?.state;
    if (state === "success") {
      const result = JSON.parse(body.data.resultJson);
      return result.resultUrls || [];
    }
    if (state === "fail") {
      throw new Error(body.data.failMsg || "Генерация изображения не удалась");
    }
  }
  throw new Error("Таймаут генерации изображения");
}

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
- Для изображений-заглушек используй placeholder от https://placehold.co/ (например https://placehold.co/600x400)
- Дизайн должен быть современным, стильным и профессиональным
- Все тексты на русском языке, если не указано иное
- НЕ используй внешние библиотеки и CDN, только чистый HTML/CSS/JS
- Отвечай ТОЛЬКО кодом HTML, без пояснений и комментариев
- Весь код должен быть в одном HTML-файле

РАБОТА С ИЗОБРАЖЕНИЯМИ:
- У пользователя есть библиотека сгенерированных AI-изображений. Каждое изображение имеет уникальное имя.
- Когда пользователь просит вставить конкретное изображение по имени (например "персик", "офис", "баннер"), используй специальный маркер: {{IMG:имя_изображения}}
- Например: <img src="{{IMG:персик}}" alt="Персик" /> или background-image: url('{{IMG:баннер}}')
- Маркер {{IMG:имя}} будет автоматически заменён на реальный URL изображения
- Если пользователь не указал конкретное изображение — используй placeholder от placehold.co
- Маркер должен содержать ТОЧНОЕ имя изображения, как его назвал пользователь`;

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
      const projectImgs = await storage.getProjectImages(project.id);

      let systemContent = SYSTEM_PROMPT;
      if (projectImgs.length > 0) {
        systemContent += `\n\nДОСТУПНЫЕ ИЗОБРАЖЕНИЯ В БИБЛИОТЕКЕ ПОЛЬЗОВАТЕЛЯ:\n`;
        for (const img of projectImgs) {
          systemContent += `- "${img.name}" (описание: ${img.prompt})\n`;
        }
        systemContent += `\nИспользуй маркер {{IMG:имя}} для вставки этих изображений. Например: <img src="{{IMG:${projectImgs[0].name}}}" />`;
      }

      const chatMessages: any[] = [
        { role: "system", content: systemContent },
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
        const requestBody = {
          model: "gemini-3-pro",
          messages: chatMessages,
          max_tokens: 65536,
          stream: true,
        };
        console.log("KIE request URL:", KIE_API_URL);
        console.log("KIE request body keys:", Object.keys(requestBody));
        console.log("KIE messages count:", chatMessages.length);

        const kieResponse = await fetch(KIE_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${KIE_API_KEY}`,
            "api-key": KIE_API_KEY || "",
          },
          body: JSON.stringify(requestBody),
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
          console.log("KIE API JSON response:", JSON.stringify(jsonBody).substring(0, 2000));
          if (jsonBody.code && jsonBody.msg) {
            console.error("KIE API returned error:", jsonBody.code, jsonBody.msg);
            throw new Error(`KIE API error: ${jsonBody.code} - ${jsonBody.msg}`);
          }
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
              "api-key": KIE_API_KEY || "",
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

      const imgMarkerRegex = /\{\{IMG:([^}]+)\}\}/g;
      let markerMatch;
      while ((markerMatch = imgMarkerRegex.exec(htmlCode)) !== null) {
        const imgName = markerMatch[1].trim().toLowerCase();
        const found = projectImgs.find(img => img.name.toLowerCase() === imgName);
        if (found) {
          htmlCode = htmlCode.replace(markerMatch[0], found.url);
        }
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

  app.post("/api/images/generate", bypassAuth, async (req, res) => {
    try {
      const { prompt, imageSize = "16:9", outputFormat = "png" } = req.body;
      if (!prompt) {
        return res.status(400).json({ message: "Промпт обязателен" });
      }

      const createResp = await fetch(NANO_BANANA_CREATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${KIE_API_KEY}`,
        },
        body: JSON.stringify({
          model: "google/nano-banana",
          input: {
            prompt,
            output_format: outputFormat,
            image_size: imageSize,
          },
        }),
      });

      const createBody = await createResp.json();
      console.log("Nano Banana create response:", JSON.stringify(createBody));

      if (createBody.code !== 200 || !createBody.data?.taskId) {
        return res.status(500).json({ message: createBody.msg || "Ошибка создания задачи" });
      }

      res.json({ taskId: createBody.data.taskId });
    } catch (err: any) {
      console.error("Image generation error:", err);
      res.status(500).json({ message: "Ошибка генерации изображения" });
    }
  });

  app.get("/api/images/status/:taskId", bypassAuth, async (req, res) => {
    try {
      const { taskId } = req.params;
      const resp = await fetch(`${NANO_BANANA_STATUS_URL}?taskId=${taskId}`, {
        headers: { "Authorization": `Bearer ${KIE_API_KEY}` },
      });
      const body = await resp.json();
      console.log("Nano Banana status:", JSON.stringify(body).substring(0, 500));

      if (body.code !== 200) {
        return res.status(500).json({ message: body.msg || "Ошибка проверки статуса" });
      }

      const state = body.data?.state;
      if (state === "success") {
        const result = JSON.parse(body.data.resultJson);
        return res.json({ state: "success", urls: result.resultUrls || [] });
      }
      if (state === "fail") {
        return res.json({ state: "fail", error: body.data.failMsg || "Ошибка генерации" });
      }
      return res.json({ state: "waiting" });
    } catch (err: any) {
      console.error("Image status error:", err);
      res.status(500).json({ message: "Ошибка проверки статуса" });
    }
  });

  app.get("/api/projects/:id/images", bypassAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });
      const images = await storage.getProjectImages(project.id);
      res.json(images);
    } catch (err) {
      res.status(500).json({ message: "Ошибка загрузки изображений" });
    }
  });

  app.post("/api/projects/:id/images", bypassAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });
      const { name, url, prompt } = req.body;
      if (!name || !url) return res.status(400).json({ message: "Имя и URL обязательны" });
      const image = await storage.createProjectImage({ projectId: project.id, name, url, prompt: prompt || "" });
      res.status(201).json(image);
    } catch (err) {
      res.status(500).json({ message: "Ошибка сохранения изображения" });
    }
  });

  app.delete("/api/projects/:id/images/:imageId", bypassAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });
      await storage.deleteProjectImage(parseInt(req.params.imageId));
      res.json({ message: "Изображение удалено" });
    } catch (err) {
      res.status(500).json({ message: "Ошибка удаления изображения" });
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
