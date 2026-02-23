import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { ai } from "./replit_integrations/image/client";

const KIE_API_KEY = process.env.KIE_API_KEY;
const NANO_BANANA_CREATE_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const NANO_BANANA_STATUS_URL = "https://api.kie.ai/api/v1/jobs/recordInfo";

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
- Дизайн должен быть современным, стильным и профессиональным
- Все тексты на русском языке, если не указано иное
- НЕ используй внешние библиотеки и CDN, только чистый HTML/CSS/JS
- Отвечай ТОЛЬКО кодом HTML, без пояснений и комментариев
- Весь код должен быть в одном HTML-файле

РАБОТА С ИЗОБРАЖЕНИЯМИ:
- Для КАЖДОГО изображения на сайте используй маркер: {{GENERATE_IMG:описание_на_английском||ширинаxвысота}}
- Описание должно быть на АНГЛИЙСКОМ языке и описывать нужную картинку максимально детально
- Формат размера: ширинаxвысота (например 1200x600, 400x400, 800x500)
- Примеры: 
  <img src="{{GENERATE_IMG:modern AI neural network abstract visualization with blue neon lights||1200x600}}" />
  <img src="{{GENERATE_IMG:professional team working in modern office||800x500}}" />
  background-image: url('{{GENERATE_IMG:dark gradient tech background with glowing particles||1920x1080}}')
- Каждое изображение должно быть тематически релевантно содержимому сайта
- Используй 4-8 изображений для полноценного лендинга
- НЕ используй placeholder сервисы (placehold.co, placeholder.com и т.д.)
- НЕ используй внешние URL изображений

ЕСЛИ у пользователя есть библиотека AI-изображений:
- Когда пользователь просит вставить конкретное изображение по имени, используй маркер: {{IMG:имя_изображения}}
- Маркер {{IMG:имя}} будет автоматически заменён на реальный URL из библиотеки`;

const RESEARCH_PROMPT = `Ты — аналитик-исследователь. Твоя задача — собрать максимум реальной информации по теме для создания веб-сайта.

На основе предоставленных результатов поиска, составь подробную структурированную справку:

1. ОСНОВНАЯ ИНФОРМАЦИЯ: Что это за продукт/услуга/тема? Официальное описание.
2. КЛЮЧЕВЫЕ ОСОБЕННОСТИ: Минимум 5-7 реальных особенностей/функций с описанием
3. ПРЕИМУЩЕСТВА: Реальные преимущества, подтверждённые источниками
4. ТЕХНИЧЕСКИЕ ДЕТАЛИ: Технологии, характеристики, спецификации
5. ФАКТЫ И ЦИФРЫ: Любые числа, статистика, даты
6. ЦИТАТЫ/ОТЗЫВЫ: Реальные отзывы или высказывания, если найдены
7. ЦЕНООБРАЗОВАНИЕ: Информация о ценах/тарифах, если доступна
8. ЦЕЛЕВАЯ АУДИТОРИЯ: Для кого предназначен продукт

