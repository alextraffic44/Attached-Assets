/**
 * Yandex Cloud IAM helpers — exchange a service-account authorized key for an IAM token.
 * Used to provision new clouds/folders/SAs when Object Storage bucket quotas fill up.
 */
import crypto from "crypto";

export type YcAuthorizedKey = {
  id: string;
  service_account_id: string;
  private_key: string;
};

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function loadAuthorizedKeyFromEnv(): YcAuthorizedKey | null {
  const raw = (process.env.YC_SERVICE_ACCOUNT_KEY || "").trim();
  if (!raw) return null;

  const tryParse = (text: string): YcAuthorizedKey | null => {
    try {
      const parsed = JSON.parse(text) as YcAuthorizedKey;
      if (!parsed?.id || !parsed?.service_account_id || !parsed?.private_key) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  // 1) Raw JSON (works in most hosts)
  const asJson = tryParse(raw);
  if (asJson) return asJson;

  // 2) Base64 of JSON — Amvera forbids " and ! in env values, so paste:
  //    base64 -w0 key.json
  try {
    const decoded = Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf8");
    const asB64 = tryParse(decoded);
    if (asB64) return asB64;
  } catch {
    /* ignore */
  }

  console.warn(
    "[YC-IAM] YC_SERVICE_ACCOUNT_KEY invalid — use JSON or base64(JSON). " +
      "Amvera: encode with `base64 -w0 authorized-key.json`",
  );
  return null;
}

/** Build a PS256 JWT for https://iam.api.cloud.yandex.net/iam/v1/tokens */
export function buildServiceAccountJwt(key: YcAuthorizedKey, ttlSec = 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "PS256", typ: "JWT", kid: key.id };
  const payload = {
    iss: key.service_account_id,
    aud: "https://iam.api.cloud.yandex.net/iam/v1/tokens",
    iat: now,
    exp: now + ttlSec,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign({
    key: key.private_key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return `${unsigned}.${b64url(signature)}`;
}

let cachedToken: { value: string; exp: number } | null = null;

export async function getIamToken(force = false): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (!force && cachedToken && cachedToken.exp > now + 60) return cachedToken.value;

  const key = loadAuthorizedKeyFromEnv();
  if (!key) {
    throw new Error(
      "YC_SERVICE_ACCOUNT_KEY не настроен — автосоздание облаков недоступно. Добавьте ключ сервисного аккаунта организации.",
    );
  }

  const jwt = buildServiceAccountJwt(key);
  const res = await fetch("https://iam.api.cloud.yandex.net/iam/v1/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jwt }),
  });
  const data = (await res.json().catch(() => ({}))) as { iamToken?: string; message?: string };
  if (!res.ok || !data.iamToken) {
    throw new Error(`IAM token error: ${data.message || res.status}`);
  }
  cachedToken = { value: data.iamToken, exp: now + 3500 };
  return data.iamToken;
}

export async function ycApi<T = any>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const token = await getIamToken();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || text || `HTTP ${res.status}`;
    throw new Error(`${method} ${url}: ${msg}`);
  }
  return data as T;
}

/** Poll a long-running Operation until done. */
export async function waitOperation<T = any>(
  operationId: string,
  timeoutMs = 180_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const op = await ycApi<{
      done?: boolean;
      error?: { message?: string };
      response?: T;
      metadata?: any;
    }>("GET", `https://operation.api.cloud.yandex.net/operations/${operationId}`);
    if (op.done) {
      if (op.error) throw new Error(op.error.message || "Yandex operation failed");
      return (op.response || {}) as T;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Yandex operation ${operationId} timed out`);
}
