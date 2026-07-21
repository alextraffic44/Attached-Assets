import {
  S3Client,
  CreateBucketCommand,
  PutBucketWebsiteCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
  DeleteBucketCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import {
  acquireStoragePool,
  bumpPoolBucketCount,
  getPoolS3Client,
  getStoragePoolById,
  resolvePoolForProject,
  type StoragePool,
} from "./yc-storage-pools";

// IP of our Caddy reverse-proxy VPS (Timeweb) that terminates TLS for client
// custom domains via Let's Encrypt on-demand certificates. The client points
// an A record at this IP; Caddy proxies to the domain-named Object Storage
// bucket ({domain}.website.yandexcloud.net).
export function getDomainProxyIp(): string {
  return process.env.DOMAIN_PROXY_IP || "";
}

export interface DeployFile {
  filename: string;
  content?: string;
  contentBuffer?: Buffer;
}

function contentTypeFor(filename: string): string {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    html: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    ogg: "video/ogg",
    glb: "model/gltf-binary",
    gltf: "model/gltf+json",
    woff: "font/woff",
    woff2: "font/woff2",
  };
  return map[ext] || "application/octet-stream";
}

// Each project gets its own dedicated bucket. This keeps Object Storage wiring
// simple: one bucket root = one site.
export function bucketNameFor(projectId: number): string {
  return `craft-ai-p${projectId}`;
}

export function siteUrlFor(projectId: number): string {
  return `https://${bucketNameFor(projectId)}.website.yandexcloud.net/`;
}

// Custom domains get a SECOND bucket named exactly after the apex domain
// (e.g. "moysite.ru"). The Yandex Object Storage website endpoint routes by
// Host ({bucket}.website.yandexcloud.net), which lets a single generic Caddy
// config proxy ANY client domain without per-domain configuration.
export function domainBucketFor(domain: string): string {
  return domain.replace(/^www\./, "").toLowerCase();
}

function isQuotaError(err: any): boolean {
  const s = `${err?.name || ""} ${err?.Code || ""} ${err?.message || ""}`.toLowerCase();
  return (
    s.includes("toomanybuckets") ||
    s.includes("too many buckets") ||
    s.includes("quota") ||
    s.includes("buckets.count") ||
    s.includes("limit exceeded")
  );
}

async function ensureBucketReady(
  client: S3Client,
  bucket: string,
): Promise<"created" | "owned" | "taken"> {
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    await client.send(
      new PutBucketWebsiteCommand({
        Bucket: bucket,
        WebsiteConfiguration: {
          IndexDocument: { Suffix: "index.html" },
          ErrorDocument: { Key: "index.html" },
        },
      }),
    );
    return "created";
  } catch (err: any) {
    const name = err?.name || err?.Code || "";
    if (name === "BucketAlreadyOwnedByYou") {
      await client.send(
        new PutBucketWebsiteCommand({
          Bucket: bucket,
          WebsiteConfiguration: {
            IndexDocument: { Suffix: "index.html" },
            ErrorDocument: { Key: "index.html" },
          },
        }),
      );
      return "owned";
    }
    if (name === "BucketAlreadyExists") return "taken";
    throw err;
  }
}

async function listAllKeys(client: S3Client, bucket: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const list = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
    );
    for (const obj of list.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

async function clearBucket(client: S3Client, bucket: string): Promise<void> {
  const keys = await listAllKeys(client, bucket);
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
    if (batch.length === 0) continue;
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch, Quiet: true } }));
  }
}

/**
 * Deploy files into a specific bucket on a given storage pool.
 */
export async function deployFilesToBucket(
  bucket: string,
  files: DeployFile[],
  pool: StoragePool,
): Promise<void> {
  const client = getPoolS3Client(pool);
  const created = await ensureBucketReady(client, bucket);
  if (created === "created") {
    await bumpPoolBucketCount(pool.id, 1);
  }
  if (created === "taken") {
    throw new Error(`Бакет ${bucket} уже занят в Object Storage`);
  }
  try {
    await clearBucket(client, bucket);
  } catch (err) {
    console.warn(`[Yandex] Failed to clear old objects in ${bucket} (non-fatal):`, err);
  }
  for (const f of files) {
    const buf = f.contentBuffer ?? Buffer.from(f.content ?? "", "utf8");
    const key = f.filename.replace(/^\/+/, "");
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buf,
        ContentType: contentTypeFor(key),
        ACL: "public-read",
      }),
    );
  }
}

