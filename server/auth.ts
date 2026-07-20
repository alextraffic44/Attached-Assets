import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { type Express } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { scrypt, randomBytes, timingSafeEqual, createHash, createHmac } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { rateLimit } from "./rate-limit";
import { pool, db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  buildTelegramBotDeepLink,
  consumeTelegramBotAuth,
  createTelegramBotAuthNonce,
  ensureTelegramBotAuthIngress,
  expectedTelegramWebhookSecret,
  getTelegramBotAuthStatus,
  handleTelegramUpdate,
} from "./telegram-bot-auth";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string | null) {
  if (!stored) return false;
  const [hashedPassword, salt] = stored.split(".");
  const hashedPasswordBuf = Buffer.from(hashedPassword, "hex");
  const suppliedPasswordBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
}

function verifyTelegramHash(data: Record<string, any>): boolean {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  const { hash, ...rest } = data;
  if (!hash) return false;

  const dataCheckString = Object.keys(rest)
    .sort()
    .filter(key => rest[key] !== undefined && rest[key] !== null)
    .map(key => `${key}=${rest[key]}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const hmac = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (hmac !== hash) return false;

  const authDate = parseInt(rest.auth_date);
  if (Date.now() / 1000 - authDate > 86400) return false;

  return true;
}

function getPublicOrigin(req: any): string {
  const xfProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const xfHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const proto = xfProto || (req.secure ? "https" : "http");
  const host = xfHost || req.headers.host || "localhost";
  return `${proto}://${host}`;
}

function decodeTgAuthResult(raw: string): Record<string, any> | null {
  try {
    let data = raw.replace(/-/g, "+").replace(/_/g, "/");
    const pad = data.length % 4;
    if (pad > 1) data += new Array(5 - pad).join("=");
    const parsed = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function setupAuth(app: Express) {
  const PgSessionStore = connectPg(session);

  const isProd = process.env.NODE_ENV === "production";
  const sessionSecret = process.env.SESSION_SECRET;
  if (isProd && !sessionSecret) {
    throw new Error("SESSION_SECRET must be set in production");
  }

  const sessionSettings: session.SessionOptions = {
    secret: sessionSecret || "dev-only-insecure-secret",
    resave: false,
    saveUninitialized: false,
    store: new PgSessionStore({
      pool: pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
    },
  };

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(
      { usernameField: "email" },
      async (email, password, done) => {
        try {
          const user = await storage.getUserByEmail(email);
          if (!user) {
            return done(null, false, { message: "Пользователь не найден" });
          }
          if (!user.password) {
            return done(null, false, { message: "Войдите через Telegram" });
          }
          const isValid = await comparePasswords(password, user.password);
          if (!isValid) {
            return done(null, false, { message: "Неверный пароль" });
          }
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    )
  );

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        return done(null, false);
      }
      done(null, user);
    } catch (err) {
      console.error("deserializeUser error for id", id, err);
      done(null, false);
    }
  });

  const authLimiter = rateLimit("auth", { windowMs: 60_000, max: 10, message: "Слишком много попыток. Подождите минуту." });

  app.post("/api/auth/register", authLimiter, async (req, res, next) => {
    try {
      const { email, password, displayName } = req.body;
      if (!email || !password || !displayName) {
        return res.status(400).json({ message: "Все поля обязательны" });
      }

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ message: "Пользователь с таким email уже существует" });
      }

      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        displayName,
      });

      req.login(user, (err) => {
        if (err) return next(err);
        const { password: _, ...safeUser } = user;
        return res.status(201).json(safeUser);
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/auth/login", authLimiter, (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Ошибка авторизации" });
      }
      req.login(user, (err) => {
        if (err) return next(err);
        const { password: _, ...safeUser } = user;
        return res.json(safeUser);
      });
    })(req, res, next);
  });

  async function loginWithTelegramData(
    data: Record<string, any>,
    req: any,
    res: any,
    next: any,
    mode: "json" | "redirect",
  ) {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      if (mode === "redirect") return res.redirect("/auth?error=telegram_not_configured");
      return res.status(503).json({ message: "Telegram авторизация не настроена" });
    }

    if (!verifyTelegramHash(data)) {
      if (mode === "redirect") return res.redirect("/auth?error=telegram_invalid");
      return res.status(401).json({ message: "Неверная подпись Telegram" });
    }

    const telegramId = String(data.id);
    const displayName = [data.first_name, data.last_name].filter(Boolean).join(" ") || data.username || "Пользователь";
    const avatarUrl = data.photo_url || null;

    let user = await storage.getUserByTelegramId(telegramId);
    if (!user) {
      user = await storage.createTelegramUser({ telegramId, displayName, avatarUrl });
    }

    req.login(user, (err: any) => {
      if (err) return next(err);
      if (mode === "redirect") return res.redirect("/dashboard");
      const { password: _, ...safeUser } = user!;
      return res.json(safeUser);
    });
  }

  app.post("/api/auth/telegram", async (req, res, next) => {
    try {
      await loginWithTelegramData(req.body, req, res, next, "json");
    } catch (err) {
      next(err);
    }
  });

  // Redirect-based Telegram Login Widget callback (more reliable than postMessage/onauth).
  app.get("/api/auth/telegram/callback", async (req, res, next) => {
    try {
      const data: Record<string, any> = {};
      for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === "string") data[key] = value;
      }
      await loginWithTelegramData(data, req, res, next, "redirect");
    } catch (err) {
      next(err);
    }
  });

  // Legacy Login Widget / oauth.telegram.org callback (kept for compatibility).
  // Primary login path is bot deep-link below — oauth.telegram.org is often blocked in RF.
  app.get("/api/auth/telegram/callback", async (req, res, next) => {
    try {
      if (!process.env.TELEGRAM_BOT_TOKEN) {
        return res.redirect("/auth?error=telegram_not_configured");
      }
      const data: Record<string, any> = {};
      for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === "string") data[key] = value;
      }
      if (typeof req.query.tgAuthResult === "string" && !data.hash) {
        const decoded = decodeTgAuthResult(req.query.tgAuthResult);
        if (decoded) Object.assign(data, decoded);
      }
      if (!verifyTelegramHash(data)) {
        return res.redirect("/auth?error=telegram_invalid");
      }
      const telegramId = String(data.id);
      const displayName = [data.first_name, data.last_name].filter(Boolean).join(" ") || data.username || "Пользователь";
      const avatarUrl = data.photo_url || null;
      let user = await storage.getUserByTelegramId(telegramId);
      if (!user) {
        user = await storage.createTelegramUser({ telegramId, displayName, avatarUrl });
      }
      req.login(user, (err) => {
        if (err) return next(err);
        return res.redirect("/dashboard");
      });
    } catch (err) {
      next(err);
    }
  });

  // Bot deep-link login — works when oauth.telegram.org is unreachable (common ISP blocks).
  // Flow: create nonce → open t.me/Bot?start=auth_<nonce> → webhook/poll marks ready → client polls status.
  app.post("/api/auth/telegram/bot/start", authLimiter, async (req, res, next) => {
    try {
      if (!process.env.TELEGRAM_BOT_TOKEN) {
        return res.status(503).json({ message: "Telegram авторизация не настроена" });
      }
      const nonce = await createTelegramBotAuthNonce();
      const url = buildTelegramBotDeepLink(nonce);
      if (!url) {
        return res.status(503).json({ message: "Telegram bot username не настроен" });
      }
      return res.json({ nonce, url });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/auth/telegram/bot/status", async (req, res, next) => {
    try {
      const nonce = typeof req.query.nonce === "string" ? req.query.nonce : "";
      if (!/^[a-f0-9]{16,64}$/i.test(nonce)) {
        return res.status(400).json({ status: "invalid" });
      }
      const entry = await getTelegramBotAuthStatus(nonce);
      if (!entry) return res.json({ status: "expired" });
      if (entry.status === "pending") return res.json({ status: "pending" });
      if (entry.status === "consumed") return res.json({ status: "consumed" });

      const profile = await consumeTelegramBotAuth(nonce);
      if (!profile) return res.json({ status: "expired" });

      const telegramId = String(profile.id);
      const displayName =
        [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
        profile.username ||
        "Пользователь";
      const avatarUrl = profile.photo_url || null;

      let user = await storage.getUserByTelegramId(telegramId);
      if (!user) {
        user = await storage.createTelegramUser({ telegramId, displayName, avatarUrl });
      }

      req.login(user, (err) => {
        if (err) return next(err);
        const { password: _, ...safeUser } = user!;
        return res.json({ status: "ready", user: safeUser });
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/auth/telegram/webhook", (req, res) => {
    const secret = expectedTelegramWebhookSecret();
    const header = String(req.headers["x-telegram-bot-api-secret-token"] || "");
    if (!secret || header !== secret) {
      return res.status(401).json({ ok: false });
    }
    handleTelegramUpdate(req.body);
    return res.json({ ok: true });
  });

  // Optional legacy redirect to oauth.telegram.org (may time out in some networks).
  app.get("/api/auth/telegram/start", (req, res) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return res.redirect("/auth?error=telegram_not_configured");
    const botId = token.split(":")[0];
    if (!botId || !/^\d+$/.test(botId)) {
      return res.redirect("/auth?error=telegram_not_configured");
    }
    const origin = getPublicOrigin(req);
    const returnTo = `${origin}/auth`;
    const url = new URL("https://oauth.telegram.org/auth");
    url.searchParams.set("bot_id", botId);
    url.searchParams.set("origin", origin);
    url.searchParams.set("request_access", "write");
    url.searchParams.set("return_to", returnTo);
    res.redirect(url.toString());
  });

  app.post("/api/auth/yandex", async (req, res, next) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ message: "Token required" });

      const infoRes = await fetch(`https://login.yandex.ru/info?format=json&oauth_token=${token}`);
      if (!infoRes.ok) return res.status(401).json({ message: "Недействительный Яндекс токен" });

      const info: any = await infoRes.json();
      const yandexId = String(info.id);
      const displayName = info.real_name || info.display_name || info.first_name || "Пользователь";
      const email = info.default_email || null;
      const avatarUrl = info.default_avatar_id
        ? `https://avatars.yandex.net/get-yapic/${info.default_avatar_id}/islands-200`
        : null;

      let user = await storage.getUserByYandexId(yandexId);

      if (!user && email) {
        const byEmail = await storage.getUserByEmail(email);
        if (byEmail && !byEmail.yandexId) {
          await db.update(users).set({ yandexId, avatarUrl: avatarUrl ?? byEmail.avatarUrl }).where(eq(users.id, byEmail.id));
          user = await storage.getUser(byEmail.id);
        }
      }

      if (!user) {
        user = await storage.createYandexUser({ yandexId, displayName, email: email ?? undefined, avatarUrl: avatarUrl ?? undefined });
      }

      req.login(user, (err) => {
        if (err) return next(err);
        const { password: _, ...safeUser } = user!;
        return res.json(safeUser);
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) return res.status(500).json({ message: "Ошибка выхода" });
      res.json({ message: "Вы вышли из системы" });
    });
  });

  app.get("/api/auth/user", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Не авторизован" });
    }
    const { password: _, ...safeUser } = req.user as any;
    res.json(safeUser);
  });

  void ensureTelegramBotAuthIngress();
}
