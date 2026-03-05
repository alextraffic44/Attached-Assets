import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { gemini } from "./gemini";
import { deployToVercel, addCustomDomain, checkDomainStatus, unpublishFromVercel } from "./vercel-deploy";
import { ObjectStorageService, objectStorageClient } from "./replit_integrations/object_storage";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const objectStorage = new ObjectStorageService();

async function uploadToObjectStorage(buffer: Buffer, mimeType: string, ext: string): Promise<string> {
  const objectId = crypto.randomUUID();
  const objectName = `uploads/${objectId}.${ext}`;
  const privateDir = objectStorage.getPrivateObjectDir();
  const fullPath = `${privateDir}/${objectName}`;
  const parts = fullPath.startsWith("/") ? fullPath.slice(1).split("/") : fullPath.split("/");
  const bucketName = parts[0];
  const objectKey = parts.slice(1).join("/");
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectKey);
  await file.save(buffer, { contentType: mimeType, resumable: false });
  return `/objects/${objectName}`;
}
async function extractTextFromFile(base64Data: string, mimeType: string): Promise<string | null> {
  try {
    const buffer = Buffer.from(base64Data, "base64");
    if (mimeType === "application/pdf") {
      const pdfParse = (await import("pdf-parse")).default;
      const result = await pdfParse(buffer);
      return result.text?.trim() || null;
    }
    if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword"
    ) {
      const mammoth = (await import("mammoth")).default;
      const result = await mammoth.extractRawText({ buffer });
      return result.value?.trim() || null;
    }
    if (mimeType === "text/plain" || mimeType === "text/csv" || mimeType === "text/html" || mimeType === "text/markdown" || mimeType.startsWith("text/")) {
      return buffer.toString("utf-8").trim() || null;
    }
    return null;
  } catch (e) {
    console.error("Error extracting text from file:", e);
    return null;
  }
}

const KIE_API_KEY = process.env.KIE_API_KEY;
const NANO_BANANA_CREATE_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const NANO_BANANA_STATUS_URL = "https://api.kie.ai/api/v1/jobs/recordInfo";

const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
const WAVESPEED_3D_URL = "https://api.wavespeed.ai/api/v3/wavespeed-ai/hunyuan3d-v3/image-to-3d";
const MODEL_3D_COST = 100;

const PLAN_PUBLISH_LIMITS: Record<string, number> = {
  bronze: 1,
  silver: 2,
  gold: 3,
  platinum: 5,
  free: 0,
};

const DAILY_PUBLISH_COST = 20;

const SYSTEM_PROMPT = `Ты — frontend-разработчик. Генерируй полные HTML-документы.

ТЕХНИЧЕСКИЕ ТРЕБОВАНИЯ:
- Полный HTML: <!DOCTYPE html>, <head> с <style>, <body>, <script> перед </body>
- Чистый HTML/CSS/JS — БЕЗ внешних CDN и библиотек
- Адаптивность (mobile, tablet, desktop)
- Мета-теги: description, viewport, charset, Open Graph
- Все тексты на русском языке, если не указано иное
- НЕ используй lorem ipsum — пиши реальный контент по теме
- Код должен быть полным и production-ready, НЕ обрезай секции

МНОГОСТРАНИЧНЫЕ САЙТЫ:
Если пользователь просит несколько страниц — создай ОТДЕЛЬНЫЕ HTML-файлы:
- Главная: index.html, доп. страницы: about.html, contacts.html и т.д.
- Каждая страница — полный HTML-документ с полным CSS

⚠️ КРИТИЧНО — ЕДИНЫЙ HEADER И FOOTER:
- Сначала создай index.html с полным <header>/<nav> и <footer>
- Затем ТОЧНО СКОПИРУЙ header и footer из index.html во ВСЕ остальные страницы — ПОБАЙТНО ИДЕНТИЧНЫЙ HTML-код
- Навбар должен содержать ОДИНАКОВЫЕ пункты меню, ОДИНАКОВЫЕ стили, ОДИНАКОВУЮ структуру на КАЖДОЙ странице
- Футер должен быть АБСОЛЮТНО ОДИНАКОВЫЙ на всех страницах
- Единственное отличие — класс активной ссылки (подсветка текущей страницы)
- Если на index.html есть кнопка "Бронь" в навбаре — она ОБЯЗАНА быть на ВСЕХ страницах
- НЕ упрощай и НЕ сокращай навбар/футер на вторичных страницах

- Формат ответа:
--- FILE: index.html ---
\`\`\`html
<!DOCTYPE html><html>...</html>
\`\`\`
--- FILE: about.html ---
\`\`\`html
<!DOCTYPE html><html>...</html>
\`\`\`

При РЕДАКТИРОВАНИИ:
- Одна страница → только она с маркером --- FILE:
- Навбар/футер → все страницы с обновлениями

ИЗОБРАЖЕНИЯ:
- Вместо картинок — красивые div-placeholder с градиентом, SVG-иконкой и подписью
- class="image-placeholder" data-image-hint="описание"
- НЕ используй внешние URL и placeholder-сервисы
- Если есть библиотека: используй маркер {{IMG:имя}} в src

ФОРМЫ:
Все формы отправляют данные на API:
document.querySelectorAll('form[data-lead-form]').forEach(form => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = { name: fd.get('name')||'', email: fd.get('email')||'', phone: fd.get('phone')||'', message: fd.get('message')||'', source: form.dataset.leadForm||'form' };
    try {
      const r = await fetch('https://craft-ai.ru/api/leads/' + (window.__PROJECT_ID__ || '0'), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      if(r.ok) { form.reset(); }
    } catch(err) { console.error(err); }
  });
});
Оборачивай формы в <form data-lead-form="имя_формы">.`;

const RESEARCH_AND_ENHANCE_PROMPT = `Ты выполняешь ДВЕ задачи одновременно:

ЗАДАЧА 1 — ИССЛЕДОВАНИЕ: Собери реальную информацию по теме из результатов поиска:
- Основная информация, ключевые особенности (5-7), преимущества
- Технические детали, факты и цифры, цитаты/отзывы
- Ценообразование, целевая аудитория
Пиши ТОЛЬКО факты из источников. НЕ придумывай.

ЗАДАЧА 2 — УЛУЧШЕНИЕ ПРОМПТА: На основе найденных фактов, создай детальный промпт для AI-генератора premium-сайта:
- Skeuomorphic UI (реалистичные тени, глубина, стеклянные эффекты)
- Кастомные inline SVG анимации по теме (минимум 2 штуки)
- Плавные CSS transitions и scroll-анимации через IntersectionObserver
- Многослойные тени (2-3 уровня), glassmorphism, noise-текстуры
- Микро-интеракции: hover с подъёмом, scale, сменой теней
- Морфинг навбара: прозрачный → стеклянный при скролле
- Цветовую палитру (4 цвета), типографику, скругления
- Hero (100dvh) + минимум 5-7 секций + Footer
- Интерактивные элементы (счётчики, слайдеры, мини-дашборды)

ФОРМАТ ОТВЕТА (строго!):
===RESEARCH===
[Структурированная информация из исследования]
===PROMPT===
[Улучшенный промпт 300-500 слов, только дизайн и контент, без технических инструкций вроде "используй HTML/CSS"]

Отвечай на русском языке.`;

async function enhancePromptOnly(query: string): Promise<{ enhancedPrompt: string; success: boolean }> {
  try {
    console.log("Starting prompt enhancement for:", query);

    const result = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: `Тема сайта пользователя: "${query}"

Инструкция для тебя:
Ты — Universal Creative Director & Adaptive UI Engineer. Твоя задача — не просто пересказать шаблон, а ВДОХНОВИТЬСЯ им для создания уникальной концепции под конкретную тему пользователя.

ШАБЛОН ТВОЕГО МЫШЛЕНИЯ (Используй как ориентир, но адаптируй):
1. Identity: Ты визионер. Твоя цель — сайт на миллион долларов. Никакого "дефолта".
2. Phase 1: Reasoning. Проанализируй "Душу бренда" пользователя. Если это кафе — это уют или хай-тек? Если сервис — это надежность или скорость? Выбери уникальную Visual DNA (цветовую палитру и шрифтовую пару), которая подходит ИМЕННО ЭТОЙ теме.
3. Phase 2: Design Bible. Обязательно внедри:
   - Стеклянные эффекты (Glassmorphism), адаптированные под стиль.
   - SVG-анимации, которые имеют смысл для этой темы (например, летящие искры для кузницы или плавающие пузыри для напитков).
   - Сложные многослойные тени и Bento-сетку.
4. Phase 3: Polish. Массивная типографика, много "воздуха", премиальный темный режим по умолчанию.

ТВОЯ ЗАДАЧА:
Напиши детальный, вдохновляющий промпт (300-500 слов на русском) для AI-генератора кода. 
Этот промпт должен описывать структуру, дизайн и контент сайта так, чтобы Gemini-кодер выдал шедевр.
- НЕ копируй текст инструкции в ответ.
- НЕ используй фразы "Phase 1", "Phase 2". 
- Пиши живым языком дизайнера: опиши атмосферу, конкретные цвета HEX, типы анимаций и структуру секций.
- Сфокусируйся на УНИКАЛЬНОСТИ под тему "${query}".` }] }],
      config: { maxOutputTokens: 4096 },
    });

    const enhancedPrompt = result.text?.trim() || query;
    console.log("Enhanced prompt length:", enhancedPrompt.length);
    return { enhancedPrompt: enhancedPrompt.length > 100 ? enhancedPrompt : query, success: true };
  } catch (err: any) {
    console.error("Enhancement error:", err.message);
    return { enhancedPrompt: query, success: false };
  }
}

