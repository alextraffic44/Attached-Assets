/**
 * Shared KIE jobs helpers: callBackUrl on every createTask + hybrid
 * callback/poll waiter so all modes receive results via webhook when possible.
 *
 * Callback body matches recordInfo (code/msg/data.state/resultJson/…).
 */
import type { Express, Request, Response } from "express";

export type KieTaskData = {
  taskId?: string;
  model?: string;
  state?: string;
  resultJson?: string | Record<string, unknown>;
  failCode?: string | number | null;
  failMsg?: string | null;
  [k: string]: unknown;
};

export type KieTerminalResult =
  | { ok: true; data: KieTaskData }
  | { ok: false; data: KieTaskData | null; reason: "fail" | "timeout" | "abort" };

type Waiter = {
  resolve: (r: KieTerminalResult) => void;
  settled: boolean;
};

const waiters = new Map<string, Waiter>();
const resultCache = new Map<string, KieTerminalResult>();
const CACHE_TTL_MS = 15 * 60 * 1000;

/** Peek cached terminal result (used by /api/images/status fast path). */
export function getCachedKieResult(taskId: string): KieTerminalResult | undefined {
  return resultCache.get(taskId);
}

export type KieTerminalHandler = (taskId: string, data: KieTaskData) => void | Promise<void>;
let terminalHandler: KieTerminalHandler | null = null;

/** Optional side-effect when a job reaches success/fail (e.g. bake Kling into project HTML). */
export function setKieTerminalHandler(handler: KieTerminalHandler | null): void {
  terminalHandler = handler;
}

export function getAppBaseUrl(): string {
  return (process.env.APP_BASE_URL || "https://craft-ai.ru").replace(/\/$/, "");
}

/** Public webhook KIE will POST to when the job finishes. */
export function buildKieCallbackUrl(): string {
  const secret = process.env.KIE_CALLBACK_SECRET;
  const base = `${getAppBaseUrl()}/api/kie/callback`;
  return secret ? `${base}?token=${encodeURIComponent(secret)}` : base;
}

/** Attach callBackUrl to any createTask payload (does not mutate input). */
export function withKieCallback<T extends Record<string, unknown>>(payload: T): T & { callBackUrl: string } {
  return { ...payload, callBackUrl: buildKieCallbackUrl() };
}

function isTerminalState(state: unknown): state is string {
  const s = String(state || "").toLowerCase();
  return s === "success" || s === "fail" || s === "failed" || s === "error";
}

function toTerminal(data: KieTaskData): KieTerminalResult {
  const s = String(data?.state || "").toLowerCase();
  if (s === "success") return { ok: true, data };
  return { ok: false, data, reason: "fail" };
}

function cacheResult(taskId: string, result: KieTerminalResult): void {
  resultCache.set(taskId, result);
  setTimeout(() => {
    const cur = resultCache.get(taskId);
    if (cur === result) resultCache.delete(taskId);
  }, CACHE_TTL_MS).unref?.();
}

/**
 * Settle in-flight waiters from a callback or poll. Returns true if this was a
 * terminal state we understood.
 */
export function notifyKieJobTerminal(taskId: string, data: KieTaskData): boolean {
  if (!taskId || !isTerminalState(data?.state)) return false;
  const result = toTerminal(data);
  cacheResult(taskId, result);
  const w = waiters.get(taskId);
  if (w && !w.settled) {
    w.settled = true;
    w.resolve(result);
    waiters.delete(taskId);
  }
  // Fire durable handler (Kling HTML bake, etc.) — never block the HTTP response.
  if (terminalHandler) {
    Promise.resolve()
      .then(() => terminalHandler!(taskId, data))
      .catch((e: any) => console.warn("[KIE-CB] terminal handler error:", e?.message || e));
  }
  return true;
}

export function parseKieCallbackBody(body: any): { taskId: string; data: KieTaskData } | null {
  if (!body || typeof body !== "object") return null;
  // KIE may wrap as { code, msg, data } (recordInfo shape) or send data directly.
  const data: KieTaskData = (body.data && typeof body.data === "object" ? body.data : body) as KieTaskData;
  const taskId = String(data.taskId || body.taskId || "").trim();
  if (!taskId) return null;
  if (!data.taskId) data.taskId = taskId;
  return { taskId, data };
}