async function deployFilesWithPoolFailover(
  bucket: string,
  files: DeployFile[],
  preferred: StoragePool,
  slotsHint = 1,
): Promise<StoragePool> {
  try {
    await deployFilesToBucket(bucket, files, preferred);
    return preferred;
  } catch (err: any) {
    if (!isQuotaError(err)) throw err;
    console.warn(`[Yandex] pool #${preferred.id} quota hit for ${bucket}, acquiring new cloud…`);
    const next = await acquireStoragePool(slotsHint);
    if (next.id === preferred.id) throw err;
    await deployFilesToBucket(bucket, files, next);
    return next;
  }
}

/**
 * Deploy files to the project's dedicated bucket, and — when a custom domain
 * is attached — mirror the same files into the domain-named bucket so the
 * Caddy proxy serves the fresh version immediately.
 */
export async function deployToYandex(
  projectId: number,
  files: DeployFile[],
  customDomain?: string | null,
  existingPoolId?: number | null,
): Promise<{ url: string; deploymentId: string; yandexProjectId: string; ycStoragePoolId: number }> {
  const slots = customDomain ? 2 : 1;
  let pool = await resolvePoolForProject({ ycStoragePoolId: existingPoolId });
  // If republishing into an existing pool that is full, still try that pool first
  // (bucket likely already exists). Only allocate a new pool when creating fresh.
  if (!existingPoolId) {
    pool = await acquireStoragePool(slots);
  }

  const bucket = bucketNameFor(projectId);
  pool = await deployFilesWithPoolFailover(bucket, files, pool, slots);

  if (customDomain) {
    const domainBucket = domainBucketFor(customDomain);
    try {
      await deployFilesToBucket(domainBucket, files, pool);
    } catch (err) {
      console.warn(`[Yandex] Mirror deploy to domain bucket ${domainBucket} failed (non-fatal):`, err);
    }
  }

  return {
    url: siteUrlFor(projectId),
    deploymentId: `${bucket}-${Date.now()}`,
    yandexProjectId: bucket,
    ycStoragePoolId: pool.id,
  };
}

