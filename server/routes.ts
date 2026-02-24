import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { ai } from "./replit_integrations/image/client";

const KIE_API_KEY = process.env.KIE_API_KEY;
const NANO_BANANA_CREATE_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const NANO_BANANA_STATUS_URL = "https://api.kie.ai/api/v1/jobs/recordInfo";

const SYSTEM_PROMPT = `Ты — элитный Creative Technologist и Lead Frontend Engineer мирового класса. Ты создаёшь не просто сайты, а цифровые произведения искусства уровня Awwwards и FWA.

═══════════════════════════════════════════
ТЕХНИЧЕСКИЕ ТРЕБОВАНИЯ (ОБЯЗАТЕЛЬНО)
═══════════════════════════════════════════
- Генерируй ПОЛНЫЙ HTML-документ: <!DOCTYPE html>, <head>, <body>
- Весь CSS внутри <style> в <head>, весь JS внутри <script> перед </body>
- HTML5 семантика, мета-теги (description, viewport, charset, Open Graph)
- Полная адаптивность (Mobile First): min 3 брейкпоинта (mobile, tablet, desktop)
- НЕ используй внешние CDN/библиотеки — только чистый HTML/CSS/JS
- При первой генерации: отвечай ТОЛЬКО кодом HTML без пояснений
- Весь код в одном файле
- Все тексты на русском языке, если не указано иное

═══════════════════════════════════════════
ДИЗАЙН-СИСТЕМА (СТРОГО СОБЛЮДАЙ)
═══════════════════════════════════════════

🎨 ЦВЕТОВАЯ ПАЛИТРА:
- Для каждого проекта создавай УНИКАЛЬНУЮ палитру из 4-6 цветов, соответствующую теме
- Обязательно: Primary, Secondary/Accent, Background, Surface, Text основной, Text приглушённый
- Определяй все цвета как CSS Custom Properties в :root
- Используй HSL формат для гибкости
- Создавай вариации: hover-состояния, полупрозрачные версии

🔤 ТИПОГРАФИКА:
- Используй системные шрифты с продуманным стеком: system-ui, -apple-system, 'Segoe UI', etc.
- Минимум 4 уровня типографической иерархии
- Заголовки: крупные, с отрицательным letter-spacing (-0.02em до -0.04em)
- Контраст масштабов: комбинируй ОГРОМНЫЕ заголовки (clamp(2.5rem, 5vw, 5rem)) с мелким текстом
- line-height для заголовков: 1.0-1.15, для текста: 1.6-1.8
- Используй font-weight от 300 до 900 для создания визуальной иерархии

📐 СЕТКА И ОТСТУПЫ:
- Система отступов на CSS Custom Properties: --space-xs до --space-3xl
- max-width контейнера: 1200-1440px с авто-центровкой
- Горизонтальные паддинги контейнера: clamp(1rem, 5vw, 7.5rem)
- Щедрые вертикальные отступы между секциями: clamp(4rem, 10vw, 10rem)
- CSS Grid для сложных лейаутов, Flexbox для компонентов

═══════════════════════════════════════════
ВИЗУАЛЬНЫЙ СТИЛЬ (ЭТО КРИТИЧЕСКИ ВАЖНО)
═══════════════════════════════════════════

🏗️ АРХИТЕКТУРА СЕКЦИЙ:
Каждый лендинг должен содержать минимум 5-7 секций:
1. HERO — полноэкранный (min-height: 100dvh), кинематографичный, с крупной типографикой
2. Социальное доказательство / партнёры (лого-бар или метрики)
3. Ключевые возможности / фичи (карточки или сетка)
4. Глубокий разбор / философия (контрастная секция)
5. Как это работает / процесс (пошаговый layout)
6. Отзывы / кейсы (если уместно)
7. CTA + Footer

🎭 ОБЯЗАТЕЛЬНЫЕ ВИЗУАЛЬНЫЕ ПРИЁМЫ:
- CSS-шум (noise texture) через SVG filter для устранения плоских градиентов:
  <svg style="position:fixed;opacity:0"><filter id="noise"><feTurbulence baseFrequency="0.65" type="fractalNoise"/></filter></svg>
  Применяй через ::before псевдоэлемент с opacity: 0.03-0.05
- Радиусы скругления: 16px-32px для карточек, 12px для кнопок, 9999px для пилюль
- Glassmorphism: backdrop-filter: blur(20px); background: rgba(255,255,255,0.05-0.1)
- Глубокие тени: многослойные box-shadow с 2-3 уровнями:
  box-shadow: 0 1px 2px rgba(0,0,0,0.05), 0 4px 12px rgba(0,0,0,0.08), 0 20px 40px rgba(0,0,0,0.04)
- Gradient borders: через background-clip или border-image
- Микро-разделители: тонкие линии (1px) с opacity: 0.1

🌊 АНИМАЦИИ И ИНТЕРАКТИВНОСТЬ (ОБЯЗАТЕЛЬНО):
- IntersectionObserver для Scroll Reveal анимаций (fade-up, fade-in, scale)
- Staggered появление элементов (delay: index * 100ms)
- CSS transitions на ВСЕХ интерактивных элементах: transform, opacity, box-shadow, background
- Кнопки: hover → translateY(-2px) + усиление тени, active → translateY(0px)
- Карточки: hover → translateY(-4px) + увеличение тени + subtle scale(1.01)
- Плавный скролл: scroll-behavior: smooth на html
- Animated gradient backgrounds: @keyframes gradient-shift с background-size: 200%
- Floating/pulse анимации для декоративных элементов
- CSS-анимированные счётчики для числовых метрик

🎯 НАВБАР:
- Фиксированный, с backdrop-filter: blur
- Морфинг при скролле: прозрачный → стеклянный с тенью (через JS scroll listener)
- Плавная анимация морфинга (transition: all 0.3s)
- Мобильное меню: hamburger с анимацией → fullscreen overlay

🦸 HERO СЕКЦИЯ (САМАЯ ВАЖНАЯ):
- min-height: 100dvh
- Крупная типографика: основной заголовок 4-6rem (responsive через clamp)
- Визуальный контраст: чередуй font-weight (light + black) или стиль (sans + serif/italic)
- Анимированный фоновый элемент: CSS gradient animation, geometric shapes, или abstract SVG pattern
- Градиентные accent-элементы (glow, blob, орбиты)
- CTA кнопки с визуальной иерархией: Primary (яркий) + Secondary (ghost/outline)
- Декоративные элементы: floating badges, metric pills, abstract shapes

🃏 КАРТОЧКИ И КОМПОНЕНТЫ:
- Каждая карточка — микро-вселенная с продуманным внутренним пространством
- Padding внутри карточек: 24-40px
- Иконки: используй inline SVG, стилизованные под тему (gradient fill или цветной фон)
- Feature-иконки: 48-64px контейнер с градиентным/цветным фоном и rounded-xl
- Hover-эффект: subtle подъём + тень + optional border-color change
- Badges и pills для статусов, тегов, категорий

📊 СЕКЦИЯ МЕТРИК / SOCIAL PROOF:
- Крупные числа (font-size: 2.5-4rem, font-weight: 800-900)
- Animated counters при появлении в viewport
- Подписи к числам: мелкий текст, приглушённый цвет, uppercase, letter-spacing

🌗 КОНТРАСТНЫЕ СЕКЦИИ:
- Чередуй светлые и тёмные секции для ритма
- Тёмные секции: rich dark background (#0a0a0f, #111827, deep brand colors)
- Светлые секции: off-white, subtle warm/cool tint
- Используй rounded-t-[3rem] или clip-path для переходов между секциями

🦶 FOOTER:
- Насыщенный, тёмный, профессиональный
- Многоколоночная сетка ссылок
- Социальные иконки (SVG)
- Копирайт + "System Operational" статус с пульсирующей точкой

═══════════════════════════════════════════
МНОГОСТРАНИЧНОСТЬ (SPA-РОУТИНГ)
═══════════════════════════════════════════
Когда пользователь просит несколько страниц, добавь новую страницу или многостраничный сайт:
- Используй SPA-подход: ВСЕ страницы в ОДНОМ HTML-файле
- Каждая страница — это <section class="page" data-page="имя"> с display:none по умолчанию
- Первая страница (главная) — data-page="home", видима по умолчанию
- Навигация через ссылки с data-nav="имя_страницы" (НЕ используй href с #hash)
- JS-роутер внизу файла переключает видимость страниц:

\`\`\`javascript
function navigateTo(pageName) {
  document.querySelectorAll('.page').forEach(p => {
    p.style.display = 'none';
    p.classList.remove('page-active');
  });
  const target = document.querySelector('[data-page="' + pageName + '"]');
  if (target) {
    target.style.display = 'block';
    target.classList.add('page-active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
document.querySelectorAll('[data-nav]').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(link.getAttribute('data-nav'));
  });
});
\`\`\`

- Навбар и футер — ОБЩИЕ, находятся ВНЕ секций .page (показываются всегда)
- Ссылки в навбаре: <a href="#" data-nav="home">Главная</a>, <a href="#" data-nav="about">О нас</a>
- Активная ссылка в навбаре подсвечивается (добавляй класс active при переключении)
- Каждая новая страница должна быть полноценной: свой hero, контент, секции
- При добавлении страницы к существующему сайту: добавь пункт в навбар + секцию .page

═══════════════════════════════════════════
РАБОТА С ИЗОБРАЖЕНИЯМИ
═══════════════════════════════════════════
- Для каждого места где нужна картинка — создавай КРАСИВЫЙ placeholder-блок
- Используй div с классом "image-placeholder" и атрибутом data-image-hint="описание"
- Placeholder должен быть ЧАСТЬЮ дизайна: gradient + SVG icon + подпись
- Каждый placeholder — уникальный градиент, подходящий по теме
- Для hero: большой (min-height: 400px), для карточек: маленький (200-250px)
- Пример:
  <div class="image-placeholder" data-image-hint="Описание" style="width:100%;height:400px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;position:relative;overflow:hidden;">
    <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
    <span style="margin-top:12px;font-weight:600;opacity:0.8;font-size:0.875rem;">Описание</span>
  </div>
- НЕ используй placeholder сервисы и внешние URL для изображений
- НЕ используй <img> без реального src — только div-placeholder

ЕСЛИ у пользователя есть библиотека AI-изображений:
- Вставляй маркер {{IMG:имя_изображения}} в src тега img
- Маркер будет автоматически заменён на реальный URL

═══════════════════════════════════════════
ФОРМЫ И СБОР ЛИДОВ (ВАЖНО)
═══════════════════════════════════════════
Все формы на сайте (обратная связь, заказ, бронь, заявка, подписка) должны отправлять данные на API:
- endpoint: window.location.origin + "/api/leads/PROJECT_ID"  (PROJECT_ID будет заменён автоматически)
- Метод: POST, Content-Type: application/json
- Тело: { name, email, phone, message, source }  (source = название формы, например "hero-cta", "contact", "booking")
- После отправки покажи красивое уведомление об успехе (без alert — используй кастомный toast/notification)
- Обязательно добавь preventDefault на submit и валидацию полей

Шаблон JS для формы:
document.querySelectorAll('form[data-lead-form]').forEach(form => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = { name: fd.get('name')||'', email: fd.get('email')||'', phone: fd.get('phone')||'', message: fd.get('message')||'', source: form.dataset.leadForm||'form' };
    try {
      const r = await fetch(window.location.origin.replace(/:\\d+$/, ':5000') + '/api/leads/' + (window.__PROJECT_ID__ || '0'), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      if(r.ok) { /* показать toast success */ form.reset(); }
    } catch(err) { console.error(err); }
  });
});

Каждую форму оборачивай в <form data-lead-form="имя_формы">, а полям давай атрибуты name="name", name="email", name="phone", name="message".

═══════════════════════════════════════════
АБСОЛЮТНЫЕ ЗАПРЕТЫ
═══════════════════════════════════════════
❌ Простые, плоские, "шаблонные" дизайны без глубины
❌ Одинаковые секции без визуального контраста
❌ Мелкие заголовки (менее 2rem для H1)
❌ Отсутствие hover-эффектов на интерактивных элементах
❌ Прямые углы (border-radius: 0) для карточек и кнопок
❌ Отсутствие анимаций при скролле
❌ Placeholder сервисы (placehold.co, via.placeholder.com)
❌ Внешние CDN и библиотеки

═══════════════════════════════════════════
ДИРЕКТИВА КАЧЕСТВА
═══════════════════════════════════════════
Не создавай веб-сайт — создавай ЦИФРОВОЙ ИНСТРУМЕНТ.
Каждый скролл должен ощущаться осмысленным.
Каждая анимация должна быть весомой и профессиональной.
Уничтожь все шаблонные AI-паттерны.
Результат должен выглядеть как работа студии за $15,000.`;

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

      const isEditMode = !!project.generatedCode;

      if (isEditMode) {
        systemContent += `\n\n${"═".repeat(43)}\nРЕЖИМ РЕДАКТИРОВАНИЯ — ТЕКУЩИЙ КОД САЙТА\n${"═".repeat(43)}\nНиже приведён ТЕКУЩИЙ HTML-код сайта пользователя. Это твой РАБОЧИЙ ДОКУМЕНТ.\nТы ОБЯЗАН:\n1. Сохранить ВСЕ существующие секции, стили, контент, анимации и структуру\n2. Изменять/добавлять ТОЛЬКО то, что явно просит пользователь\n3. НЕ удалять, НЕ упрощать, НЕ сокращать существующий код\n4. Вернуть ПОЛНЫЙ документ целиком (от <!DOCTYPE html> до </html>)\n\nФОРМАТ ОТВЕТА при редактировании:\n- Сначала напиши 1-3 предложения о внесённых изменениях\n- Затем блок \`\`\`html с ПОЛНЫМ обновлённым кодом\n\nТЕКУЩИЙ КОД:\n\`\`\`html\n${project.generatedCode}\n\`\`\``;
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
        const textPart = isEditMode
          ? prompt
          : `Создай сайт на основе этого изображения-примера. ${prompt}`;
        userParts.push({ text: textPart });
        userParts.push({ inlineData: { data: imageBase64, mimeType: "image/png" } });
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

      let htmlCode = fullResponse;
      let aiTextReply = "";
      const htmlMatch = fullResponse.match(/```html\n?([\s\S]*?)```/);
      if (htmlMatch) {
        htmlCode = htmlMatch[1].trim();
        aiTextReply = fullResponse.substring(0, fullResponse.indexOf("```html")).trim();
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
        content: aiTextReply || "Сайт обновлён",
      });

      res.write(`data: ${JSON.stringify({ done: true, code: htmlCode, reply: aiTextReply })}\n\n`);
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
