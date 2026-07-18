/**
 * Strict helpers for credit refunds.
 * Refund ONLY when we are certain the KIE API itself failed —
 * never on moderation, parse/patch failures, local ffmpeg, or ambiguous 4xx.
 */

export class KieApiError extends Error {
  readonly confirmedKieFailure = true as const;
  readonly status?: number;
  readonly source: "http" | "stream" | "network" | "task" | "body";

  constructor(
    message: string,
    opts?: { status?: number; source?: KieApiError["source"]; cause?: unknown },
  ) {
    super(message);
    this.name = "KieApiError";
    this.status = opts?.status;
    this.source = opts?.source ?? "http";
    if (opts?.cause !== undefined) {
      (this as any).cause = opts.cause;
    }
  }
}

/** Content-policy / guidelines blocks — user/content issue, NOT a KIE outage. */
export function isKieModerationFailure(
  failMsg?: string | null,
  failCode?: string | number | null,
): boolean {
  const s = `${failMsg || ""} ${failCode ?? ""}`.toLowerCase();
  if (!s.trim()) return false;
  return (
    s.includes("community") ||
    s.includes("guideline") ||
    s.includes("violat") ||
    s.includes("moderat") ||
    s.includes("inappropriate") ||
    s.includes("content policy") ||
    s.includes("nsfw") ||
    s.includes("safety") ||
    s.includes("blocked") ||
    s.includes("rejected by") ||
    // Kling often returns failCode 400 with guidelines text
    (/\b400\b/.test(s) &&
      (s.includes("guid") || s.includes("policy") || s.includes("community") || s.includes("moderat")))
  );
}

/**
 * Task ended in fail/failed/error for infrastructure reasons on KIE's side.
 * Returns false for moderation and for empty/unknown messages (not 100% sure).
 */
export function isKieTaskInfraFailure(
  failMsg?: string | null,
  failCode?: string | number | null,
): boolean {
  if (isKieModerationFailure(failMsg, failCode)) return false;

  const msg = String(failMsg || "").toLowerCase();
  const codeStr = String(failCode ?? "").trim();
  const codeNum = Number(codeStr);

  // Explicit HTTP-like infra codes from KIE job payload
  if (codeStr === "429" || codeNum === 429) return true;
  if (Number.isFinite(codeNum) && codeNum >= 500 && codeNum < 600) return true;

  if (!msg && !codeStr) return false;

  const infraHints = [
    "timeout",
    "timed out",
    "time out",
    "internal error",
    "internal server",
    "server error",
    "service unavailable",
    "unavailable",
    "overloaded",
    "high demand",
    "rate limit",
    "too many requests",
    "upstream",
    "gateway",
    "bad gateway",
    "capacity",
    "queue",
    "temporarily",
    "try again",
    "retry",
    "connection",
    "network",
    "econnreset",
    "enotfound",
    "socket",
    "502",
    "503",
    "504",
    "500",
    "429",
  ];
  return infraHints.some((h) => msg.includes(h) || codeStr.toLowerCase().includes(h));
}

/** createTask / recordInfo body: only 429 and 5xx are confirmed KIE infra. */
export function isConfirmedKieJobBodyFailure(body: any): boolean {
  if (body == null) return true; // no usable response after talking to KIE
  const code = typeof body.code === "number" ? body.code : Number(body.code);
  if (!Number.isFinite(code)) return false;
  if (code === 200) return false;
  if (code === 429 || code >= 500) return true;
  return false;
}

function messageLooksLikeConfirmedKie(msg: string): boolean {
  const m = msg.toLowerCase();
  // Thrown by our KIE wrappers
  if (m.startsWith("kie api error")) {
    const statusMatch = msg.match(/KIE API error\s+(\d+)/i);
    if (statusMatch) {
      const st = Number(statusMatch[1]);
      return st === 429 || st >= 500;
    }
    return true;
  }
  if (m.startsWith("kie claude stream error")) return true;
  if (m.startsWith("gemini kie error")) {
    const statusMatch = msg.match(/Gemini KIE error\s+(\d+)/i);
    if (statusMatch) {
      const st = Number(statusMatch[1]);
      return st === 429 || st >= 500;
    }
    return true;
  }
  // Network failures while calling api.kie.ai
  if (
    (m.includes("fetch failed") ||
      m.includes("network") ||
      m.includes("econnreset") ||
      m.includes("etimedout") ||
      m.includes("enotfound") ||
      m.includes("socket hang up") ||
      m.includes("aborted")) &&
    (m.includes("kie.ai") || m.includes("kie api") || m.includes("api.kie"))
  ) {
    return true;
  }
  return false;
}

/**
 * True only when the thrown value is a confirmed KIE API / transport failure.
 * Patch-apply, parse, safety/recitation content blocks → false.
 */
export function isConfirmedKieApiFailure(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof KieApiError) return true;
  if (typeof err === "object" && err !== null && (err as any).confirmedKieFailure === true) {
    return true;
  }

  const msg = err instanceof Error ? err.message : String(err);
  if (!msg) return false;

  // Content / model policy — not an API outage
  const lower = msg.toLowerCase();
  if (
    lower.includes("recitation") ||
    lower.includes("safety") ||
    (lower.includes("blocked") && !lower.includes("kie"))
  ) {
    return false;
  }

  return messageLooksLikeConfirmedKie(msg);
}

export function kieHttpError(status: number, bodyText: string, label = "KIE API"): Error {
  const msg = `${label} error ${status}: ${bodyText.slice(0, 400)}`;
  // Only 429 / 5xx are confirmed infrastructure failures eligible for refund.
  if (status === 429 || status >= 500) {
    return new KieApiError(msg, { status, source: "http" });
  }
  return new Error(msg);
}
