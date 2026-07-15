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

const YC_KEY_ID = process.env.YC_KEY_ID;
const YC_SECRET = process.env.YC_SECRET;

// IP of our Caddy reverse-proxy VPS (Timeweb) that terminates TLS for client
// custom domains via Let's Encrypt on-demand certificates. The client points
// an A record at this IP; Caddy proxies to the domain-named Object Storage
// bucket ({domain}.website.yandexcloud.net).
export function getDomainProxyIp(): string {
  return process.env.DOMAIN_PROXY_IP || "";
}

// ═══ Object Storage (S3-compatible) ═══

let s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (s3Client) return s3Client;
  if (!YC_KEY_ID || !YC_SECRET) throw new Error("YC_KEY_ID / YC_SECRET не настроены");
  s3Client = new S3Client({
    region: "ru-central1",
    endpoint: "https://storage.yandexcloud.net",
    credentials: { accessKeyId: YC_KEY_ID, secretAccessKey: YC_SECRET },
  });
  return s3Client;
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

async function ensureBucketReady(bucket: string): Promise<void> {
  const client = getS3Client();
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (err: any) {
    if (err?.name !== "BucketAlreadyOwnedByYou" && err?.name !== "BucketAlreadyExists") {
      throw err;
    }
  }
  await client.send(
    new PutBucketWebsiteCommand({
      Bucket: bucket,
      WebsiteConfiguration: {
        IndexDocument: { Suffix: "index.html" },
        ErrorDocument: { Key: "index.html" },
      },
    })
  );
}

async function listAllKeys(bucket: string): Promise<string[]> {
  const client = getS3Client();
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const list = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken })
    );
    for (const obj of list.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

async function clearBucket(bucket: string): Promise<void> {
  const client = getS3Client();
  const keys = await listAllKeys(bucket);
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
    if (batch.length === 0) continue;
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch, Quiet: true } }));
  }
}

/**
 * Deploy files into a specific bucket. Existing objects are cleared first so
 * stale assets from a previous version never linger ("replace the whole
 * deploy" semantics).
 */
export async function deployFilesToBucket(bucket: string, files: DeployFile[]): Promise<void> {
  const client = getS3Client();
  await ensureBucketReady(bucket);
  try {
    await clearBucket(bucket);
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
      })
    );
  }
}

/**
 * Deploy files to the project's dedicated bucket, and — when a custom domain
 * is attached — mirror the same files into the domain-named bucket so the
 * Caddy proxy serves the fresh version immediately (no CDN cache to purge).
 */
export async function deployToYandex(
  projectId: number,
  files: DeployFile[],
  customDomain?: string | null
): Promise<{ url: string; deploymentId: string; yandexProjectId: string }> {
  const bucket = bucketNameFor(projectId);
  await deployFilesToBucket(bucket, files);

  if (customDomain) {
    const domainBucket = domainBucketFor(customDomain);
    try {
      await deployFilesToBucket(domainBucket, files);
    } catch (err) {
      console.warn(`[Yandex] Mirror deploy to domain bucket ${domainBucket} failed (non-fatal):`, err);
    }
  }

  return { url: siteUrlFor(projectId), deploymentId: `${bucket}-${Date.now()}`, yandexProjectId: bucket };
}

export async function unpublishFromYandex(projectId: number, customDomain?: string | null): Promise<void> {
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
    await deployToYandex(projectId, [{ filename: "index.html", content: suspendedPage }], customDomain);
  } catch (err) {
    console.error(`[Yandex] Failed to unpublish project ${projectId}:`, err);
  }
}

/**
 * Server-side copy of every object from one bucket to another (used when a
 * custom domain is attached to an already-published site — no regeneration).
 */
async function copyBucketContents(srcBucket: string, destBucket: string): Promise<void> {
  const client = getS3Client();
  const keys = await listAllKeys(srcBucket);
  for (const key of keys) {
    await client.send(
      new CopyObjectCommand({
        Bucket: destBucket,
        Key: key,
        CopySource: `/${srcBucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`,
        ACL: "public-read",
      })
    );
  }
}

/** Empties and deletes a bucket. NoSuchBucket is silently ignored. */
async function deleteBucketFully(bucket: string): Promise<void> {
  const client = getS3Client();
  try {
    await clearBucket(bucket);
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    console.log(`[Yandex] Bucket ${bucket} deleted`);
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
  domain: string
): Promise<{ verified: boolean; aRecordIp: string }> {
  const apex = domainBucketFor(domain);
  if (apex.length > 63) {
    throw new Error("Домен слишком длинный (максимум 63 символа)");
  }
  const proxyIp = getDomainProxyIp();
  if (!proxyIp) {
    throw new Error("Прокси-сервер доменов не настроен — обратитесь в поддержку");
  }

  const client = getS3Client();
  try {
    await client.send(new CreateBucketCommand({ Bucket: apex }));
  } catch (err: any) {
    if (err?.name === "BucketAlreadyOwnedByYou") {
      // fine — re-attaching the same domain
    } else if (err?.name === "BucketAlreadyExists") {
      throw new Error("Это доменное имя уже занято в облачном хранилище — обратитесь в поддержку");
    } else {
      throw err;
    }
  }
  await client.send(
    new PutBucketWebsiteCommand({
      Bucket: apex,
      WebsiteConfiguration: {
        IndexDocument: { Suffix: "index.html" },
        ErrorDocument: { Key: "index.html" },
      },
    })
  );

  try {
    await copyBucketContents(projectBucket, apex);
  } catch (err) {
    console.warn(`[Yandex] Copy ${projectBucket} → ${apex} failed (non-fatal, next publish will fill it):`, err);
  }

  return { verified: false, aRecordIp: proxyIp };
}

/** Detach a custom domain: deletes the domain-named bucket. */
export async function removeCustomDomain(domain: string): Promise<void> {
  await deleteBucketFully(domainBucketFor(domain));
}

/**
 * Checks whether the client's DNS A record points at our Caddy proxy and
 * whether HTTPS already works (the first HTTPS request triggers on-demand
 * certificate issuance, which can take ~5-15 seconds).
 */
export async function checkDomainStatus(
  domain: string
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

  // The first HTTPS request makes Caddy mint the certificate — allow up to 25s.
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const httpsRes = await fetch(`https://${apex}`, { method: "HEAD", signal: controller.signal, redirect: "follow" });
    clearTimeout(timeout);
    if (httpsRes.status < 500) return { verified: true, dnsReady: true };
    return { verified: false, dnsReady: true, message: "DNS готов, SSL-сертификат выпускается — проверьте через минуту" };
  } catch {
    return { verified: false, dnsReady: true, message: "DNS готов, SSL-сертификат выпускается — проверьте через минуту" };
  }
}

/**
 * Fully removes a project from Yandex Cloud:
 * 1. Deletes the domain-named bucket if a custom domain was attached.
 * 2. Empties and deletes the project's dedicated bucket.
 *
 * Called when the user deletes a project from the dashboard.
 * All errors are caught and logged so the project can still be removed from the DB.
 */
export async function deleteProjectFromYandex(projectId: number, customDomain?: string | null): Promise<void> {
  if (customDomain) {
    await deleteBucketFully(domainBucketFor(customDomain));
  }
  await deleteBucketFully(bucketNameFor(projectId));
}
