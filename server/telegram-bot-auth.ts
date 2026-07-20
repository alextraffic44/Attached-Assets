import { createHash, randomBytes } from "crypto";
import { pool } from "./db";

function log(message: string) {
  console.log(`[telegram] ${message}`);
}

export type TelegramBotProfile = {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

type PendingAuth = {
  createdAt: number;
  status: "pending" | "ready" | "consumed";
  profile?: TelegramBotProfile;
};

const PENDING_TTL_MS = 10 * 60 * 1000;
let cachedBotUsername: string | null = null;
let tableReady: Promise<void> | null = null;

async function ensureTable() {
  if (!tableReady) {
    tableReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS telegram_auth_pending (
          nonce TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          profile JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      .then(() => undefined)
      .catch((err) => {
        tableReady = null;
        throw err;
      });
  }
  await tableReady;
}

async function cleanupExpired() {
  await ensureTable();
  await pool.query(
    `DELETE FROM telegram_auth_pending WHERE created_at < NOW() - INTERVAL '10 minutes'`,
  );
}

export async function createTelegramBotAuthNonce(): Promise<string> {
  await cleanupExpired();
  const nonce = randomBytes(16).toString("hex");
  await pool.query(
    `INSERT INTO telegram_auth_pending (nonce, status) VALUES ($1, 'pending')`,
    [nonce],
  );
  return nonce;
}

export async function getTelegramBotAuthStatus(nonce: string): Promise<PendingAuth | undefined> {
  await ensureTable();
  const { rows } = await pool.query(
    `SELECT status, profile, EXTRACT(EPOCH FROM created_at) * 1000 AS created_ms
     FROM telegram_auth_pending WHERE nonce = $1`,
    [nonce],
  );
  if (!rows[0]) return undefined;
  const row = rows[0];
  const createdAt = Number(row.created_ms) || Date.now();
  if (Date.now() - createdAt > PENDING_TTL_MS) {
    await pool.query(`DELETE FROM telegram_auth_pending WHERE nonce = $1`, [nonce]);
    return undefined;
  }
  return {
    createdAt,
    status: row.status,
    profile: row.profile || undefined,
  };
}

export async function consumeTelegramBotAuth(nonce: string): Promise<TelegramBotProfile | null> {
  await ensureTable();
  const { rows } = await pool.query(
    `UPDATE telegram_auth_pending
     SET status = 'consumed'
     WHERE nonce = $1 AND status = 'ready'
     RETURNING profile`,
    [nonce],
  );
  if (!rows[0]?.profile) return null;
  await pool.query(`DELETE FROM telegram_auth_pending WHERE nonce = $1`, [nonce]);
  return rows[0].profile as TelegramBotProfile;
}

export async function completeTelegramBotAuth(
  nonce: string,
  profile: TelegramBotProfile,
): Promise<boolean> {
  await ensureTable();
  const { rowCount } = await pool.query(
    `UPDATE telegram_auth_pending
     SET status = 'ready', profile = $2::jsonb
     WHERE nonce = $1 AND status = 'pending'`,
    [nonce, JSON.stringify(profile)],
  );
  return (rowCount || 0) > 0;
}

function botApi(method: string, body?: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return Promise.resolve(null);
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
    .then(async (res) => {
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        console.error(`Telegram API ${method} failed:`, data || res.status);
        return null;
      }
      return data.result;
    })
    .catch((err) => {
      console.error(`Telegram API ${method} error:`, err);
      return null;
    });
}

export function getBotUsernameFromEnv(): string | null {
  if (cachedBotUsername) return cachedBotUsername;
  const fromEnv = process.env.VITE_TELEGRAM_BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME;
  if (fromEnv) {
    cachedBotUsername = String(fromEnv).replace(/^@/, "");
    return cachedBotUsername;
  }
  cachedBotUsername = "Craft_AI_RU_bot";
  return cachedBotUsername;
}

export function buildTelegramBotDeepLink(nonce: string): string | null {
  const username = getBotUsernameFromEnv();
  if (!username) return null;
  return `https://t.me/${username}?start=auth_${nonce}`;
}

function webhookSecret(): string {
  const explicit = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (explicit) return explicit;
  const token = process.env.TELEGRAM_BOT_TOKEN || "dev";
  return createHash("sha256").update(`craft-ai-tg-webhook:${token}`).digest("hex").slice(0, 32);
}

export function expectedTelegramWebhookSecret(): string {
  return webhookSecret();
}

async function sendLoginConfirm(chatId: number | string) {
  await botApi("sendMessage", {
    chat_id: chatId,
    text: "✅ Вход в Craft AI подтверждён.\nВернитесь в браузер — авторизация завершится автоматически.",
    disable_web_page_preview: true,
  });
}

export function handleTelegramUpdate(update: any): void {
  void (async () => {
    try {
      const message = update?.message || update?.edited_message;
      if (!message?.chat?.id || typeof message.text !== "string") return;

      const text: string = message.text.trim();
      const match = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
      if (!match) return;

      const payload = (match[1] || "").trim();
      if (!payload.startsWith("auth_")) return;
      const nonce = payload.slice("auth_".length);
      if (!/^[a-f0-9]{16,64}$/i.test(nonce)) return;

      const from = message.from || {};
      const profile: TelegramBotProfile = {
        id: from.id ?? message.chat.id,
        first_name: from.first_name,
        last_name: from.last_name,
        username: from.username,
      };

      const ok = await completeTelegramBotAuth(nonce, profile);
      if (ok) {
        await sendLoginConfirm(message.chat.id);
      } else {
        await botApi("sendMessage", {
          chat_id: message.chat.id,
          text: "Ссылка для входа устарела или уже использована. Вернитесь на сайт и нажмите «Войти через Telegram» ещё раз.",
        });
      }
    } catch (err) {
      console.error("handleTelegramUpdate error:", err);
    }
  })();
}

let pollingStarted = false;

async function pollUpdatesLoop() {
  let offset = 0;
  while (pollingStarted) {
    const result = await botApi("getUpdates", {
      offset,
      timeout: 25,
      allowed_updates: ["message"],
    });
    if (!Array.isArray(result)) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    for (const update of result) {
      if (typeof update?.update_id === "number") {
        offset = update.update_id + 1;
      }
      handleTelegramUpdate(update);
    }
  }
}

export async function ensureTelegramBotAuthIngress(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    log("bot auth skipped: TELEGRAM_BOT_TOKEN not set");
    return;
  }

  try {
    await ensureTable();
  } catch (err) {
    console.error("[telegram] failed to ensure pending table:", err);
  }

  const me = await botApi("getMe");
  if (me?.username) {
    cachedBotUsername = String(me.username).replace(/^@/, "");
    log(`bot username: @${cachedBotUsername}`);
  }

  const base = (process.env.APP_BASE_URL || "https://craft-ai.ru").replace(/\/$/, "");
  const secret = webhookSecret();
  const webhookUrl = `${base}/api/auth/telegram/webhook`;

  const set = await botApi("setWebhook", {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });

  if (set) {
    log(`webhook set: ${webhookUrl}`);
    pollingStarted = false;
    return;
  }

  log("webhook failed — falling back to getUpdates polling");
  await botApi("deleteWebhook", { drop_pending_updates: false });
  if (!pollingStarted) {
    pollingStarted = true;
    void pollUpdatesLoop();
  }
}