/**
 * Wait until KIE finishes this task — prefers webhook settlement, falls back to poll.
 */
export async function waitForKieJob(
  taskId: string,
  opts: {
    deadlineMs: number;
    shouldStop?: () => boolean;
    pollIntervalMs?: number;
    /** One status poll → returns data object or null */
    pollOnce: () => Promise<KieTaskData | null>;
    label?: string;
  },
): Promise<KieTerminalResult> {
  const cached = resultCache.get(taskId);
  if (cached) return cached;

  const shouldStop = opts.shouldStop || (() => false);
  const pollIntervalMs = opts.pollIntervalMs ?? 4000;
  const label = opts.label || "KIE";
  const deadline = Date.now() + Math.max(1000, opts.deadlineMs);

  return await new Promise<KieTerminalResult>((resolve) => {
    const entry: Waiter = { resolve, settled: false };
    waiters.set(taskId, entry);

    (async () => {
      // Immediate poll once — job might already be done (resume / fast stills).
      try {
        const first = await opts.pollOnce();
        if (first && isTerminalState(first.state)) {
          notifyKieJobTerminal(taskId, { ...first, taskId: first.taskId || taskId });
          return;
        }
      } catch (e: any) {
        console.warn(`[${label}] initial poll error:`, e?.message);
      }

      while (!entry.settled && Date.now() < deadline) {
        if (shouldStop()) {
          if (!entry.settled) {
            entry.settled = true;
            waiters.delete(taskId);
            resolve({ ok: false, data: null, reason: "abort" });
          }
          return;
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        if (entry.settled) return;
        try {
          const data = await opts.pollOnce();
          if (data && isTerminalState(data.state)) {
            notifyKieJobTerminal(taskId, { ...data, taskId: data.taskId || taskId });
            return;
          }
        } catch (e: any) {
          console.warn(`[${label}] poll error:`, e?.message);
        }
      }

      if (!entry.settled) {
        entry.settled = true;
        waiters.delete(taskId);
        resolve({ ok: false, data: null, reason: "timeout" });
      }
    })().catch((e: any) => {
      console.warn(`[${label}] waiter crashed:`, e?.message);
      if (!entry.settled) {
        entry.settled = true;
        waiters.delete(taskId);
        resolve({ ok: false, data: null, reason: "timeout" });
      }
    });
  });
}

/** Express: POST /api/kie/callback */
export function registerKieCallbackRoute(app: Express): void {
  app.post("/api/kie/callback", async (req: Request, res: Response) => {
    try {
      const secret = process.env.KIE_CALLBACK_SECRET;
      if (secret) {
        const token = String(req.query.token || req.headers["x-kie-callback-token"] || "");
        if (token !== secret) {
          return res.status(401).json({ ok: false, message: "unauthorized" });
        }
      }
      const parsed = parseKieCallbackBody(req.body);
      if (!parsed) {
        console.warn("[KIE-CB] bad payload:", JSON.stringify(req.body)?.slice(0, 300));
        return res.status(400).json({ ok: false, message: "invalid payload" });
      }
      const { taskId, data } = parsed;
      const settled = notifyKieJobTerminal(taskId, data);
      console.log(
        `[KIE-CB] task=${taskId.slice(0, 14)}… state=${data.state} settled=${settled}`,
      );
      // Always 200 so KIE does not retry forever on our business logic.
      return res.status(200).json({ ok: true, settled });
    } catch (e: any) {
      console.warn("[KIE-CB] handler error:", e?.message || e);
      return res.status(200).json({ ok: false, message: "handled-with-error" });
    }
  });
}

/** Extract first result URL from KIE task data.resultJson */
export function kieResultUrl(data: KieTaskData | null | undefined): string | null {
  if (!data) return null;
  let result: any = {};
  try {
    result = typeof data.resultJson === "string" ? JSON.parse(data.resultJson) : (data.resultJson || {});
  } catch {
    return null;
  }
  return (result.resultUrls || [])[0] || null;
}
