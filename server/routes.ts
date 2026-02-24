import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { gemini } from "./gemini";
import path from "path";
import fs from "fs";
import crypto from "crypto";
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
- Одинаковый навбар и футер на всех страницах
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
      const r = await fetch(window.location.origin.replace(/:\\d+$/, ':5000') + '/api/leads/' + (window.__PROJECT_ID__ || '0'), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
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
      contents: [{ role: "user", parts: [{ text: `Тема: "${query}"

Role: Universal Creative Director & Adaptive UI Engineer
Identity: You are not a coder; you are a visionary designer who happens to know HTML/CSS. Your mission is to create websites that look like they cost $1,000,000. You despise "boring" and "default" designs.

Phase 1: Reasoning (Design Thinking)
Before writing a single line of code, you must "think" (reason) about:
1.  The Brand Soul: What is the mood? (Luxury, Cyberpunk, Organic, Playful).
2.  Visual DNA: Select a unique color palette (no basic blues/whites). Use deep gradients, neon accents, or "Earth-tone luxury".
3.  Motion Strategy: Where will SVG animations and transitions be most impactful?

Phase 2: The Design Bible (Mandatory Features):
You MUST implement these elements in EVERY site:
- Glassmorphism (The "Gloss" Effect): Cards must have backdrop-filter: blur(20px), background: rgba(255,255,255,0.05), and a 1px border with a subtle gradient.
- SVG Motion Graphics: - Use animated SVG paths for icons (drawing effect).
    - Add "Floating Blobs" in the background using SVG filters and CSS animations.
    - Use SVG patterns for background textures (noise, grids, or geometric shapes).
- Depth & Shadows: Use multi-layered box-shadows. Never use shadow-md. Use custom shadows like 0 20px 50px rgba(0,0,0,0.15).
- Bento Grid 2.0: Layouts must be modular. Use display: grid with irregular spans to create a dynamic, modern feel.
- Micro-Interactions: Every button, card, and link must have a hover state with transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275).

Phase 3: Visual Polish:
- Typography: Use massive, bold titles (font-size: 5rem+). Mix a premium Serif with a high-tech Sans-serif.
- Whitespace: Be generous. Let the elements "breathe". 
- Dark/Light Mode: Default to a sophisticated Dark Mode unless the user specifies otherwise. Use "Deep Charcoal" (#0a0a0a) instead of pure black.

Phase 4: Output Requirements:
- Framework: Tailwind CSS (for speed and modern utility).
- Components: High-quality placeholders, Lucide icons, and custom SVG decorations.
- Quality: The result must look like a winner on Awwwards or SiteInspire.

Создай на основе этих принципов детальный промпт (300-500 слов, на русском) для AI-генератора этого сайта. 
Пиши ТОЛЬКО промпт, без маркеров и заголовков. Не добавляй технические инструкции типа "используй HTML/CSS".` }] }],
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

  app.post("/api/upload-image", bypassAuth, async (req, res) => {
    try {
      const { base64, mimeType, name } = req.body;
      if (!base64) return res.status(400).json({ message: "Нет данных изображения" });
      const mime = mimeType || "image/png";
      const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "jpg";
      const filename = `${crypto.randomUUID()}.${ext}`;
      const filePath = path.join(uploadsDir, filename);
      const buffer = Buffer.from(base64, "base64");
      fs.writeFileSync(filePath, buffer);
      const url = `/uploads/${filename}`;
      res.json({ url, filename: name || filename });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ message: "Ошибка загрузки изображения" });
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
      const { prompt } = req.body;
      const user = req.user as any;
      if (!prompt || prompt.trim().length < 3) {
        return res.status(400).json({ message: "Введите описание для улучшения" });
      }
      const ENHANCE_COST = 5;
      if (user.credits < ENHANCE_COST) {
        return res.status(402).json({ message: `Недостаточно токенов. Нужно ${ENHANCE_COST}, у вас ${user.credits}.` });
      }
      const result = await enhancePromptOnly(prompt);
      if (result.success) {
        await storage.updateUserCredits(user.id, user.credits - ENHANCE_COST);
        res.json({ enhancedPrompt: result.enhancedPrompt, creditsUsed: ENHANCE_COST });
      } else {
        res.json({ enhancedPrompt: prompt, creditsUsed: 0, warning: "AI временно недоступен, использован оригинальный промпт" });
      }
    } catch (err: any) {
      console.error("Enhance prompt error:", err.message);
      res.status(500).json({ message: "Ошибка улучшения промпта" });
    }
  });

  app.post("/api/deep-research", bypassAuth, async (req, res) => {
    try {
      const { prompt } = req.body;
      const user = req.user as any;
      if (!prompt || prompt.trim().length < 3) {
        return res.status(400).json({ message: "Введите описание для исследования" });
      }
      const RESEARCH_COST = 10;
      if (user.credits < RESEARCH_COST) {
        return res.status(402).json({ message: `Недостаточно токенов. Нужно ${RESEARCH_COST}, у вас ${user.credits}.` });
      }
      const result = await deepResearch(prompt);
      if (result.success) {
        await storage.updateUserCredits(user.id, user.credits - RESEARCH_COST);
        res.json({ research: result.research, creditsUsed: RESEARCH_COST });
      } else {
        res.json({ research: "", creditsUsed: 0, warning: "Deep Research временно недоступен" });
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
      if (user.credits < GENERATION_COST) {
        return res.status(402).json({ message: "Не хватает токенов для выполнения, пожалуйста пополните баланс." });
      }

      const { prompt, images, imageBase64, imageMimeType, activeFile, skipEnhance, deepResearchData } = req.body;
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
      if (projectImgs.length > 0) {
        systemContent += `\n\nДОСТУПНЫЕ ИЗОБРАЖЕНИЯ В БИБЛИОТЕКЕ ПОЛЬЗОВАТЕЛЯ:\n`;
        for (const img of projectImgs) {
          if (img.url.startsWith("/uploads/")) {
            systemContent += `- "${img.name}" — ПРЯМОЙ URL: ${img.url} (описание: ${img.prompt})\n`;
          } else {
            systemContent += `- "${img.name}" — маркер: {{IMG:${img.name}}} (описание: ${img.prompt})\n`;
          }
        }
        systemContent += `\nДля загруженных фото (с URL /uploads/...) — используй URL напрямую: <img src="/uploads/xxx.png" />\nДля AI-сгенерированных изображений — используй маркер {{IMG:имя}}: <img src="{{IMG:имя}}" />`;
      }

      const isEditMode = !!project.generatedCode;
      const existingFiles = await storage.getProjectFiles(project.id);

      if (isEditMode) {
        const editingFile = activeFile || "index.html";
        const editingFileCode = editingFile === "index.html" 
          ? project.generatedCode 
          : existingFiles.find(f => f.filename === editingFile)?.code || project.generatedCode;

        systemContent += `\n\n${"═".repeat(43)}\nРЕЖИМ РЕДАКТИРОВАНИЯ — АКТИВНЫЙ ФАЙЛ: ${editingFile}\n${"═".repeat(43)}\nПользователь РЕДАКТИРУЕТ файл "${editingFile}". Все изменения должны применяться К ЭТОМУ ФАЙЛУ.\n\n⚠️ КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА РЕДАКТИРОВАНИЯ:\n1. ОБЯЗАТЕЛЬНО сохрани <nav> (навбар) со ВСЕМИ ссылками навигации — НИКОГДА не удаляй навигационное меню!\n2. ОБЯЗАТЕЛЬНО сохрани <footer> — НИКОГДА не удаляй подвал сайта!\n3. Сохранить ВСЕ существующие секции, стили, контент, анимации и структуру\n4. Изменять/добавлять ТОЛЬКО то, что явно просит пользователь\n5. НЕ удалять, НЕ упрощать, НЕ сокращать существующий код\n6. Вернуть ПОЛНЫЙ документ целиком (от <!DOCTYPE html> до </html>)\n7. НЕ заменяй весь дизайн — редактируй точечно то, что просит пользователь\n\nФОРМАТ ОТВЕТА:\n- Сначала напиши 1-3 предложения о внесённых изменениях\n- Затем ОДИН блок \`\`\`html с ПОЛНЫМ обновлённым кодом файла "${editingFile}"\n- Если пользователь просит изменить ВСЕ страницы — используй маркеры --- FILE: имя.html --- перед каждым блоком\n\n`;

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
            const filename = `${crypto.randomUUID()}.${ext}`;
            const filePath = path.join(uploadsDir, filename);
            const buffer = Buffer.from(imgData.base64, "base64");
            fs.writeFileSync(filePath, buffer);
            const imageUrl = `/uploads/${filename}`;
            savedImageUrls.push(imageUrl);

            const imgName = imgData.fileName?.replace(/\.[^.]+$/, '').replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_') || `photo_${Date.now()}`;
            await storage.createProjectImage({
              projectId: project.id,
              name: imgName,
              url: imageUrl,
              prompt: prompt.substring(0, 200),
            });
            projectImgs.push({ id: 0, projectId: project.id, name: imgName, url: imageUrl, prompt: prompt.substring(0, 200), createdAt: new Date() } as any);
          }
        }

        let textPart = isEditMode ? prompt : enhancedPrompt;
        
        if (savedImageUrls.length > 0) {
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

      console.log("generateContentStream call. History messages:", conversationHistory.length, "Edit mode:", isEditMode);

      const streamResult = await gemini.models.generateContentStream({
        model: "gemini-3.1-pro-preview",
        contents: conversationHistory,
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

      const hasFileMarkers = fullResponse.includes("--- FILE:");
      const htmlBlockCount = (fullResponse.match(/```html/g) || []).length;
      console.log("Full response length:", fullResponse.length, "Has FILE markers:", hasFileMarkers, "HTML blocks:", htmlBlockCount);

      let aiTextReply = "";
      const firstHtmlIdx = fullResponse.indexOf("```html");
      const firstFileMarkerIdx = fullResponse.indexOf("--- FILE:");
      if (firstHtmlIdx > 0) {
        const textEnd = firstFileMarkerIdx !== -1 && firstFileMarkerIdx < firstHtmlIdx ? firstFileMarkerIdx : firstHtmlIdx;
        aiTextReply = fullResponse.substring(0, textEnd).trim();
      } else if (firstFileMarkerIdx > 0) {
        aiTextReply = fullResponse.substring(0, firstFileMarkerIdx).trim();
      }

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

      const editingFile = activeFile || "index.html";
      let mainHtmlCode: string;

      if (parsedFiles.length > 0) {
        const indexFile = parsedFiles.find(f => f.filename === "index.html");
        if (indexFile) {
          mainHtmlCode = indexFile.code;
        } else if (parsedFiles.find(f => f.filename === editingFile)) {
          mainHtmlCode = project.generatedCode || parsedFiles[0].code;
        } else {
          mainHtmlCode = parsedFiles[0].code;
        }
        for (const pf of parsedFiles) {
          if (pf.filename !== "index.html") {
            await storage.upsertProjectFile({ projectId: project.id, filename: pf.filename, code: pf.code });
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

      if (project.generatedCode && project.generatedCode.trim()) {
        await storage.createProjectVersion({
          projectId: project.id,
          code: project.generatedCode,
          label: `До: "${prompt.substring(0, 50)}${prompt.length > 50 ? "..." : ""}"`,
        });
      }

      await storage.updateProject(project.id, { generatedCode: mainHtmlCode });
      if (mainHtmlCode && mainHtmlCode !== project.generatedCode) {
        await storage.upsertProjectFile({ projectId: project.id, filename: "index.html", code: mainHtmlCode });
      }
      await storage.createProjectMessage({
        projectId: project.id,
        role: "model",
        content: aiTextReply || "Сайт обновлён",
      });

      await storage.updateUserCredits(user.id, user.credits - GENERATION_COST);

      const allFiles = await storage.getProjectFiles(project.id);
      const editedFileCode = editingFile !== "index.html" ? allFiles.find(f => f.filename === editingFile)?.code : mainHtmlCode;
      res.write(`data: ${JSON.stringify({ done: true, code: mainHtmlCode, editedFile: editingFile, editedCode: editedFileCode || mainHtmlCode, reply: aiTextReply, files: allFiles.map(f => ({ filename: f.filename, id: f.id })), creditsUsed: GENERATION_COST })}\n\n`);
      res.end();
    } catch (err: any) {
      console.error("Generation error:", err?.message || err);
      const errMsg = (err?.message?.includes("RATE_LIMIT") || err?.message?.includes("429") || err?.message?.includes("RESOURCE_EXHAUSTED") || err?.message?.includes("quota"))
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
      if (user.credits < IMAGE_COST) {
        return res.status(403).json({ message: `Недостаточно токенов. Нужно ${IMAGE_COST}, у вас ${user.credits}` });
      }

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

      await storage.updateUserCredits(user.id, user.credits - IMAGE_COST);
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

      const missingPages = allPages.filter(
        p => !existingLinks.some(l => l.href === p.filename)
      );

      if (missingPages.length === 0) return res.json({ success: true, message: "Already synced" });

      let newNavLinks = "";
      for (const mp of missingPages) {
        const label = mp.filename.replace(".html", "");
        const displayName = label.charAt(0).toUpperCase() + label.slice(1);
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

  return httpServer;
}
