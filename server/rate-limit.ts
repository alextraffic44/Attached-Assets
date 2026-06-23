import type { Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number };

interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

const stores = new Map<string, Map<string, Bucket>>();

let lastSweep = Date.now();
function sweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const store of stores.values()) {
    for (const [key, bucket] of store.entries()) {
      if (bucket.resetAt <= now) store.delete(key);
    }
  }
}

function clientIp(req: Request): string {
  return (req.ip || req.socket?.remoteAddress || "unknown").toString();
}

/**
 * Lightweight in-memory fixed-window rate limiter.
 * Suitable for a single-instance deployment. Each named limiter keeps its own store.
 */
export function rateLimit(name: string, opts: RateLimitOptions) {
  if (!stores.has(name)) stores.set(name, new Map());
  const store = stores.get(name)!;
  const message = opts.message || "Слишком много запросов. Попробуйте позже.";

  return (req: Request, res: Response, next: NextFunction) => {
    sweep();
    const key = opts.keyGenerator ? opts.keyGenerator(req) : clientIp(req);
    const now = Date.now();
    let bucket = store.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      store.set(key, bucket);
    }
    bucket.count++;
    const remaining = Math.max(0, opts.max - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(opts.max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    if (bucket.count > opts.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ message });
    }
    next();
  };
}

/** Key by authenticated user id when present, otherwise by IP. */
export function userOrIpKey(req: Request): string {
  const id = (req as any).user?.id;
  return id ? `u:${id}` : `ip:${(req.ip || "unknown").toString()}`;
}