export async function unpublishFromYandex(
  projectId: number,
  customDomain?: string | null,
  existingPoolId?: number | null,
): Promise<void> {
  const suspendedPage = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Сайт приостановлен</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif;color:#fff}
.c{text-align:center;padding:2rem;max-width:480px}
.icon{font-size:3rem;margin-bottom:1.5rem;opacity:0.4}
h1{font-size:1.5rem;font-weight:600;margin-bottom:0.75rem;letter-spacing:-0.02em}
p{font-size:0.95rem;color:rgba(255,255,255,0.5);line-height:1.6}
a{color:#3b82f6;text-decoration:none}
</style>
</head>
<body>
<div class="c">
<div class="icon">⏸</div>
<h1>Сайт временно приостановлен</h1>
<p>Владелец сайта приостановил публикацию. Для возобновления работы необходимо пополнить баланс в <a href="https://craft-ai.ru">Craft AI</a>.</p>
</div>
</body>
</html>`;

  try {
    await deployToYandex(
      projectId,
      [{ filename: "index.html", content: suspendedPage }],
      customDomain,
      existingPoolId,
    );
  } catch (err) {
    console.error(`[Yandex] Failed to unpublish project ${projectId}:`, err);
  }
}

async function copyBucketContents(client: S3Client, srcBucket: string, destBucket: string): Promise<void> {
  const keys = await listAllKeys(client, srcBucket);
  for (const key of keys) {
    await client.send(
      new CopyObjectCommand({
        Bucket: destBucket,
        Key: key,
        CopySource: `/${srcBucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`,
        ACL: "public-read",
      }),
    );
  }
}

/** Empties and deletes a bucket. NoSuchBucket is silently ignored. */
async function deleteBucketFully(client: S3Client, bucket: string, poolId?: number): Promise<void> {
  try {
    await clearBucket(client, bucket);
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    console.log(`[Yandex] Bucket ${bucket} deleted`);
    if (poolId) await bumpPoolBucketCount(poolId, -1);
  } catch (err: any) {
    if (err?.Code !== "NoSuchBucket" && err?.name !== "NoSuchBucket") {
      console.warn(`[Yandex] Bucket cleanup non-fatal for ${bucket}:`, err?.message || err);
    }
  }
}

/**
 * Attach a custom domain: creates a bucket named exactly after the apex domain
 * and mirrors the project's published files into it. TLS + traffic are handled
 * by our Caddy proxy VPS — the user only needs to point an A record at it.
 */
export async function addCustomDomain(
  projectBucket: string,
  domain: string,
  existingPoolId?: number | null,
): Promise<{ verified: boolean; aRecordIp: string; ycStoragePoolId: number }> {
  const apex = domainBucketFor(domain);
  if (apex.length > 63) {
    throw new Error("Домен слишком длинный (максимум 63 символа)");
  }
  const proxyIp = getDomainProxyIp();
  if (!proxyIp) {
    throw new Error("Прокси-сервер доменов не настроен — обратитесь в поддержку");
  }

  let pool = await resolvePoolForProject({ ycStoragePoolId: existingPoolId });
  // Domain bucket needs a free slot — if current pool is full, open a new cloud.
  if (pool.bucketCount + 1 > pool.bucketLimit) {
    pool = await acquireStoragePool(1);
  }

  const client = getPoolS3Client(pool);
  try {
    const created = await ensureBucketReady(client, apex);
    if (created === "taken") {
      throw new Error("Это доменное имя уже занято в облачном хранилище — обратитесь в поддержку");
    }
    if (created === "created") await bumpPoolBucketCount(pool.id, 1);
  } catch (err: any) {
    if (isQuotaError(err)) {
      pool = await acquireStoragePool(1);
      const created = await ensureBucketReady(getPoolS3Client(pool), apex);
      if (created === "taken") {
        throw new Error("Это доменное имя уже занято в облачном хранилище — обратитесь в поддержку");
      }
      if (created === "created") await bumpPoolBucketCount(pool.id, 1);
    } else {
      throw err;
    }
  }

  try {
    await copyBucketContents(getPoolS3Client(pool), projectBucket, apex);
  } catch (err) {
    console.warn(`[Yandex] Copy ${projectBucket} → ${apex} failed (non-fatal, next publish will fill it):`, err);
  }

  return { verified: false, aRecordIp: proxyIp, ycStoragePoolId: pool.id };
}

/** Detach a custom domain: deletes the domain-named bucket. */
export async function removeCustomDomain(
  domain: string,
  existingPoolId?: number | null,
): Promise<void> {
  const pool = await resolvePoolForProject({ ycStoragePoolId: existingPoolId });
  await deleteBucketFully(getPoolS3Client(pool), domainBucketFor(domain), pool.id);
}

/**
 * Checks whether the client's DNS A record points at our Caddy proxy and
 * whether HTTPS already works (the first HTTPS request triggers on-demand
 * certificate issuance, which can take ~5-15 seconds).
 */
export async function checkDomainStatus(
  domain: string,
): Promise<{ verified: boolean; dnsReady: boolean; message?: string }> {
  const { promises: dns } = await import("dns");
  const apex = domainBucketFor(domain);
  const proxyIp = getDomainProxyIp();
  if (!proxyIp) {
    return { verified: false, dnsReady: false, message: "Прокси-сервер доменов не настроен" };
  }

  let ips: string[] = [];
  try {
    ips = await dns.resolve4(apex);
  } catch {}
  const dnsReady = ips.includes(proxyIp);
  if (!dnsReady) {
    return {
      verified: false,
      dnsReady: false,
      message: `A-запись ещё не обновилась — домен должен указывать на ${proxyIp} (обычно до 30 минут)`,
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const httpsRes = await fetch(`https://${apex}`, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (httpsRes.status < 500) return { verified: true, dnsReady: true };
    return {
      verified: false,
      dnsReady: true,
      message: "DNS готов, SSL-сертификат выпускается — проверьте через минуту",
    };
  } catch {
    return {
      verified: false,
      dnsReady: true,
      message: "DNS готов, SSL-сертификат выпускается — проверьте через минуту",
    };
  }
}

/**
 * Fully removes a project from Yandex Cloud:
 * 1. Deletes the domain-named bucket if a custom domain was attached.
 * 2. Empties and deletes the project's dedicated bucket.
 */
export async function deleteProjectFromYandex(
  projectId: number,
  customDomain?: string | null,
  existingPoolId?: number | null,
): Promise<void> {
  const pool =
    (existingPoolId ? await getStoragePoolById(existingPoolId) : null) ||
    (await resolvePoolForProject({ ycStoragePoolId: existingPoolId }));
  const client = getPoolS3Client(pool);
  if (customDomain) {
    await deleteBucketFully(client, domainBucketFor(customDomain), pool.id);
  }
  await deleteBucketFully(client, bucketNameFor(projectId), pool.id);
}