Пиши ТОЛЬКО факты из источников. НЕ придумывай информацию. Если чего-то нет — так и напиши.
Отвечай на русском языке.`;

async function performWebResearch(query: string): Promise<string> {
  try {
    console.log("Starting web research for:", query);

    const researchResult = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [{ role: "user", parts: [{ text: `Исследуй тему "${query}" для создания сайта. Найди реальную информацию минимум из 7 источников. Дай подробные факты, цифры, особенности, преимущества.` }] }],
      config: {
        systemInstruction: RESEARCH_PROMPT,
        tools: [{ googleSearch: {} }],
      },
    });

    const researchText = researchResult.text || "";
    console.log("Research completed, length:", researchText.length);

    const groundingMeta = (researchResult as any).candidates?.[0]?.groundingMetadata;
    let sources = "";
    if (groundingMeta?.groundingChunks) {
      sources = "\n\nИСТОЧНИКИ:\n";
      for (const chunk of groundingMeta.groundingChunks.slice(0, 10)) {
        if (chunk.web) {
          sources += `- ${chunk.web.title}: ${chunk.web.uri}\n`;
        }
      }
    }

    return researchText + sources;
  } catch (err: any) {
    console.error("Web research error:", err.message);
    return `Не удалось выполнить исследование. Создай сайт на основе общих знаний о теме: "${query}"`;
  }
}

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

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let researchData = "";
      const isNewSite = !project.generatedCode;

      if (isNewSite) {
        res.write(`data: ${JSON.stringify({ status: "Исследуем тему в интернете..." })}\n\n`);
        researchData = await performWebResearch(prompt);
        console.log("Research data length:", researchData.length);
        res.write(`data: ${JSON.stringify({ status: "Исследование завершено. Генерируем сайт..." })}\n\n`);
      }

      let systemContent = SYSTEM_PROMPT;
      if (projectImgs.length > 0) {
        systemContent += `\n\nДОСТУПНЫЕ ИЗОБРАЖЕНИЯ В БИБЛИОТЕКЕ ПОЛЬЗОВАТЕЛЯ:\n`;
        for (const img of projectImgs) {
          systemContent += `- "${img.name}" (описание: ${img.prompt})\n`;
        }
        systemContent += `\nИспользуй маркер {{IMG:имя}} для вставки этих изображений. Например: <img src="{{IMG:${projectImgs[0].name}}}" />`;
      }

      const geminiHistory: any[] = [];

      for (const msg of previousMessages.slice(0, -1)) {
        geminiHistory.push({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.content }],
        });
      }

      const userParts: any[] = [];

      if (imageBase64) {
        const textPart = project.generatedCode
          ? `Текущий код сайта:\n\`\`\`html\n${project.generatedCode}\n\`\`\`\n\nЗапрос пользователя: ${prompt}\n\nВнеси изменения и верни ПОЛНЫЙ обновлённый HTML-код.`
          : `Создай сайт на основе этого изображения-примера. ${prompt}`;
        userParts.push({ text: textPart });
        userParts.push({ inlineData: { data: imageBase64, mimeType: "image/png" } });
      } else if (project.generatedCode) {
        userParts.push({ text: `Текущий код сайта:\n\`\`\`html\n${project.generatedCode}\n\`\`\`\n\nЗапрос пользователя: ${prompt}\n\nВнеси изменения и верни ПОЛНЫЙ обновлённый HTML-код.` });
      } else {
        let researchBlock = "";
        if (researchData) {
          researchBlock = `\n\nРЕЗУЛЬТАТЫ ИССЛЕДОВАНИЯ ТЕМЫ (используй ТОЛЬКО эту реальную информацию, НЕ придумывай):\n---\n${researchData}\n---\n\nСоздай сайт СТРОГО на основе этих реальных данных. Используй найденные факты, цифры, особенности и описания. НЕ выдумывай информацию.`;
        }
        userParts.push({ text: `${prompt}${researchBlock}` });
      }

      let fullResponse = "";

      console.log("Gemini generation started, history length:", geminiHistory.length);

      const streamResult = await ai.models.generateContentStream({
        model: "gemini-3.1-pro-preview",
        contents: [
          ...geminiHistory,
          { role: "user", parts: userParts },
        ],
        config: {
          systemInstruction: systemContent,
          maxOutputTokens: 65536,
        },
      });

      for await (const chunk of streamResult) {
        const text = chunk.text || "";
        if (text) {
          fullResponse += text;
          res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
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

      const genImgRegex = /\{\{GENERATE_IMG:([^|]+)\|\|(\d+x\d+)\}\}/g;
      const imageMarkers: { full: string; prompt: string; size: string }[] = [];
      let genMatch;
      while ((genMatch = genImgRegex.exec(htmlCode)) !== null) {
        imageMarkers.push({ full: genMatch[0], prompt: genMatch[1].trim(), size: genMatch[2] });
      }

      if (imageMarkers.length > 0) {
        res.write(`data: ${JSON.stringify({ status: `Генерируем ${imageMarkers.length} изображений...` })}\n\n`);
        console.log(`Auto-generating ${imageMarkers.length} images`);

        const imageResults = await Promise.allSettled(
          imageMarkers.map(async (marker) => {
            try {
              const [w, h] = marker.size.split("x");
              let kieSize = "16:9";
              const ratio = parseInt(w) / parseInt(h);
              if (ratio > 1.5) kieSize = "16:9";
              else if (ratio > 1.1) kieSize = "4:3";
              else if (ratio > 0.9) kieSize = "1:1";
              else kieSize = "9:16";

              const createResp = await fetch(NANO_BANANA_CREATE_URL, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${KIE_API_KEY}`,
                },
                body: JSON.stringify({
                  model: "google/nano-banana",
                  input: {
                    prompt: marker.prompt,
                    output_format: "png",
                    image_size: kieSize,
                  },
                }),
              });
              const createBody = await createResp.json();
              if (createBody.code !== 200 || !createBody.data?.taskId) {
                throw new Error(createBody.msg || "Task creation failed");
              }

              const taskId = createBody.data.taskId;
              for (let i = 0; i < 40; i++) {
                await new Promise(r => setTimeout(r, 3000));
                const statusResp = await fetch(`${NANO_BANANA_STATUS_URL}?taskId=${taskId}`, {
                  headers: { "Authorization": `Bearer ${KIE_API_KEY}` },
                });
                const statusBody = await statusResp.json();
                if (statusBody.code !== 200) continue;
                const state = statusBody.data?.state;
                if (state === "success") {
                  const result = JSON.parse(statusBody.data.resultJson);
                  const urls = result.resultUrls || [];
                  return { marker: marker.full, url: urls[0] || null };
                }
                if (state === "fail") throw new Error("Generation failed");
              }
              throw new Error("Timeout");
            } catch (err: any) {
              console.error(`Image gen failed for "${marker.prompt}":`, err.message);
              return { marker: marker.full, url: null };
            }
          })
        );

        let imgCount = 0;
        for (const result of imageResults) {
          if (result.status === "fulfilled" && result.value.url) {
            htmlCode = htmlCode.replace(result.value.marker, result.value.url);
            imgCount++;
          }
        }

        const remaining = htmlCode.match(/\{\{GENERATE_IMG:[^}]+\}\}/g);
        if (remaining) {
          for (const r of remaining) {
            htmlCode = htmlCode.replace(r, `https://placehold.co/800x400/1a1a2e/e0e0e0?text=Image`);
          }
        }

        console.log(`Generated ${imgCount}/${imageMarkers.length} images successfully`);
        res.write(`data: ${JSON.stringify({ status: `Готово! ${imgCount} из ${imageMarkers.length} изображений создано` })}\n\n`);
      }

      if (project.generatedCode && project.generatedCode.trim()) {
        await storage.createProjectVersion({
          projectId: project.id,
          code: project.generatedCode,
          label: `До: "${prompt.substring(0, 50)}${prompt.length > 50 ? "..." : ""}"`,
        });
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

  app.get("/api/projects/:id/versions", bypassAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });
      const versions = await storage.getProjectVersions(project.id);
      res.json(versions);
    } catch (err) {
      res.status(500).json({ message: "Ошибка загрузки версий" });
    }
  });

  app.post("/api/projects/:id/versions", bypassAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });
      if (!project.generatedCode?.trim()) return res.status(400).json({ message: "Нет кода для сохранения" });
      const { label } = req.body;
      const version = await storage.createProjectVersion({
        projectId: project.id,
        code: project.generatedCode,
        label: label || "Ручной чекпоинт",
      });
      res.status(201).json(version);
    } catch (err) {
      res.status(500).json({ message: "Ошибка сохранения версии" });
    }
  });

  app.post("/api/projects/:id/versions/:versionId/restore", bypassAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });

      const versions = await storage.getProjectVersions(project.id);
      const version = versions.find(v => v.id === parseInt(req.params.versionId));
      if (!version) return res.status(404).json({ message: "Версия не найдена" });

      if (project.generatedCode?.trim()) {
        await storage.createProjectVersion({
          projectId: project.id,
          code: project.generatedCode,
          label: "До отката",
        });
      }

      const updated = await storage.updateProject(project.id, { generatedCode: version.code });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Ошибка восстановления версии" });
    }
  });

  app.get("/api/proxy-image", bypassAuth, async (req, res) => {
    try {
      const imageUrl = req.query.url as string;
      if (!imageUrl || !imageUrl.startsWith("http")) {
        return res.status(400).json({ message: "URL обязателен" });
      }
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error("Не удалось загрузить изображение");
      const contentType = response.headers.get("content-type") || "image/png";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=3600");
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (err) {
      res.status(500).json({ message: "Ошибка загрузки изображения" });
    }
  });

  return httpServer;
}