async function deepResearch(query: string): Promise<{ research: string; success: boolean }> {
  try {
    console.log("Starting Deep Research for:", query);

    const interaction = await gemini.interactions.create({
      input: `Исследуй тему "${query}" для создания premium-веб-сайта. Собери:\n- Основная информация, ключевые особенности (5-7), преимущества\n- Технические детали, факты и цифры, цитаты/отзывы\n- Ценообразование, целевая аудитория\n- Конкуренты и рыночные тренды\nПиши ТОЛЬКО факты из источников на русском языке. НЕ придумывай.`,
      agent: "deep-research-pro-preview-12-2025",
      background: true,
    } as any);

    console.log("Deep Research started, interaction ID:", (interaction as any).id);

    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const result = await gemini.interactions.get((interaction as any).id) as any;
      console.log(`Deep Research poll ${i + 1}/${maxAttempts}, status: ${result.status}`);

      if (result.status === "completed") {
        const text = result.outputs?.[result.outputs.length - 1]?.text || "";
        console.log("Deep Research completed, length:", text.length);
        return { research: text, success: true };
      }
      if (result.status === "failed") {
        console.error("Deep Research failed:", result.error);
        return { research: "", success: false };
      }
    }

    console.error("Deep Research timed out after", maxAttempts * 5, "seconds");
    return { research: "", success: false };
  } catch (err: any) {
    console.error("Deep Research error:", err.message);
    return { research: "", success: false };
  }
}

