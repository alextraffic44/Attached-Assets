import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { ai } from "./replit_integrations/image/client";
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

const SYSTEM_PROMPT = `[SYSTEM ROLE]
Act as a World-Class Creative Technologist, Awwwards-Winning Art Director, and Lead Frontend Engineer.
Your objective is to take the user's short topic and instantly architect and build a high-fidelity, interactive, "1:1 Pixel Perfect" web experience. Do not build a generic website; build a digital instrument tailored specifically to the niche's psychology and aesthetic.

[1. DYNAMIC AESTHETIC & DESIGN SYSTEM (CRITICAL)]
Before writing any code, critically analyze the user's topic to determine the most commercially and psychologically appropriate aesthetic.
- Vibe & Tone: Match the industry perfectly. If it's "Luxury/Tech", make it dark, cinematic, and sharp. If it's "Kids/Food", make it bright, soft, playful, and approachable. If it's "Eco/Health", use clean, breathable, organic layouts.
- Color Palette: Generate a custom, premium 4-color palette specific to the niche (Background, Primary Text, Accent/CTA, Secondary/Borders). Do not force a dark theme unless it fits the industry.
- Typography System: Select paired Google Fonts that match the vibe.
  - Luxury/Fashion: Elegant Serifs (e.g., Cormorant Garamond) + Clean Sans.
  - Tech/Web3: Sharp Grotesks (e.g., Space Grotesk) + Monospace (e.g., JetBrains Mono).
  - Approachable/Lifestyle: Friendly, geometric Sans-serifs (e.g., Plus Jakarta Sans).
- Border Radius & Texture: Use rounded-[3rem] for soft/friendly brands, rounded-sm for strict/technical brands. Use CSS noise/grain only if it fits the aesthetic (good for brutalism/cinematic, bad for clean/medical).

[2. ADVANCED SVG & ANIMATION ENGINE (MANDATORY)]
- Custom Inline SVGs: You MUST generate at least TWO complex, custom, inline <svg> graphics/animations directly related to the topic. (e.g., Real Estate: an SVG floorplan that draws itself using stroke-dashoffset; Coffee Shop: an animating steam path over a cup). Do NOT use external image URLs for these graphics.
- Scroll Animations: Use IntersectionObserver for scroll-linked typography reveals (split-text staggered fade-ups), pinning effects, and parallax. Use CSS animations and transitions.
- Micro-Interactions: Elements must feel alive. Buttons should have a "magnetic" feel (subtle scale-up on hover) with overflow-hidden background-color slides.

[3. STRICT COMPONENT ARCHITECTURE]
A. The Morphing Navbar: Fixed pill-shape or full-width bar (depending on aesthetic). Starts transparent, morphs into a frosted glass panel (backdrop-blur) on scroll. Includes a non-standard right-side element (e.g., local time, "Systems Online" dot, or a dynamic availability badge).
B. Immersive Hero Section (100dvh): Heavy visual focus. Large background with an appropriate overlay or a generative CSS/SVG pattern. Massive, high-contrast typography. Include an interactive custom SVG element (e.g., a "Hold to interact" circular loader or a bouncing scroll indicator).
C. Interactive Functional Artifacts (Features): DO NOT use standard 3-column static cards. Replace them with a "Micro-UI Dashboard". Create interactive UI elements (mock telemetry, live cycling data, animated charts, or interactive sliders) that represent the features of the topic.
D. Stacking Scroll Archive: A vertical scroll section where cards stack on top of each other. As a new card enters, the previous one scales down (e.g., to 0.95), blurs slightly, and dims.
E. Dynamic Footer: Minimalist, deep contrast relative to the rest of the site. Include a high-end interaction, like a command-line style email input with a blinking cursor, or a massive marquee scrolling text.

[4. TECHNICAL REQUIREMENTS]
- Tech Stack: Pure HTML, CSS, JavaScript. NO external CDN or libraries — all code must be self-contained.
- Generate a FULL HTML document: <!DOCTYPE html>, <head>, <body>
- All CSS inside <style> in <head>, all JS inside <script> before </body>
- HTML5 semantics, meta tags (description, viewport, charset, Open Graph)
- Full responsiveness (Mobile First): min 3 breakpoints (mobile, tablet, desktop)
- Animation Lifecycle: Use IntersectionObserver for scroll reveals. CSS transitions on ALL interactive elements.
- Execution: NO placeholders (lorem ipsum). Write compelling, high-end, conversion-focused copy tailored entirely to the topic.
- All text in Russian language unless specified otherwise.
- Code Quality: Output production-ready, beautiful, complete code. Do not truncate sections.

═══════════════════════════════════════════
MULTIPAGE SITES (SEPARATE FILES) — CRITICAL
═══════════════════════════════════════════
TRIGGERS: words "многостраничный", "несколько страниц", "трёхстраничный", "добавь страницу", "новая страница", "отдельная страница", page count (2,3,4+)

When user asks for multipage site — you MUST create SEPARATE files:
- Each page — SEPARATE full HTML file (own <!DOCTYPE html>, <head>, <body>, full CSS in each file)
- Main page ALWAYS: index.html
- Additional: tours.html, about.html, history.html, contacts.html etc.
- Navigation: <a href="tours.html">Туры</a>, <a href="about.html">О нас</a>
- ALL pages have IDENTICAL navbar (with highlighted current page) and footer
- ALL pages contain full CSS styles (copy entire <style> block to each file!)
- Each page is full: own hero, minimum 3-4 unique sections

REQUIRED RESPONSE FORMAT for multipage site:
--- FILE: index.html ---
\`\`\`html
<!DOCTYPE html>
<html>... full HTML document ...</html>
\`\`\`
--- FILE: tours.html ---
\`\`\`html
<!DOCTYPE html>
<html>... full HTML document ...</html>
\`\`\`

When EDITING multipage site:
- Changing one page → output ONLY that page with --- FILE: marker
- Changing navbar/footer → output ALL pages with updates
- New page → output new page + updated index.html (with new link)

═══════════════════════════════════════════
IMAGE HANDLING
═══════════════════════════════════════════
- For every place where an image is needed — create a BEAUTIFUL placeholder block
- Use div with class "image-placeholder" and attribute data-image-hint="description"
- Placeholder must be PART of the design: gradient + SVG icon + label
- Each placeholder — unique gradient matching the theme
- For hero: large (min-height: 400px), for cards: small (200-250px)
- Example:
  <div class="image-placeholder" data-image-hint="Description" style="width:100%;height:400px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;position:relative;overflow:hidden;">
    <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
    <span style="margin-top:12px;font-weight:600;opacity:0.8;font-size:0.875rem;">Description</span>
  </div>
- Do NOT use placeholder services or external URLs for images
- Do NOT use <img> without a real src — use div-placeholder only

If user has an AI image library:
- Insert marker {{IMG:image_name}} in img tag src
- Marker will be automatically replaced with real URL

═══════════════════════════════════════════
FORMS & LEAD COLLECTION (IMPORTANT)
═══════════════════════════════════════════
All forms on the site (contact, order, booking, subscription) must send data to API:
- endpoint: window.location.origin + "/api/leads/PROJECT_ID" (PROJECT_ID will be replaced automatically)
- Method: POST, Content-Type: application/json
- Body: { name, email, phone, message, source } (source = form name, e.g. "hero-cta", "contact", "booking")
- After submission show beautiful success notification (no alert — use custom toast/notification)
- Must add preventDefault on submit and field validation

JS template for form:
document.querySelectorAll('form[data-lead-form]').forEach(form => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = { name: fd.get('name')||'', email: fd.get('email')||'', phone: fd.get('phone')||'', message: fd.get('message')||'', source: form.dataset.leadForm||'form' };
    try {
      const r = await fetch(window.location.origin.replace(/:\\d+$/, ':5000') + '/api/leads/' + (window.__PROJECT_ID__ || '0'), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      if(r.ok) { /* show toast success */ form.reset(); }
    } catch(err) { console.error(err); }
  });
});

Wrap each form in <form data-lead-form="form_name">, and give fields attributes name="name", name="email", name="phone", name="message".

═══════════════════════════════════════════
QUALITY DIRECTIVE
═══════════════════════════════════════════
Do not create a website — create a DIGITAL INSTRUMENT.
Every scroll must feel meaningful.
Every animation must be weighty and professional.
Destroy all generic AI patterns.
The result must look like a $15,000 studio project.`;

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

      const { prompt, imageBase64, imageMimeType, activeFile } = req.body;
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

      const isEditMode = !!project.generatedCode;
      const existingFiles = await storage.getProjectFiles(project.id);

      if (isEditMode) {
        const editingFile = activeFile || "index.html";
        const editingFileCode = editingFile === "index.html" 
          ? project.generatedCode 
          : existingFiles.find(f => f.filename === editingFile)?.code || project.generatedCode;

        systemContent += `\n\n${"═".repeat(43)}\nРЕЖИМ РЕДАКТИРОВАНИЯ — АКТИВНЫЙ ФАЙЛ: ${editingFile}\n${"═".repeat(43)}\nПользователь РЕДАКТИРУЕТ файл "${editingFile}". Все изменения должны применяться К ЭТОМУ ФАЙЛУ.\nТы ОБЯЗАН:\n1. Сохранить ВСЕ существующие секции, стили, контент, анимации и структуру\n2. Изменять/добавлять ТОЛЬКО то, что явно просит пользователь\n3. НЕ удалять, НЕ упрощать, НЕ сокращать существующий код\n4. Вернуть ПОЛНЫЙ документ целиком (от <!DOCTYPE html> до </html>)\n\nФОРМАТ ОТВЕТА:\n- Сначала напиши 1-3 предложения о внесённых изменениях\n- Затем ОДИН блок \`\`\`html с ПОЛНЫМ обновлённым кодом файла "${editingFile}"\n- Если пользователь просит изменить ВСЕ страницы — используй маркеры --- FILE: имя.html --- перед каждым блоком\n\n`;

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

      const geminiHistory: any[] = [];

      if (!isEditMode) {
        for (const msg of previousMessages.slice(0, -1)) {
          geminiHistory.push({
            role: msg.role === "user" ? "user" : "model",
            parts: [{ text: msg.content }],
          });
        }
      }

      const userParts: any[] = [];

      if (imageBase64) {
        const mime = imageMimeType || "image/png";
        const isImage = mime.startsWith("image/");
        const textPart = isEditMode
          ? prompt
          : `Создай сайт на основе этого изображения-примера. ${prompt}`;
        userParts.push({ text: textPart });
        if (isImage) {
          userParts.push({ inlineData: { data: imageBase64, mimeType: mime } });
        } else {
          const extractedText = await extractTextFromFile(imageBase64, mime);
          if (extractedText) {
            const truncated = extractedText.length > 15000 ? extractedText.substring(0, 15000) + "\n...[текст обрезан]" : extractedText;
            userParts.push({ text: `\n\nСОДЕРЖИМОЕ ПРИКРЕПЛЁННОГО ДОКУМЕНТА (${mime}):\n---\n${truncated}\n---\n\nИспользуй этот текст из документа при создании/редактировании сайта.` });
          } else {
            userParts.push({ text: `[Прикреплён файл формата ${mime}, но его содержимое не удалось извлечь. Создай сайт на основе текстового запроса.]` });
          }
        }
      } else if (isEditMode) {
        userParts.push({ text: prompt });
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

      const allFiles = await storage.getProjectFiles(project.id);
      const editedFileCode = editingFile !== "index.html" ? allFiles.find(f => f.filename === editingFile)?.code : mainHtmlCode;
      res.write(`data: ${JSON.stringify({ done: true, code: mainHtmlCode, editedFile: editingFile, editedCode: editedFileCode || mainHtmlCode, reply: aiTextReply, files: allFiles.map(f => ({ filename: f.filename, id: f.id })) })}\n\n`);
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