async function bypassAuth(req: any, res: any, next: any) {
  if (!req.user) {
    const dbUser = await storage.getUser(1);
    req.user = dbUser || { id: 1, credits: 9999, displayName: "Гость" };
  }
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);

  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const express = (await import("express")).default;
  app.use("/uploads", express.static(uploadsDir));

  registerObjectStorageRoutes(app);

  const ALLOWED_UPLOAD_MIMES: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp",
    "image/gif": "gif", "image/svg+xml": "svg",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogg",
    "model/gltf-binary": "glb", "model/gltf+json": "gltf",
    "application/octet-stream": "glb",
  };
  const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
  const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
  const MAX_3D_SIZE = 50 * 1024 * 1024;

  app.post("/api/upload-image", bypassAuth, async (req, res) => {
    try {
      const { base64, mimeType, name } = req.body;
      if (!base64) return res.status(400).json({ message: "Нет данных файла" });
      const mime = (mimeType || "image/png").toLowerCase();
      const ext = ALLOWED_UPLOAD_MIMES[mime];
      if (!ext) return res.status(400).json({ message: "Неподдерживаемый формат файла" });
      const buffer = Buffer.from(base64, "base64");
      const isVideo = mime.startsWith("video/");
      const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
      if (buffer.length > maxSize) {
        return res.status(400).json({ message: `Файл слишком большой. Максимум: ${Math.round(maxSize / 1024 / 1024)} МБ` });
      }
      const url = await uploadToObjectStorage(buffer, mime, ext);
      res.json({ url, filename: name || `${crypto.randomUUID()}.${ext}` });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ message: "Ошибка загрузки файла" });
    }
  });

  const multer = (await import("multer")).default;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Math.max(MAX_VIDEO_SIZE, MAX_3D_SIZE) } });

  app.post("/api/upload-file", bypassAuth, upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ message: "Файл не прикреплён" });
      let mime = file.mimetype.toLowerCase();
      const originalName = (file.originalname || "").toLowerCase();

      // Detect 3D model by extension when browser sends application/octet-stream
      let ext = ALLOWED_UPLOAD_MIMES[mime];
      if (!ext || (mime === "application/octet-stream" && !originalName.endsWith(".glb"))) {
        if (originalName.endsWith(".glb")) { ext = "glb"; mime = "model/gltf-binary"; }
        else if (originalName.endsWith(".gltf")) { ext = "gltf"; mime = "model/gltf+json"; }
        else if (!ext) return res.status(400).json({ message: "Неподдерживаемый формат файла" });
      }

      const is3D = ext === "glb" || ext === "gltf";
      const isVideo = mime.startsWith("video/");
      const maxSize = is3D ? MAX_3D_SIZE : isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
      if (file.size > maxSize) {
        return res.status(400).json({ message: `Файл слишком большой. Максимум: ${Math.round(maxSize / 1024 / 1024)} МБ` });
      }
      const url = await uploadToObjectStorage(file.buffer, mime, ext);
      res.json({ url, filename: file.originalname || `${crypto.randomUUID()}.${ext}`, fileType: is3D ? "3d" : isVideo ? "video" : "image" });
    } catch (err) {
      console.error("Upload file error:", err);
      res.status(500).json({ message: "Ошибка загрузки файла" });
    }
  });

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

  app.post("/api/enhance-prompt", bypassAuth, async (req, res) => {
    try {
      const { prompt, idempotencyKey } = req.body;
      const user = req.user as any;
      if (!prompt || prompt.trim().length < 3) {
        return res.status(400).json({ message: "Введите описание для улучшения" });
      }
      const ENHANCE_COST = 5;
      const ikey = idempotencyKey || `enhance-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const deduction = await storage.deductCredits(user.id, ENHANCE_COST, "enhance", ikey);
      if (!deduction.success) {
        return res.status(402).json({ message: `Недостаточно токенов. Нужно ${ENHANCE_COST}, у вас ${deduction.newBalance}.`, newBalance: deduction.newBalance });
      }
      const result = await enhancePromptOnly(prompt);
      if (result.success) {
        res.json({ enhancedPrompt: result.enhancedPrompt, creditsUsed: ENHANCE_COST, newBalance: deduction.newBalance });
      } else {
        res.json({ enhancedPrompt: prompt, creditsUsed: 0, newBalance: deduction.newBalance, warning: "AI временно недоступен, использован оригинальный промпт" });
      }
    } catch (err: any) {
      console.error("Enhance prompt error:", err.message);
      res.status(500).json({ message: "Ошибка улучшения промпта" });
    }
  });

  app.post("/api/deep-research", bypassAuth, async (req, res) => {
    try {
      const { prompt, idempotencyKey } = req.body;
      const user = req.user as any;
      if (!prompt || prompt.trim().length < 3) {
        return res.status(400).json({ message: "Введите описание для исследования" });
      }
      const RESEARCH_COST = 10;
      const ikey = idempotencyKey || `research-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const deduction = await storage.deductCredits(user.id, RESEARCH_COST, "deep-research", ikey);
      if (!deduction.success) {
        return res.status(402).json({ message: `Недостаточно токенов. Нужно ${RESEARCH_COST}, у вас ${deduction.newBalance}.`, newBalance: deduction.newBalance });
      }
      const result = await deepResearch(prompt);
      if (result.success) {
        res.json({ research: result.research, creditsUsed: RESEARCH_COST, newBalance: deduction.newBalance });
      } else {
        res.json({ research: "", creditsUsed: 0, newBalance: deduction.newBalance, warning: "Deep Research временно недоступен" });
      }
    } catch (err: any) {
      console.error("Deep research error:", err.message);
      res.status(500).json({ message: "Ошибка Deep Research" });
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

      const GENERATION_COST = 100;

      const { prompt, images, imageBase64, imageMimeType, activeFile, skipEnhance, deepResearchData, idempotencyKey, multiPagesData, seoH1, seoH2s, mockupMode, videoUrls, modelUrls } = req.body;
      const imageArray: Array<{base64: string, mimeType: string, fileName?: string}> = 
        Array.isArray(images) && images.length > 0 ? images 
        : imageBase64 ? [{ base64: imageBase64, mimeType: imageMimeType || "image/png" }] 
        : [];
      if (!prompt) {
        return res.status(400).json({ message: "Запрос обязателен" });
      }

      await storage.createProjectMessage({
        projectId: project.id,
        role: "user",
        content: prompt,
      });

      const genIkey = idempotencyKey || `gen-${project.id}-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const genDeduction = await storage.deductCredits(user.id, GENERATION_COST, "generate", genIkey);
      if (!genDeduction.success) {
        return res.status(402).json({ message: `Не хватает токенов. Нужно ${GENERATION_COST}, у вас ${genDeduction.newBalance}.`, newBalance: genDeduction.newBalance });
      }

      const projectImgs = await storage.getProjectImages(project.id);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let researchData = deepResearchData || "";
      const isNewSite = !project.generatedCode;

      let enhancedPrompt = prompt;

      if (isNewSite) {
        res.write(`data: ${JSON.stringify({ status: "Генерируем сайт..." })}\n\n`);
      }

      let systemContent = SYSTEM_PROMPT;
      if (researchData) {
        systemContent += `\n\n═══ РЕЗУЛЬТАТЫ DEEP RESEARCH ═══\nИспользуй следующие РЕАЛЬНЫЕ факты и данные из исследования при создании контента сайта:\n${researchData}\n═══ КОНЕЦ ИССЛЕДОВАНИЯ ═══\n`;
      }
      if (multiPagesData && typeof multiPagesData === "string" && multiPagesData.trim()) {
        const pageList = multiPagesData.split(",").map((p: string) => p.trim()).filter(Boolean);
        const fileNames = pageList.map((p: string) => {
          const slug = p.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
          return `${slug}.html (${p})`;
        });
        systemContent += `\n\n═══ СТРУКТУРА САЙТА ═══\nСоздай МНОГОСТРАНИЧНЫЙ сайт. ОБЯЗАТЕЛЬНО сгенерируй ВСЕ перечисленные страницы:\n- index.html (главная)\n- ${fileNames.join("\n- ")}\nКаждая страница — полный отдельный HTML-документ. В навигации всех страниц должны быть ссылки на ВСЕ страницы. Используй формат --- FILE: имя.html --- для каждого файла.\n\n⚠️ HEADER/FOOTER: Сначала создай полный <header> и <footer> для index.html, затем СКОПИРУЙ ИХ ДОСЛОВНО во все остальные файлы. Все кнопки, ссылки и стили навбара и футера должны быть ИДЕНТИЧНЫ на каждой странице. Отличается только класс/стиль активной ссылки.\n═══ КОНЕЦ СТРУКТУРЫ ═══\n`;
      }
      if (seoH1 && typeof seoH1 === "string" && seoH1.trim()) {
        const h2List = seoH2s && typeof seoH2s === "string"
          ? seoH2s.split(",").map((h: string) => h.trim()).filter(Boolean)
          : [];
        systemContent += `\n\n═══ SEO ЗАГОЛОВКИ ═══\nИСПОЛЬЗУЙ ТОЧНО эти заголовки на главной странице:\n- H1: "${seoH1.trim()}"${h2List.length > 0 ? `\n- H2: ${h2List.map((h: string) => `"${h}"`).join(", ")}` : ""}\nЭти заголовки должны присутствовать в HTML текстом (не изображением), в тегах <h1> и <h2> соответственно.\n═══ КОНЕЦ SEO ═══\n`;
      }
      if (projectImgs.length > 0) {
        systemContent += `\n\nДОСТУПНЫЕ ИЗОБРАЖЕНИЯ В БИБЛИОТЕКЕ ПОЛЬЗОВАТЕЛЯ:\n`;
        for (const img of projectImgs) {
          if (img.url.startsWith("/uploads/") || img.url.startsWith("/objects/")) {
            systemContent += `- "${img.name}" — ПРЯМОЙ URL: ${img.url} (описание: ${img.prompt})\n`;
          } else {
            systemContent += `- "${img.name}" — маркер: {{IMG:${img.name}}} (описание: ${img.prompt})\n`;
          }
        }
        systemContent += `\nДля загруженных фото (с URL /uploads/... или /objects/...) — используй URL напрямую: <img src="URL" />\nДля AI-сгенерированных изображений — используй маркер {{IMG:имя}}: <img src="{{IMG:имя}}" />`;
      }

      const videoArray: Array<{url: string, fileName: string}> = Array.isArray(videoUrls) ? videoUrls : [];
      if (videoArray.length > 0) {
        systemContent += `\n\n═══ ЗАГРУЖЕННЫЕ ВИДЕО ПОЛЬЗОВАТЕЛЯ ═══\nПользователь прикрепил видеофайлы. ОБЯЗАТЕЛЬНО встрой их на сайт с помощью тега <video>:\n`;
        for (const vid of videoArray) {
          systemContent += `- "${vid.fileName}" — URL: ${vid.url}\n`;
        }
        systemContent += `\nИспользуй тег <video> с атрибутами controls, playsinline, и при необходимости autoplay muted loop:\n<video src="${videoArray[0].url}" controls playsinline style="width:100%; max-width:800px; border-radius:12px;"></video>\n\nМожно использовать видео как:\n- Фоновое видео секции (autoplay muted loop, без controls)\n- Видеоплеер в контенте (с controls)\n- Hero-видео с наложением текста\nВыбери подходящий вариант исходя из контекста запроса пользователя.\n═══ КОНЕЦ ВИДЕО ═══\n`;
      }

      const modelArray: Array<{url: string, fileName: string}> = Array.isArray(modelUrls) ? modelUrls : [];
      if (modelArray.length > 0) {
        systemContent += `\n\n═══ ЗАГРУЖЕННЫЕ 3D МОДЕЛИ ПОЛЬЗОВАТЕЛЯ ═══\nПользователь прикрепил 3D модели (.glb/.gltf). ОБЯЗАТЕЛЬНО встрой их на сайт используя Google Model Viewer:\n`;
        for (const mdl of modelArray) {
          systemContent += `- "${mdl.fileName}" — URL: ${mdl.url}\n`;
        }
        systemContent += `\nДобавь в <head> скрипт: <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"></script>\nЗатем встрой модель через тег <model-viewer>:\n<model-viewer src="${modelArray[0].url}" alt="${modelArray[0].fileName}" auto-rotate camera-controls shadow-intensity="1" style="width:100%;height:500px;background:#f0f0f0;border-radius:16px;"></model-viewer>\n\nИспользуй 3D модель как:\n- Интерактивный 3D-просмотрщик продукта\n- Hero-элемент с вращающейся моделью\n- Демонстрационный блок с управлением камерой\nВыбери подходящий вариант исходя из контекста.\n═══ КОНЕЦ 3D МОДЕЛЕЙ ═══\n`;
      }

      const isEditMode = !!project.generatedCode;
      const existingFiles = await storage.getProjectFiles(project.id);

      const stripBase64 = (code: string): { stripped: string; map: Map<string, string> } => {
        const map = new Map<string, string>();
        let counter = 0;
        const stripped = code.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/g, (match) => {
          const placeholder = `__B64_${counter++}__`;
          map.set(placeholder, match);
          return placeholder;
        });
        return { stripped, map };
      };

      const restoreBase64 = (code: string, map: Map<string, string>): string => {
        let result = code;
        for (const [placeholder, original] of map) {
          result = result.split(placeholder).join(original);
        }
        return result;
      };

      let base64Map = new Map<string, string>();

      if (isEditMode) {
        const editingFile = activeFile || "index.html";
        const editingFileCodeRaw = editingFile === "index.html" 
          ? project.generatedCode 
          : existingFiles.find(f => f.filename === editingFile)?.code || project.generatedCode;

        const { stripped: editingFileCode, map } = stripBase64(editingFileCodeRaw || "");
        base64Map = map;
        console.log(`Stripped ${map.size} base64 images from code. Original: ${(editingFileCodeRaw||"").length} chars, Stripped: ${editingFileCode.length} chars`);

        systemContent += `\n\n${"═".repeat(43)}\nРЕЖИМ РЕДАКТИРОВАНИЯ — АКТИВНЫЙ ФАЙЛ: ${editingFile}\n${"═".repeat(43)}\nПользователь РЕДАКТИРУЕТ файл "${editingFile}". Все изменения должны применяться К ЭТОМУ ФАЙЛУ.\n\n⚠️ КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА РЕДАКТИРОВАНИЯ:\n1. ОБЯЗАТЕЛЬНО сохрани <nav> (навбар) со ВСЕМИ ссылками навигации\n2. ОБЯЗАТЕЛЬНО сохрани <footer>\n3. Изменять ТОЛЬКО то, что явно просит пользователь\n4. НЕ удалять, НЕ упрощать существующий код\n5. Плейсхолдеры __B64_N__ — это изображения. НЕ трогай и НЕ меняй их.\n\n🔧 ФОРМАТ ОТВЕТА — ИСПОЛЬЗУЙ DIFF-ПАТЧИ (НЕ полный код!):\n- Сначала 1-3 предложения о внесённых изменениях\n- Затем используй блоки SEARCH/REPLACE для каждого изменения:\n\n\`\`\`diff\n<<<<<<< SEARCH\nточный фрагмент существующего кода который нужно найти\n=======\nновый код на замену\n>>>>>>> REPLACE\n\`\`\`\n\nПравила SEARCH/REPLACE:\n- SEARCH блок должен ТОЧНО совпадать с фрагментом существующего кода (включая пробелы и отступы)\n- Включай достаточно контекста (5-15 строк) чтобы фрагмент был уникальным\n- Используй несколько блоков SEARCH/REPLACE для нескольких изменений\n- Для УДАЛЕНИЯ блока — оставь REPLACE пустым\n- Для ДОБАВЛЕНИЯ нового кода — в SEARCH укажи соседний существующий блок, в REPLACE — его же + новый код\n\n⚠️ ИСКЛЮЧЕНИЕ — используй ПОЛНЫЙ HTML (блок \`\`\`html) ТОЛЬКО если:\n- Пользователь просит переделать/переписать ВЕСЬ дизайн\n- Изменения затрагивают >50% файла\n- Пользователь просит изменить ВСЕ страницы (тогда используй маркеры --- FILE: имя.html ---)\n\n`;

        systemContent += `ТЕКУЩИЙ КОД РЕДАКТИРУЕМОГО ФАЙЛА (${editingFile}):\n\`\`\`html\n${editingFileCode}\n\`\`\`\n`;

        if (existingFiles.length > 0) {
          const otherFiles = editingFile === "index.html" 
            ? existingFiles 
            : [{ filename: "index.html", code: project.generatedCode }, ...existingFiles.filter(f => f.filename !== editingFile)];
          if (otherFiles.length > 0) {
            systemContent += `\nДРУГИЕ ФАЙЛЫ ПРОЕКТА (для справки, НЕ редактируй их без запроса):\n`;
            for (const f of otherFiles) {
              const code = 'code' in f ? f.code : '';
              systemContent += `- ${f.filename} (${(code || '').length} символов)\n`;
            }
          }
        }
      }

      const inputContent: any[] = [];
      const savedImageUrls: string[] = [];

      if (imageArray.length > 0) {
        for (const imgData of imageArray) {
          const mime = imgData.mimeType || "image/png";
          const isImage = mime.startsWith("image/");
          if (isImage) {
            const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "jpg";
            const buffer = Buffer.from(imgData.base64, "base64");
            const imageUrl = await uploadToObjectStorage(buffer, mime, ext);
            savedImageUrls.push(imageUrl);

            const imgName = imgData.fileName?.replace(/\.[^.]+$/, '').replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_') || `photo_${Date.now()}`;
            await storage.createProjectImage({
              projectId: project.id,
              userId: project.userId,
              name: imgName,
              url: imageUrl,
              prompt: prompt.substring(0, 200),
            });
            projectImgs.push({ id: 0, projectId: project.id, name: imgName, url: imageUrl, prompt: prompt.substring(0, 200), createdAt: new Date() } as any);
          }
        }

        let textPart = isEditMode ? prompt : enhancedPrompt;
        
        if (mockupMode && savedImageUrls.length > 0) {
          // ═══ ДВУХЭТАПНЫЙ ПРОЦЕСС: МАКЕТ → КОД ═══
          res.write(`data: ${JSON.stringify({ status: "Этап 1/2 — Анализ макета..." })}\n\n`);

          const analysisParts: any[] = [
            { text: `Ты — эксперт по UI/UX анализу. Проанализируй прикреплённый скриншот/макет дизайна сайта и создай ДЕТАЛЬНОЕ структурированное описание.

ФОРМАТ ОТВЕТА — строго JSON:
{
  "page_type": "landing / portfolio / ecommerce / blog / corporate / другое",
  "layout": {
    "structure": "описание общей структуры страницы (header, hero, секции, footer)",
    "grid": "тип сетки (одна колонка, 2-3 колонки, bento grid и т.д.)",
    "max_width": "примерная максимальная ширина контента в px"
  },
  "color_palette": {
    "background": "#hex основного фона",
    "text_primary": "#hex основного текста",
    "text_secondary": "#hex вторичного текста",
    "accent": "#hex акцентного цвета (кнопки, ссылки)",
    "accent_secondary": "#hex второго акцента если есть",
    "card_bg": "#hex фона карточек/блоков",
    "additional": ["#hex", "#hex"]
  },
  "typography": {
    "heading_font": "предполагаемый шрифт заголовков (serif/sans-serif/mono + конкретное предположение)",
    "body_font": "предполагаемый шрифт текста",
    "h1_size": "размер в px",
    "h2_size": "размер в px",
    "body_size": "размер в px",
    "heading_weight": "700/800/900",
    "letter_spacing": "нормальный / сжатый (-0.02em) / разрежённый"
  },
  "sections": [
    {
      "type": "header / hero / features / gallery / testimonials / pricing / cta / footer / другое",
      "description": "подробное описание секции",
      "elements": ["навбар с логотипом слева и меню справа", "заголовок H1 крупный по центру", "подзаголовок", "2 кнопки CTA"],
      "background": "тип фона (сплошной цвет, градиент, изображение, паттерн)",
      "layout_details": "flex row, grid 3 колонки, центрирование и т.д.",
      "spacing": "padding примерный в px"
    }
  ],
  "effects": {
    "shadows": "тип теней (нет, лёгкие, глубокие, цветные)",
    "border_radius": "скругления в px (0, 8, 16, 24, полные)",
    "glassmorphism": true/false,
    "gradients": "описание градиентов если есть",
    "animations": "описание анимаций если видны (hover эффекты и т.д.)"
  },
  "images": [
    {
      "location": "в какой секции",
      "type": "фото / иллюстрация / иконка / фон",
      "aspect_ratio": "16:9 / 1:1 / 4:3",
      "description": "что изображено"
    }
  ],
  "texts": {
    "headings": ["точный текст заголовка 1", "точный текст заголовка 2"],
    "paragraphs": ["точный текст параграфа 1"],
    "buttons": ["текст кнопки 1", "текст кнопки 2"],
    "nav_items": ["пункт меню 1", "пункт меню 2"]
  }
}

ВАЖНО:
- Определяй цвета МАКСИМАЛЬНО ТОЧНО по пикселям
- Извлекай ВСЕ тексты со скриншота (заголовки, абзацы, кнопки, меню)
- Описывай КАЖДУЮ секцию отдельно
- Указывай точные размеры и отступы где можно определить
- Если видно шрифт — попробуй определить его (Inter, Montserrat, Roboto, etc.)
- Верни ТОЛЬКО JSON, без пояснений` },
          ];

          for (const imgData of imageArray) {
            const mime = imgData.mimeType || "image/png";
            if (mime.startsWith("image/")) {
              analysisParts.push({ inlineData: { data: imgData.base64, mimeType: mime } });
            }
          }

          let designAnalysis = "";
          let analysisValid = false;
          try {
            const analysisResult = await gemini.models.generateContent({
              model: "gemini-3.1-pro-preview",
              contents: [{ role: "user", parts: analysisParts }],
              config: { maxOutputTokens: 8192, responseMimeType: "application/json" },
            });
            const rawAnalysis = (analysisResult.text || "").trim();
            // Validate JSON
            try {
              JSON.parse(rawAnalysis);
              designAnalysis = rawAnalysis;
              analysisValid = true;
            } catch {
              // Try extracting JSON from markdown code block
              const jsonMatch = rawAnalysis.match(/```(?:json)?\s*([\s\S]*?)```/);
              if (jsonMatch) {
                JSON.parse(jsonMatch[1].trim());
                designAnalysis = jsonMatch[1].trim();
                analysisValid = true;
              } else {
                designAnalysis = rawAnalysis;
                analysisValid = false;
              }
            }
            // Truncate if too large (keep under 6000 chars to leave room for generation prompt)
            if (designAnalysis.length > 6000) {
              designAnalysis = designAnalysis.substring(0, 6000) + "\n...[обрезано]";
            }
            console.log("Mockup analysis completed, length:", designAnalysis.length, "valid JSON:", analysisValid);
          } catch (analysisError) {
            console.error("Mockup analysis failed:", analysisError);
            analysisValid = false;
          }

          res.write(`data: ${JSON.stringify({ status: "Этап 2/2 — Генерация кода..." })}\n\n`);

          if (analysisValid && designAnalysis) {
            textPart += `\n\n═══ РЕЖИМ "МАКЕТ → КОД" (Design-to-Code) — ДВУХЭТАПНЫЙ ═══

ЗАДАЧА: Воссоздай дизайн с прикреплённого скриншота как точный HTML/CSS/JS код.

СТРУКТУРИРОВАННЫЙ АНАЛИЗ МАКЕТА (JSON):
${designAnalysis}

КРИТИЧЕСКИЕ ПРАВИЛА ГЕНЕРАЦИИ:
1. НЕ вставляй скриншот как <img> — это МАКЕТ для воссоздания, а не контент
2. Используй ТОЧНЫЕ цвета из анализа (HEX-значения из color_palette)
3. Используй ТОЧНЫЕ тексты из анализа (все заголовки, параграфы, кнопки — как на макете)
4. Воссоздай ТОЧНУЮ структуру секций в правильном порядке
5. Соблюдай типографику: размеры, жирность, межбуквенное расстояние
6. Соблюдай отступы и пропорции как на макете
7. Для фотографий/иллюстраций — градиентные div-placeholder с data-image-hint
8. Все интерактивные элементы (кнопки, ссылки, формы) должны быть функциональными
9. CSS: flexbox, grid, custom properties, hover-анимации, transitions
10. АДАПТИВНОСТЬ: desktop, tablet, mobile
11. Применяй все визуальные эффекты из анализа (тени, скругления, градиенты, glassmorphism)

Результат — полностью рабочий HTML/CSS/JS, ПИКСЕЛЬ В ПИКСЕЛЬ повторяющий макет.
═══ КОНЕЦ РЕЖИМА МАКЕТ → КОД ═══`;
          } else {
            // Fallback: single-step vision mode (analysis failed or invalid)
            textPart += `\n\n═══ РЕЖИМ "МАКЕТ → КОД" (Design-to-Code) ═══
ПОЛЬЗОВАТЕЛЬ ЗАГРУЗИЛ СКРИНШОТ/МАКЕТ ДИЗАЙНА САЙТА. Проанализируй визуальный дизайн на изображении и воссоздай его как точный HTML/CSS/JS код.

ПРАВИЛА:
1. НЕ вставляй загруженное изображение как <img> — это МАКЕТ, а не контент
2. АНАЛИЗИРУЙ каждый элемент: layout, цвета (#HEX), шрифты, отступы, тени, скругления
3. Извлеки ВСЕ тексты (заголовки, параграфы, кнопки, меню) и используй их ТОЧНО
4. ВОССОЗДАЙ структуру: навигацию, секции, карточки, кнопки, формы, футер
5. Для фотографий — градиентные div-placeholder с data-image-hint
6. Интерактивные элементы должны быть функциональными
7. Современный CSS: flexbox, grid, custom properties, hover-эффекты
8. Адаптивность: desktop, tablet, mobile

Результат — полностью рабочий HTML/CSS/JS сайт, визуально ИДЕНТИЧНЫЙ загруженному макету.
═══ КОНЕЦ РЕЖИМА МАКЕТ → КОД ═══`;
          }
        } else if (savedImageUrls.length > 0) {
          textPart += `\n\nПОЛЬЗОВАТЕЛЬ ПРИКРЕПИЛ ${savedImageUrls.length} ФОТО. URL фото:\n`;
          savedImageUrls.forEach((url, i) => {
            textPart += `${i + 1}. ${url}\n`;
          });
          textPart += `\nОБЯЗАТЕЛЬНО используй эти URL напрямую в src изображений: <img src="${savedImageUrls[0]}" />. НЕ используй маркер {{IMG:...}} для этих фото — используй URL напрямую. Размести фото по сайту согласно запросу пользователя.`;
        }
        inputContent.push({ type: "text", text: textPart });

        for (const imgData of imageArray) {
          const mime = imgData.mimeType || "image/png";
          if (mime.startsWith("image/")) {
            inputContent.push({ type: "image", data: imgData.base64, mime_type: mime });
          } else {
            const extractedText = await extractTextFromFile(imgData.base64, mime);
            if (extractedText) {
              const truncated = extractedText.length > 15000 ? extractedText.substring(0, 15000) + "\n...[текст обрезан]" : extractedText;
              inputContent.push({ type: "text", text: `\n\nСОДЕРЖИМОЕ ПРИКРЕПЛЁННОГО ДОКУМЕНТА (${mime}):\n---\n${truncated}\n---\n\nИспользуй этот текст из документа при создании/редактировании сайта.` });
            } else {
              inputContent.push({ type: "text", text: `[Прикреплён файл формата ${mime}, но его содержимое не удалось извлечь.]` });
            }
          }
        }
      } else if (isEditMode) {
        inputContent.push({ type: "text", text: prompt });
      } else {
        inputContent.push({ type: "text", text: enhancedPrompt });
      }

      let fullResponse = "";

      const messages = await storage.getProjectMessages(project.id);
      const conversationHistory: Array<{ role: string; parts: Array<{ text: string }> }> = [];

      for (const msg of messages.slice(-10)) {
        if (msg.role === "user") {
          conversationHistory.push({ role: "user", parts: [{ text: msg.content }] });
        } else if (msg.role === "assistant") {
          const truncated = msg.content.length > 2000 ? msg.content.substring(0, 2000) + "...[обрезано]" : msg.content;
          conversationHistory.push({ role: "model", parts: [{ text: truncated }] });
        }
      }

      const userParts: any[] = [];
      for (const item of inputContent) {
        if ((item as any).type === "text") {
          userParts.push({ text: (item as any).text });
        } else if ((item as any).type === "image") {
          userParts.push({ inlineData: { data: (item as any).data, mimeType: (item as any).mime_type } });
        }
      }

      conversationHistory.push({ role: "user", parts: userParts });

      const modelName = "gemini-3.1-pro-preview";
      console.log("generateContentStream call. Model:", modelName, "History messages:", conversationHistory.length, "Edit mode:", isEditMode);

      const MAX_RETRIES = 3;
      let lastError: any = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const streamResult = await gemini.models.generateContentStream({
            model: modelName,
            contents: conversationHistory,
            config: {
              systemInstruction: systemContent,
              maxOutputTokens: isEditMode ? 32768 : 65536,
            },
          });

          for await (const chunk of streamResult) {
            const text = chunk.text || "";
            if (text) {
              fullResponse += text;
              res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
            }
          }
          lastError = null;
          break;
        } catch (retryErr: any) {
          lastError = retryErr;
          const status = retryErr?.status || retryErr?.code || retryErr?.error?.code;
          if ((status === 503 || status === 429) && attempt < MAX_RETRIES - 1) {
            const delay = (attempt + 1) * 3000;
            console.log(`[Gemini] ${status} error, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
            res.write(`data: ${JSON.stringify({ content: `\n\n⏳ Сервер перегружен, повторяю запрос (${attempt + 2}/${MAX_RETRIES})...\n\n` })}\n\n`);
            await new Promise(r => setTimeout(r, delay));
            fullResponse = "";
            continue;
          }
          throw retryErr;
        }
      }
      if (lastError) throw lastError;

      console.log("Total response length:", fullResponse.length);
      console.log("Response preview:", fullResponse.substring(0, 200));

      const replaceImgMarkers = (code: string) => {
        const imgMarkerRegex = /\{\{IMG:([^}]+)\}\}/g;
        let m;
        let result = code;
        while ((m = imgMarkerRegex.exec(code)) !== null) {
          const imgName = m[1].trim().toLowerCase();
          const found = projectImgs.find(img => img.name.toLowerCase() === imgName);
          if (found) result = result.replace(m[0], found.url);
        }
        return result;
      };

      const hasDiffBlocks = fullResponse.includes("<<<<<<< SEARCH");
      const hasFileMarkers = fullResponse.includes("--- FILE:");
      const htmlBlockCount = (fullResponse.match(/```html/g) || []).length;
      const diffBlockCount = (fullResponse.match(/```diff/g) || []).length;
      console.log("Full response length:", fullResponse.length, "Has FILE markers:", hasFileMarkers, "HTML blocks:", htmlBlockCount, "Diff blocks:", diffBlockCount, "Has SEARCH/REPLACE:", hasDiffBlocks);

      const applyDiffPatches = (originalCode: string, response: string): string => {
        const diffRegex = /```diff\s*\n([\s\S]*?)```/g;
        let patchedCode = originalCode;
        let patchCount = 0;
        let dm;
        while ((dm = diffRegex.exec(response)) !== null) {
          const diffContent = dm[1];
          const searchReplaceRegex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
          let sr;
          while ((sr = searchReplaceRegex.exec(diffContent)) !== null) {
            const searchBlock = sr[1];
            const replaceBlock = sr[2];
            if (patchedCode.includes(searchBlock)) {
              patchedCode = patchedCode.replace(searchBlock, replaceBlock);
              patchCount++;
            } else {
              const trimmedSearch = searchBlock.replace(/^\s+/gm, (m) => m.replace(/ /g, ' ')).trim();
              const trimmedCode = patchedCode.replace(/^\s+/gm, (m) => m.replace(/ /g, ' '));
              if (trimmedCode.includes(trimmedSearch)) {
                const idx = trimmedCode.indexOf(trimmedSearch);
                const before = patchedCode.substring(0, idx);
                const after = patchedCode.substring(idx + trimmedSearch.length);
                patchedCode = before + replaceBlock + after;
                patchCount++;
              } else {
                console.warn("SEARCH block not found in code, skipping patch. First 80 chars:", searchBlock.substring(0, 80));
              }
            }
          }
        }
        console.log(`Applied ${patchCount} diff patches`);
        return patchedCode;
      };

      let aiTextReply = "";
      const firstHtmlIdx = fullResponse.indexOf("```html");
      const firstDiffIdx = fullResponse.indexOf("```diff");
      const firstFileMarkerIdx = fullResponse.indexOf("--- FILE:");
      const firstCodeIdx = firstHtmlIdx !== -1 && firstDiffIdx !== -1 
        ? Math.min(firstHtmlIdx, firstDiffIdx) 
        : firstHtmlIdx !== -1 ? firstHtmlIdx : firstDiffIdx;
      if (firstCodeIdx > 0) {
        const textEnd = firstFileMarkerIdx !== -1 && firstFileMarkerIdx < firstCodeIdx ? firstFileMarkerIdx : firstCodeIdx;
        aiTextReply = fullResponse.substring(0, textEnd).trim();
      } else if (firstFileMarkerIdx > 0) {
        aiTextReply = fullResponse.substring(0, firstFileMarkerIdx).trim();
      }

      const editingFile = activeFile || "index.html";
      let mainHtmlCode: string;

      if (hasDiffBlocks && diffBlockCount > 0) {
        const editingFileCodeRaw = editingFile === "index.html"
          ? project.generatedCode || ""
          : existingFiles.find(f => f.filename === editingFile)?.code || project.generatedCode || "";

        const { stripped: editingFileCode } = stripBase64(editingFileCodeRaw);
        const patchedStripped = applyDiffPatches(editingFileCode, fullResponse);
        const patchedCode = replaceImgMarkers(restoreBase64(patchedStripped, base64Map));

        if (editingFile !== "index.html") {
          await storage.upsertProjectFile({ projectId: project.id, filename: editingFile, code: patchedCode });
          mainHtmlCode = project.generatedCode || "";
        } else {
          mainHtmlCode = patchedCode;
        }
      } else {
        const fileMarkerRegex = /---\s*FILE:\s*([^\s\-]+\.html)\s*---\s*\n?\s*```html\s*\n?([\s\S]*?)```/gi;
        const parsedFiles: { filename: string; code: string }[] = [];
        let fm;
        while ((fm = fileMarkerRegex.exec(fullResponse)) !== null) {
          parsedFiles.push({ filename: fm[1].trim().toLowerCase(), code: replaceImgMarkers(fm[2].trim()) });
        }

        if (parsedFiles.length === 0) {
          const altMarkerRegex = /\*{0,2}\s*FILE:\s*([^\s*]+\.html)\s*\*{0,2}\s*\n?\s*```html\s*\n?([\s\S]*?)```/gi;
          let altM;
          while ((altM = altMarkerRegex.exec(fullResponse)) !== null) {
            parsedFiles.push({ filename: altM[1].trim().toLowerCase(), code: replaceImgMarkers(altM[2].trim()) });
          }
        }

        console.log("Parsed files count:", parsedFiles.length, parsedFiles.map(f => f.filename));

        if (parsedFiles.length > 0) {
          const indexFile = parsedFiles.find(f => f.filename === "index.html");
          if (indexFile) {
            mainHtmlCode = indexFile.code;
          } else if (parsedFiles.find(f => f.filename === editingFile)) {
            mainHtmlCode = project.generatedCode || parsedFiles[0].code;
          } else {
            mainHtmlCode = parsedFiles[0].code;
          }
          const indexCode = indexFile?.code || mainHtmlCode;
          const headerMatch = indexCode.match(/<header[\s\S]*?<\/header>/i);
          const footerMatch = indexCode.match(/<footer[\s\S]*?<\/footer>/i);

          for (const pf of parsedFiles) {
            if (pf.filename !== "index.html") {
              let code = pf.code;
              if (headerMatch) {
                code = code.replace(/<header[\s\S]*?<\/header>/i, headerMatch[0]);
              }
              if (footerMatch) {
                code = code.replace(/<footer[\s\S]*?<\/footer>/i, footerMatch[0]);
              }
              pf.code = code;
              await storage.upsertProjectFile({ projectId: project.id, filename: pf.filename, code });
            }
          }
        } else {
          const singleMatch = fullResponse.match(/```html\n?([\s\S]*?)```/);
          let parsedCode: string | null = null;
          if (singleMatch) {
            parsedCode = replaceImgMarkers(singleMatch[1].trim());
          } else if (fullResponse.includes("<!DOCTYPE") || fullResponse.includes("<html")) {
            parsedCode = replaceImgMarkers(fullResponse.trim());
          }

          if (parsedCode && isEditMode && editingFile !== "index.html") {
            await storage.upsertProjectFile({ projectId: project.id, filename: editingFile, code: parsedCode });
            mainHtmlCode = project.generatedCode || "";
          } else if (parsedCode) {
            mainHtmlCode = parsedCode;
          } else {
            mainHtmlCode = project.generatedCode || "";
          }
        }
      }

      if (project.generatedCode && project.generatedCode.trim()) {
        const currentFiles = await storage.getProjectFiles(project.id);
        const filesSnapshot = currentFiles.map(f => ({ filename: f.filename, code: f.code }));
        await storage.createProjectVersion({
          projectId: project.id,
          code: project.generatedCode,
          label: `До: "${prompt.substring(0, 50)}${prompt.length > 50 ? "..." : ""}"`,
          files: filesSnapshot.length > 0 ? filesSnapshot : null,
        });
      }

      await storage.updateProject(project.id, { generatedCode: mainHtmlCode });
      await storage.createProjectMessage({
        projectId: project.id,
        role: "model",
        content: aiTextReply || "Сайт обновлён",
      });

      const allFiles = await storage.getProjectFiles(project.id);
      const editedFileCode = editingFile !== "index.html" ? allFiles.find(f => f.filename === editingFile)?.code : mainHtmlCode;
      res.write(`data: ${JSON.stringify({ done: true, code: mainHtmlCode, editedFile: editingFile, editedCode: editedFileCode || mainHtmlCode, reply: aiTextReply, files: allFiles.map(f => ({ filename: f.filename, id: f.id })), creditsUsed: GENERATION_COST, newBalance: genDeduction.newBalance })}\n\n`);
      res.end();
    } catch (err: any) {
      console.error("Generation error:", err?.message || err);
      const errMsg = (err?.message?.includes("503") || err?.message?.includes("UNAVAILABLE") || err?.message?.includes("high demand"))
        ? "Сервер ИИ временно перегружен. Попробуйте через 30 секунд — мы уже сделали 3 попытки."
        : (err?.message?.includes("RATE_LIMIT") || err?.message?.includes("429") || err?.message?.includes("RESOURCE_EXHAUSTED") || err?.message?.includes("quota"))
        ? "Превышен лимит запросов к Gemini API. Подождите 1-2 минуты и попробуйте снова."
        : err?.message?.includes("RECITATION") 
        ? "Ответ ИИ заблокирован из-за слишком похожего контента. Попробуйте переформулировать запрос."
        : err?.message?.includes("SAFETY") 
        ? "Ответ ИИ заблокирован фильтром безопасности. Попробуйте другой запрос."
        : err?.message?.includes("too long") || err?.message?.includes("token")
        ? "Ответ ИИ слишком длинный. Попробуйте более конкретный запрос для одной страницы."
        : `Ошибка генерации: ${err?.message?.substring(0, 150) || "неизвестная ошибка"}`;
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ message: errMsg });
      }
    }
  });

  app.post("/api/images/generate", bypassAuth, async (req, res) => {
    try {
      const IMAGE_COST = 15;
      const user = req.user as any;

      const { prompt, aspectRatio = "16:9", outputFormat = "jpg", idempotencyKey, referenceImageUrls } = req.body;
      if (!prompt) {
        return res.status(400).json({ message: "Промпт обязателен" });
      }

      const imgIkey = idempotencyKey || `img-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const deduction = await storage.deductCredits(user.id, IMAGE_COST, "image", imgIkey);
      if (!deduction.success) {
        return res.status(402).json({ message: `Недостаточно токенов. Нужно ${IMAGE_COST}, у вас ${deduction.newBalance}`, newBalance: deduction.newBalance });
      }

      const inputPayload: any = {
        prompt,
        output_format: outputFormat,
        aspect_ratio: aspectRatio,
        resolution: "2K",
      };
      if (referenceImageUrls && Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0) {
        const fullUrls = referenceImageUrls.slice(0, 14).map((u: string) =>
          u.startsWith("http") ? u : `https://${req.headers.host}${u}`
        );
        inputPayload.image_url = fullUrls;
      }

      const createResp = await fetch(NANO_BANANA_CREATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${KIE_API_KEY}`,
        },
        body: JSON.stringify({
          model: "nano-banana-2",
          input: inputPayload,
        }),
      });

      const createBody = await createResp.json();
      console.log("Nano Banana create response:", JSON.stringify(createBody));

      if (createBody.code !== 200 || !createBody.data?.taskId) {
        return res.status(500).json({ message: createBody.msg || "Ошибка создания задачи" });
      }

      res.json({ taskId: createBody.data.taskId, newBalance: deduction.newBalance });
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
        const externalUrls = result.resultUrls || [];
        const localUrls: string[] = [];
        const projectIdParam = parseInt(req.query.projectId as string) || 0;
        const promptParam = (req.query.prompt as string) || "";
        for (const extUrl of externalUrls) {
          try {
            const imgResp = await fetch(extUrl);
            if (imgResp.ok) {
              const buf = Buffer.from(await imgResp.arrayBuffer());
              const localUrl = await uploadToObjectStorage(buf, "image/jpeg", "jpg");
              localUrls.push(localUrl);
              if (projectIdParam > 0) {
                const autoName = promptParam.trim().split(/\s+/).slice(0, 3).join("_") || `img_${Date.now()}`;
                const imgProject = await storage.getProject(projectIdParam);
                await storage.createProjectImage({ projectId: projectIdParam, userId: imgProject?.userId, name: autoName, url: localUrl, prompt: promptParam.substring(0, 200) });
              }
            } else {
              localUrls.push(extUrl);
            }
          } catch {
            localUrls.push(extUrl);
          }
        }
        return res.json({ state: "success", urls: localUrls });
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

  app.post("/api/images/proxy-base64", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Не авторизован" });
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string") return res.status(400).json({ message: "URL обязателен" });
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const arrayBuf = await r.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const mimeType = r.headers.get("content-type") || "image/jpeg";
      const base64 = buffer.toString("base64");
      res.json({ base64, mimeType });
    } catch (err: any) {
      console.error("Proxy base64 error:", err);
      res.status(500).json({ message: "Ошибка загрузки изображения" });
    }
  });

  // WaveSpeed 3D model generation
  app.post("/api/3d/generate", bypassAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const { imageUrl, enablePbr = false, generateType = "Normal", faceCount = 500000, idempotencyKey } = req.body;
      if (!imageUrl) {
        return res.status(400).json({ message: "URL изображения обязателен" });
      }
      if (!WAVESPEED_API_KEY) {
        return res.status(500).json({ message: "WAVESPEED_API_KEY не настроен" });
      }

      const ikey = idempotencyKey || `3d-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const deduction = await storage.deductCredits(user.id, MODEL_3D_COST, "3d", ikey);
      if (!deduction.success) {
        return res.status(402).json({ message: `Недостаточно токенов. Нужно ${MODEL_3D_COST}, у вас ${deduction.newBalance}`, newBalance: deduction.newBalance });
      }

      let fullImageUrl = imageUrl;
      if (imageUrl.startsWith("/")) {
        fullImageUrl = `https://${req.headers.host}${imageUrl}`;
      }

      const payload: any = {
        image: fullImageUrl,
        enable_pbr: enablePbr,
        generate_type: generateType,
        face_count: faceCount,
      };

      const createResp = await fetch(WAVESPEED_3D_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${WAVESPEED_API_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      const createBody = await createResp.json() as any;
      console.log("[WaveSpeed 3D] create response:", JSON.stringify(createBody).substring(0, 500));

      const taskData = createBody.data || createBody;
      const taskId = taskData.id;
      if (!createResp.ok || !taskId) {
        await storage.refundCredits(user.id, MODEL_3D_COST);
        return res.status(500).json({ message: createBody?.error?.message || createBody?.detail || createBody?.message || "Ошибка создания 3D задачи" });
      }

      res.json({
        taskId,
        statusUrl: taskData.urls?.get || `${WAVESPEED_3D_URL}/${taskId}`,
        newBalance: deduction.newBalance,
      });
    } catch (err: any) {
      console.error("[WaveSpeed 3D] generate error:", err);
      res.status(500).json({ message: "Ошибка генерации 3D модели" });
    }
  });

  app.get("/api/3d/status/:taskId", bypassAuth, async (req, res) => {
    try {
      if (!WAVESPEED_API_KEY) {
        return res.status(500).json({ message: "WAVESPEED_API_KEY не настроен" });
      }
      const { taskId } = req.params;
      let statusUrl = req.query.statusUrl as string || "";
      if (!statusUrl || !statusUrl.startsWith("https://api.wavespeed.ai/")) {
        statusUrl = `${WAVESPEED_3D_URL}/${taskId}`;
      }

      const resp = await fetch(statusUrl, {
        headers: { "Authorization": `Bearer ${WAVESPEED_API_KEY}` },
      });
      const rawBody = await resp.json() as any;
      const body = rawBody.data || rawBody;
      console.log("[WaveSpeed 3D] status:", JSON.stringify(rawBody).substring(0, 500));

      if (body.status === "completed") {
        return res.json({ state: "success", outputs: body.outputs || body.output || [] });
      }
      if (body.status === "failed") {
        return res.json({ state: "fail", error: body.error || "Ошибка генерации 3D" });
      }
      return res.json({ state: "waiting", status: body.status });
    } catch (err: any) {
      console.error("[WaveSpeed 3D] status error:", err);
      res.status(500).json({ message: "Ошибка проверки статуса 3D" });
    }
  });

  app.post("/api/3d/download", bypassAuth, async (req, res) => {
    try {
      const { url, projectId } = req.body;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ message: "URL обязателен" });
      }
      const allowed = url.startsWith("https://d1q70pf5vjeyhc.cloudfront.net/") || url.startsWith("https://api.wavespeed.ai/");
      if (!allowed) {
        return res.status(400).json({ message: "Недопустимый URL" });
      }
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Failed to download GLB");
      const arrayBuf = await resp.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const localUrl = await uploadToObjectStorage(buffer, "model/gltf-binary", "glb");
      if (projectId) {
        const pid = parseInt(projectId);
        if (pid > 0) {
          const dlProject = await storage.getProject(pid);
          await storage.createProjectImage({ projectId: pid, userId: dlProject?.userId, name: `3d_model_${Date.now()}`, url: localUrl, prompt: "3D модель" });
        }
      }
      res.json({ url: localUrl });
    } catch (err: any) {
      console.error("[3D download] error:", err);
      res.status(500).json({ message: "Ошибка загрузки 3D модели" });
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
      const image = await storage.createProjectImage({ projectId: project.id, userId: user.id, name, url, prompt: prompt || "" });
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
      const currentFiles = await storage.getProjectFiles(project.id);
      const filesSnapshot = currentFiles.map(f => ({ filename: f.filename, code: f.code }));
      const version = await storage.createProjectVersion({
        projectId: project.id,
        code: project.generatedCode,
        label: label || "Ручной чекпоинт",
        files: filesSnapshot.length > 0 ? filesSnapshot : null,
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
        const currentFiles = await storage.getProjectFiles(project.id);
        const filesSnapshot = currentFiles.map(f => ({ filename: f.filename, code: f.code }));
        await storage.createProjectVersion({
          projectId: project.id,
          code: project.generatedCode,
          label: "До отката",
          files: filesSnapshot.length > 0 ? filesSnapshot : null,
        });
      }

      const updated = await storage.updateProject(project.id, { generatedCode: version.code });

      if (version.files && Array.isArray(version.files)) {
        await storage.deleteProjectFilesByProject(project.id);
        for (const f of version.files) {
          await storage.upsertProjectFile({ projectId: project.id, filename: f.filename, code: f.code });
        }
      }

      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Ошибка восстановления версии" });
    }
  });

  // ═══ PROJECT FILES API ═══

  app.get("/api/projects/:id/files", bypassAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });
      const files = await storage.getProjectFiles(project.id);
      res.json(files);
    } catch (err) {
      res.status(500).json({ message: "Ошибка загрузки файлов" });
    }
  });

  app.put("/api/projects/:id/files/:filename", bypassAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });
      const { code } = req.body;
      const file = await storage.upsertProjectFile({
        projectId: project.id,
        filename: req.params.filename,
        code: code || "",
      });
      res.json(file);
    } catch (err) {
      res.status(500).json({ message: "Ошибка сохранения файла" });
    }
  });

  app.post("/api/projects/:id/sync-nav", bypassAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });

      const files = await storage.getProjectFiles(project.id);
      const allPages = [
        { filename: "index.html", code: project.generatedCode || "" },
        ...files.filter(f => f.filename !== "index.html"),
      ];

      const indexCode = project.generatedCode || "";
      const navMatch = indexCode.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
      if (!navMatch) return res.json({ success: true, message: "Nav not found" });

      const existingNav = navMatch[0];

      const existingLinks: { href: string; text: string; full: string }[] = [];
      const linkRegex = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = linkRegex.exec(existingNav)) !== null) {
        existingLinks.push({ href: m[1], text: m[2], full: m[0] });
      }

      const pageTitles: Record<string, string> = req.body?.pageTitles || {};

      const missingPages = allPages.filter(
        p => !existingLinks.some(l => l.href === p.filename)
      );

      if (missingPages.length === 0) return res.json({ success: true, message: "Already synced" });

      let newNavLinks = "";
      for (const mp of missingPages) {
        const label = mp.filename.replace(".html", "");
        const displayName = pageTitles[mp.filename] || label.charAt(0).toUpperCase() + label.slice(1);
        if (existingLinks.length > 0) {
          const sample = existingLinks[existingLinks.length - 1].full;
          const newLink = sample.replace(/href="[^"]*"/, `href="${mp.filename}"`).replace(/>[\s\S]*?<\/a>/, `>${displayName}</a>`);
          newNavLinks += "\n                " + newLink;
        } else {
          newNavLinks += `\n                <a href="${mp.filename}">${displayName}</a>`;
        }
      }

      const lastLinkIdx = existingNav.lastIndexOf("</a>");
      if (lastLinkIdx === -1) return res.json({ success: true, message: "No links found in nav" });

      const insertPos = lastLinkIdx + 4;
      const updatedNav = existingNav.substring(0, insertPos) + newNavLinks + existingNav.substring(insertPos);

      for (const page of allPages) {
        const pageNavMatch = page.code.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
        if (!pageNavMatch) continue;
        const updatedCode = page.code.replace(pageNavMatch[0], updatedNav);
        if (updatedCode === page.code) continue;

        if (page.filename === "index.html") {
          await storage.updateProject(project.id, { generatedCode: updatedCode });
        } else {
          await storage.upsertProjectFile({
            projectId: project.id,
            filename: page.filename,
            code: updatedCode,
          });
        }
      }

      res.json({ success: true, updated: allPages.length });
    } catch (err) {
      console.error("Sync nav error:", err);
      res.status(500).json({ message: "Ошибка синхронизации навигации" });
    }
  });

  app.delete("/api/projects/:id/files/:fileId", bypassAuth, async (req, res) => {
    try {
      const project = await storage.getProject(parseInt(req.params.id));
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      const user = req.user as any;
      if (project.userId !== user.id) return res.status(403).json({ message: "Доступ запрещён" });
      await storage.deleteProjectFile(parseInt(req.params.fileId));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Ошибка удаления файла" });
    }
  });

  // ═══ PUBLISH API (Vercel) ═══

  app.post("/api/projects/:id/publish", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Не авторизован" });
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      if (project.userId !== (req.user as any).id) return res.status(403).json({ message: "Нет доступа" });
      if (!project.generatedCode) return res.status(400).json({ message: "Сначала сгенерируйте сайт" });

      const user = await storage.getUser((req.user as any).id);
      if (!user) return res.status(401).json({ message: "Пользователь не найден" });

      const maxPublished = PLAN_PUBLISH_LIMITS[user.plan] ?? 1;
      const currentPublished = await storage.getPublishedProjectsCount(user.id);
      const isRepublish = project.publishStatus === "published";
      if (!isRepublish && currentPublished >= maxPublished) {
        return res.status(403).json({
          message: `Ваш тариф «${user.plan === "bronze" ? "Старт" : user.plan === "silver" ? "Базовый" : user.plan === "gold" ? "Профи" : "Ультра"}» позволяет опубликовать до ${maxPublished} сайт(ов). Обновите тариф для публикации большего количества сайтов.`
        });
      }

      if (user.credits < DAILY_PUBLISH_COST) {
        return res.status(403).json({ message: "Недостаточно токенов для публикации. Ежедневная стоимость хостинга — 20 токенов/сайт." });
      }

      await storage.updateProject(projectId, { publishStatus: "publishing" });

      const extraFiles = await storage.getProjectFiles(projectId);
      const projectImages = await storage.getProjectImages(projectId);

      const files: { filename: string; content: string }[] = [];

      const LEADS_API_BASE = "https://craft-ai.ru";
      const leadsScript = `<script>window.__PROJECT_ID__=${projectId};
(function(){
  var API='${LEADS_API_BASE}/api/leads/${projectId}';
  document.querySelectorAll('form[data-lead-form]').forEach(function(form){
    form.addEventListener('submit',function(e){
      e.preventDefault();
      var fd=new FormData(form);
      var data={name:fd.get('name')||'',email:fd.get('email')||'',phone:fd.get('phone')||'',message:fd.get('message')||'',source:form.dataset.leadForm||'form'};
      var btn=form.querySelector('button[type="submit"],input[type="submit"],button:not([type])');
      var origText=btn?btn.textContent:'';
      if(btn){btn.textContent='Отправляем...';btn.disabled=true}
      fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
        .then(function(r){if(!r.ok)throw new Error(r.status);return r.json()})
        .then(function(){form.reset();if(btn){btn.textContent='Отправлено ✓';btn.style.background='#22c55e';setTimeout(function(){btn.textContent=origText;btn.disabled=false;btn.style.background=''},3000)}})
        .catch(function(){if(btn){btn.textContent='Ошибка, попробуйте ещё';btn.disabled=false;setTimeout(function(){btn.textContent=origText},3000)}});
    });
  });
})();<\/script>`;

      function injectLeadsScript(html: string): string {
        let result = html;
        result = result.replace(/<script[^>]*data-nz-leads[^>]*>[\s\S]*?<\/script>/gi, "");
        result = result.replace(/<script[^>]*data-nz-editor[^>]*>[\s\S]*?<\/script>/gi, "");
        result = result.replace(/<style[^>]*data-nz-editor[^>]*>[\s\S]*?<\/style>/gi, "");
        result = result.replace(/<script[^>]*data-nz-selector[^>]*>[\s\S]*?<\/script>/gi, "");
        result = result.replace(/<style[^>]*data-nz-selector[^>]*>[\s\S]*?<\/style>/gi, "");
        result = result.replace(/<!--NZ_EDITOR_START-->|<!--NZ_EDITOR_END-->/g, "");
        result = result.replace(/<script[^>]*>\s*document\.querySelectorAll\(['"]form\[data-lead-form\]['"]\)[\s\S]*?<\/script>/gi, "");
        if (result.includes("</body>")) {
          result = result.replace("</body>", leadsScript + "</body>");
        } else {
          result += leadsScript;
        }
        return result;
      }

      let mainHtml = project.generatedCode;
      for (const img of projectImages) {
        mainHtml = mainHtml.replace(new RegExp(`\\{\\{IMG:${img.name}\\}\\}`, "g"), img.url);
      }
      mainHtml = injectLeadsScript(mainHtml);
      files.push({ filename: "index.html", content: mainHtml });

      for (const f of extraFiles) {
        if (f.filename === "index.html") continue;
        let code = f.code;
        for (const img of projectImages) {
          code = code.replace(new RegExp(`\\{\\{IMG:${img.name}\\}\\}`, "g"), img.url);
        }
        code = injectLeadsScript(code);
        files.push({ filename: f.filename, content: code });
      }

      // Collect and embed 3D model files (.glb/.gltf) found in HTML
      const allHtmlForScan = files.map(f => f.content || "").join("\n");
      const modelSrcRegex = /src\s*=\s*["']([^"']*\.(?:glb|gltf))["']/gi;
      const foundModelUrls = new Set<string>();
      let mMatch: RegExpExecArray | null;
      while ((mMatch = modelSrcRegex.exec(allHtmlForScan)) !== null) {
        foundModelUrls.add(mMatch[1]);
      }
      if (foundModelUrls.size > 0) {
        const modelUrlMap = new Map<string, string>();
        for (const modelUrl of Array.from(foundModelUrls)) {
          try {
            let fetchUrl = modelUrl;
            if (modelUrl.startsWith("/")) {
              fetchUrl = `http://localhost:${process.env.PORT || 5000}${modelUrl}`;
            }
            const modelResp = await fetch(fetchUrl);
            if (modelResp.ok) {
              const buffer = Buffer.from(await modelResp.arrayBuffer());
              const fileName = modelUrl.split("/").pop() || `model_${Date.now()}.glb`;
              const localPath = `models/${fileName}`;
              files.push({ filename: localPath, contentBuffer: buffer });
              modelUrlMap.set(modelUrl, localPath);
            }
          } catch (err) {
            console.warn(`[Publish] Could not fetch 3D model ${modelUrl}:`, err);
          }
        }
        // Update HTML references to use local paths
        for (const f of files) {
          if (!f.content) continue;
          for (const [remoteUrl, localPath] of Array.from(modelUrlMap.entries())) {
            f.content = f.content.split(remoteUrl).join(localPath);
          }
        }
      }

      const { url, vercelProjectId } = await deployToVercel(projectId, files);

      await storage.updateProject(projectId, {
        publishStatus: "published",
        publishedUrl: url,
        vercelProjectId,
      });

      res.json({ url });
    } catch (err: any) {
      await storage.updateProject(parseInt(req.params.id), { publishStatus: "error" });
      res.status(500).json({ message: err.message || "Ошибка публикации" });
    }
  });

  app.post("/api/projects/:id/favicon", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Не авторизован" });
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      if (project.userId !== (req.user as any).id) return res.status(403).json({ message: "Нет доступа" });
      const { dataUrl, mimeType } = req.body;
      if (!dataUrl) return res.status(400).json({ message: "dataUrl обязателен" });

      const faviconTag = `<link rel="icon" type="${mimeType || "image/png"}" href="${dataUrl}">`;
      const injectFavicon = (html: string): string => {
        const existing = /<link[^>]+rel=["']icon["'][^>]*>/i;
        if (existing.test(html)) return html.replace(existing, faviconTag);
        return html.replace(/<\/head>/i, `  ${faviconTag}\n</head>`);
      };

      const updatedCode = injectFavicon(project.generatedCode);
      await storage.updateProject(projectId, { generatedCode: updatedCode });

      const files = await storage.getProjectFiles(projectId);
      for (const f of files) {
        if (f.filename.endsWith(".html")) {
          await storage.upsertProjectFile({ projectId, filename: f.filename, code: injectFavicon(f.code) });
        }
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Ошибка загрузки фавикона" });
    }
  });

  app.post("/api/projects/:id/domain", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Не авторизован" });
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      if (project.userId !== (req.user as any).id) return res.status(403).json({ message: "Нет доступа" });
      const { domain } = req.body;
      if (!domain) return res.status(400).json({ message: "Домен обязателен" });
      if (!project.vercelProjectId) return res.status(400).json({ message: "Сначала опубликуйте сайт" });

      try {
        const result = await addCustomDomain(project.vercelProjectId, domain);
        await storage.updateProject(projectId, { customDomain: domain });
        res.json(result);
      } catch (domainErr: any) {
        if (domainErr.message?.includes("already in use")) {
          await storage.updateProject(projectId, { customDomain: domain });
          res.json({ verified: false, cname: "cname.vercel-dns.com", alreadyAdded: true });
        } else {
          throw domainErr;
        }
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Ошибка добавления домена" });
    }
  });

  app.get("/api/projects/:id/domain/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Не авторизован" });
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      if (!project || !project.vercelProjectId) return res.json({ verified: false });
      const { domain } = req.query as { domain: string };
      if (!domain) return res.status(400).json({ message: "Домен обязателен" });
      const result = await checkDomainStatus(project.vercelProjectId, domain);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ═══ LEADS API ═══

  app.options("/api/leads/:projectId", (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(204);
  });

  app.post("/api/leads/:projectId", async (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    try {
      const projectId = parseInt(req.params.projectId);
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Проект не найден" });

      const { name, email, phone, message, source } = req.body;
      const lead = await storage.createLead({
        projectId,
        name: name || "",
        email: email || "",
        phone: phone || "",
        message: message || "",
        source: source || "form",
      });
      res.json({ success: true, id: lead.id });
    } catch (err) {
      res.status(500).json({ message: "Ошибка сохранения заявки" });
    }
  });

  app.get("/api/generations", bypassAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id || 1;
      const images = await storage.getImagesByUser(userId);
      res.json(images);
    } catch (err) {
      res.status(500).json({ message: "Ошибка получения генераций" });
    }
  });

  app.get("/api/leads", bypassAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id || 1;
      const allLeads = await storage.getLeadsByUser(userId);
      res.json(allLeads);
    } catch (err) {
      res.status(500).json({ message: "Ошибка получения заявок" });
    }
  });

  app.get("/api/leads/unread-count", bypassAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id || 1;
      const count = await storage.getUnreadLeadCount(userId);
      res.json({ count });
    } catch (err) {
      res.json({ count: 0 });
    }
  });

  app.patch("/api/leads/:id/read", bypassAuth, async (req, res) => {
    try {
      const lead = await storage.markLeadRead(parseInt(req.params.id));
      res.json(lead);
    } catch (err) {
      res.status(500).json({ message: "Ошибка" });
    }
  });

  app.delete("/api/leads/:id", bypassAuth, async (req, res) => {
    try {
      await storage.deleteLead(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Ошибка удаления" });
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

  app.post("/api/projects/:id/unpublish", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Не авторизован" });
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Проект не найден" });
      if (project.userId !== (req.user as any).id) return res.status(403).json({ message: "Нет доступа" });
      if (project.publishStatus !== "published") return res.status(400).json({ message: "Проект не опубликован" });

      await unpublishFromVercel(projectId);
      await storage.updateProject(projectId, { publishStatus: "suspended" });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Ошибка снятия с публикации" });
    }
  });

  const adminOnly = (req: any, res: any, next: any) => {
    if (!req.user || req.user.id !== 1) return res.status(403).json({ message: "Forbidden" });
    next();
  };

  app.get("/api/admin/stats", adminOnly, async (req, res) => {
    try {
      const stats = await storage.adminGetStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/users", adminOnly, async (req, res) => {
    try {
      const allUsers = await storage.adminGetAllUsers();
      res.json(allUsers);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/users/:userId", adminOnly, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(user);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/users/:userId/transactions", adminOnly, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const txns = await storage.adminGetUserTransactions(userId);
      res.json(txns);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/users/:userId/projects", adminOnly, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const userProjects = await storage.adminGetUserProjects(userId);
      res.json(userProjects);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/users/:userId/adjust-credits", adminOnly, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const { amount, type, note } = req.body;
      if (!amount || !type || !["credit", "debit"].includes(type)) {
        return res.status(400).json({ message: "amount, type (credit|debit) required" });
      }
      const user = await storage.adminAdjustCredits(userId, Number(amount), type, type === "credit" ? "admin_add" : "admin_deduct", note || "");
      res.json({ success: true, user });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  async function runDailyPublishBilling() {
    const today = new Date().toISOString().slice(0, 10);
    console.log(`[Billing] Starting daily publish billing for ${today}...`);
    try {
      const usersWithSites = await storage.getAllUsersWithPublishedSites();

      for (const { userId, publishedCount } of usersWithSites) {
        const user = await storage.getUser(userId);
        if (!user) continue;

        const userProjects = await storage.getProjectsByUser(userId);
        const publishedProjects = userProjects.filter(p => p.publishStatus === "published");

        for (const proj of publishedProjects) {
          const idempotencyKey = `daily-publish-${proj.id}-${today}`;
          const result = await storage.deductCredits(userId, DAILY_PUBLISH_COST, "daily_publish", idempotencyKey);

          if (result.alreadyProcessed) {
            continue;
          }

          if (result.success) {
            console.log(`[Billing] User ${userId}: charged ${DAILY_PUBLISH_COST} tokens for project ${proj.id} (${proj.title}). Balance: ${result.newBalance}`);
          } else {
            await unpublishFromVercel(proj.id);
            await storage.updateProject(proj.id, { publishStatus: "suspended" });
            console.log(`[Billing] User ${userId}: suspended project ${proj.id} (${proj.title}) — insufficient balance (${result.newBalance} tokens)`);
          }
        }
      }

      console.log("[Billing] Daily publish billing completed.");
    } catch (err) {
      console.error("[Billing] Error during daily billing:", err);
    }
  }

  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(3, 0, 0, 0);
  if (nextMidnight <= now) nextMidnight.setDate(nextMidnight.getDate() + 1);
  const msUntilFirstRun = nextMidnight.getTime() - now.getTime();
  setTimeout(() => {
    runDailyPublishBilling();
    setInterval(runDailyPublishBilling, 24 * 60 * 60 * 1000);
  }, msUntilFirstRun);
  console.log(`[Billing] Next daily billing scheduled in ${Math.round(msUntilFirstRun / 1000 / 60)} minutes (at 03:00)`);

  return httpServer;
}
