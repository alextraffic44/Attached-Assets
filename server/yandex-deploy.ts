import crypto from "crypto";
import {
  S3Client,
  CreateBucketCommand,
  PutBucketWebsiteCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const YC_FOLDER_ID = process.env.YC_FOLDER_ID;
const YC_KEY_ID = process.env.YC_KEY_ID;
const YC_SECRET = process.env.YC_SECRET;

const IAM_URL = "https://iam.api.cloud.yandex.net/iam/v1/tokens";
const CDN_API = "https://cdn.api.cloud.yandex.net/cdn/v1";
const CM_API = "https://certificate-manager.api.cloud.yandex.net/certificate-manager/v1";
const DNS_API = "https://dns.api.cloud.yandex.net/dns/v1";

export const YANDEX_NAMESERVERS = ["ns1.yandexcloud.net", "ns2.yandexcloud.net"];

// ═══ IAM token (cached, refreshed before the 12h expiry) ═══

let serviceAccountKey: { id: string; service_account_id: string; private_key: string } | null = null;
function getServiceAccountKey() {
  if (serviceAccountKey) return serviceAccountKey;
  const raw = process.env.YC_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("YC_SERVICE_ACCOUNT_KEY не настроен");
  serviceAccountKey = JSON.parse(raw);
  return serviceAccountKey!;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cachedIamToken: { token: string; expiresAt: number } | null = null;

async function getIamToken(): Promise<string> {
  if (cachedIamToken && cachedIamToken.expiresAt > Date.now()) return cachedIamToken.token;

  const key = getServiceAccountKey();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "PS256", typ: "JWT", kid: key.id };
  const payload = { iss: key.service_account_id, aud: IAM_URL, iat: now, exp: now + 3600 };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign({
    key: key.private_key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  });
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch(IAM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jwt }),
  });
  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok || !data?.iamToken) {
    throw new Error(`Yandex IAM token exchange failed: ${res.status} ${JSON.stringify(data)}`);
  }
  cachedIamToken = { token: data.iamToken, expiresAt: Date.now() + 11 * 60 * 60 * 1000 };
  return data.iamToken;
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

// Each project gets its own dedicated bucket. This keeps Object Storage → CDN origin
// wiring simple (one bucket root = one site) and avoids needing origin-path rewriting,
// which the Yandex CDN origin-group API does not support.
export function bucketNameFor(projectId: number): string {
  return `craft-ai-p${projectId}`;
}

export function siteUrlFor(projectId: number): string {
  return `https://${bucketNameFor(projectId)}.website.yandexcloud.net/`;
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

/**
 * Deploy files to the project's dedicated bucket. Existing objects are cleared first
 * so stale assets from a previous version never linger (mirrors Netlify's
 * "replace the whole deploy" semantics).
 */
export async function deployToYandex(
  projectId: number,
  files: DeployFile[]
): Promise<{ url: string; deploymentId: string; yandexProjectId: string }> {
  const client = getS3Client();
  const bucket = bucketNameFor(projectId);

  await ensureBucketReady(bucket);

  try {
    let continuationToken: string | undefined;
    const keysToDelete: { Key: string }[] = [];
    do {
      const list = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken })
      );
      for (const obj of list.Contents || []) {
        if (obj.Key) keysToDelete.push({ Key: obj.Key });
      }
      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);

    for (let i = 0; i < keysToDelete.length; i += 1000) {
      const batch = keysToDelete.slice(i, i + 1000);
      if (batch.length === 0) continue;
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch } }));
    }
  } catch (err) {
    console.warn(`[Yandex] Failed to clear old objects for project ${projectId} (non-fatal):`, err);
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

  return { url: siteUrlFor(projectId), deploymentId: `${bucket}-${Date.now()}`, yandexProjectId: bucket };
}

export async function unpublishFromYandex(projectId: number): Promise<void> {
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
    await deployToYandex(projectId, [{ filename: "index.html", content: suspendedPage }]);
  } catch (err) {
    console.error(`[Yandex] Failed to unpublish project ${projectId}:`, err);
  }
}

// ═══ Custom domains (CDN + Certificate Manager + Cloud DNS) ═══

async function cdnRequest(path: string, init: RequestInit = {}): Promise<any> {
  const token = await getIamToken();
  const res = await fetch(`${CDN_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Yandex CDN API error (${res.status}): ${JSON.stringify(data)}`);
  }
  if (data?.error) {
    throw new Error(`Yandex CDN error: ${data.error.message || JSON.stringify(data.error)}`);
  }
  return data;
}

async function dnsRequest(path: string, init: RequestInit = {}): Promise<any> {
  const token = await getIamToken();
  const res = await fetch(`${DNS_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Yandex DNS API error (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

function dnsZoneNameFor(domain: string): string {
  return `craft-ai-${domain.replace(/[^a-z0-9]/gi, "-")}`.slice(0, 60).toLowerCase();
}

/** Find an existing Yandex Cloud DNS zone for the domain, returns zone id or null. */
async function findDnsZone(domain: string): Promise<string | null> {
  try {
    const apex = domain.replace(/^www\./, "");
    const name = dnsZoneNameFor(apex);
    const list = await dnsRequest(`/zones?folderId=${YC_FOLDER_ID}&pageSize=1000`);
    const found = (list.dnsZones || []).find((z: any) => z.name === name);
    return found?.id || null;
  } catch {
    return null;
  }
}

/** Create (or reuse) a public DNS zone in Yandex Cloud DNS for the domain, returns zone id. */
async function ensureDnsZone(domain: string): Promise<string> {
  const apex = domain.replace(/^www\./, "");
  const name = dnsZoneNameFor(apex);

  // Reuse if already exists
  const existing = await findDnsZone(apex);
  if (existing) return existing;

  // Create new public zone
  const op = await dnsRequest(`/zones`, {
    method: "POST",
    body: JSON.stringify({
      folderId: YC_FOLDER_ID,
      name,
      zone: `${apex}.`,   // trailing dot required by DNS standard
      publicVisibility: {},
    }),
  });

  // The API returns an Operation; zone id is in metadata or response
  const zoneId: string | undefined =
    op?.metadata?.dnsZoneId ||
    op?.response?.id ||
    op?.id;

  if (!zoneId) {
    // Wait briefly and re-list as last resort
    await new Promise((r) => setTimeout(r, 1500));
    const list = await dnsRequest(`/zones?folderId=${YC_FOLDER_ID}&pageSize=1000`);
    const found = (list.dnsZones || []).find((z: any) => z.name === name);
    if (found?.id) return found.id;
    throw new Error(`Yandex DNS: failed to create zone for ${apex}`);
  }

  // Brief settle time before adding records
  await new Promise((r) => setTimeout(r, 800));
  return zoneId;
}

/** Upsert (add or replace) resource record sets in a DNS zone. */
async function upsertDnsRecords(
  zoneId: string,
  records: Array<{ name: string; type: string; ttl: number; data: string[] }>
): Promise<void> {
  await dnsRequest(`/zones/${zoneId}:upsertRecordSets`, {
    method: "POST",
    body: JSON.stringify({ merges: records }),
  });
}

async function ensureOriginGroup(domain: string): Promise<string> {
  // Route CDN through our Express app (craft-ai.ru) which proxies to the bucket.
  // This is the only reliable way: Yandex CDN internally routes all *.yandexcloud.net
  // origins through S3 API (which serves 403 for root "/"), bypassing the website endpoint.
  // Our proxy middleware reads X-Custom-Domain to serve the right bucket via S3 API path.
  const EXPRESS_ORIGIN = "craft-ai.ru";
  const name = `${domain}-express-proxy`;
  const list = await cdnRequest(`/originGroups?folderId=${YC_FOLDER_ID}`);
  const existing = (list.originGroups || []).find((g: any) => g.name === name);
  if (existing) return existing.id;

  const created = await cdnRequest(`/originGroups`, {
    method: "POST",
    body: JSON.stringify({
      folderId: YC_FOLDER_ID,
      name,
      useNext: false,
      origins: [{ source: EXPRESS_ORIGIN, enabled: true }],
    }),
  });
  const originGroupId = created?.response?.id;
  if (!originGroupId) throw new Error("Yandex CDN: не удалось создать origin group");
  return originGroupId;
}

async function findCdnResourceByCname(domain: string): Promise<any | null> {
  const list = await cdnRequest(`/resources?folderId=${YC_FOLDER_ID}`);
  return (list.resources || []).find((r: any) => r.cname === domain) || null;
}

/**
 * Removes the CDN resource (and its origin group), SSL certificate, and
 * Yandex Cloud DNS zone for a domain so a new domain can be attached cleanly.
 */
export async function removeCustomDomain(domain: string): Promise<void> {
  const apex = domain.replace(/^www\./, "");
  try {
    const resource = await findCdnResourceByCname(apex);
    if (resource?.id) {
      await cdnRequest(`/resources/${resource.id}`, { method: "DELETE" });
      if (resource.originGroupId) {
        await cdnRequest(`/originGroups/${resource.originGroupId}?folderId=${YC_FOLDER_ID}`, { method: "DELETE" }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn("[Yandex] removeCustomDomain CDN non-fatal:", err);
  }
  try {
    const cert = await findCertificateByDomain(apex);
    if (cert?.id) {
      const token = await getIamToken();
      await fetch(`${CM_API}/certificates/${cert.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  } catch (err) {
    console.warn("[Yandex] removeCustomDomain cert cleanup non-fatal:", err);
  }
  // Also remove the auto-created DNS zone
  try {
    const zoneId = await findDnsZone(apex);
    if (zoneId) {
      await dnsRequest(`/zones/${zoneId}`, { method: "DELETE" });
      console.log(`[Yandex DNS] Zone deleted for ${apex}`);
    }
  } catch (err) {
    console.warn("[Yandex] removeCustomDomain DNS zone cleanup non-fatal:", err);
  }
}

/**
 * Attach a custom domain to a project by creating (or reusing) a dedicated CDN
 * resource whose origin is the project's Object Storage bucket.
 *
 * New flow: automatically creates a Yandex Cloud DNS public zone for the apex
 * domain, adds an ANAME record pointing to the CDN provider CNAME, and adds the
 * Let's Encrypt TXT challenge record — so the user only needs to change NS
 * servers at their registrar to ns1/ns2.yandexcloud.net.
 */
export async function addCustomDomain(
  yandexProjectId: string,
  domain: string
): Promise<{ verified: boolean; cname: string; nameservers: string[]; txtRecord?: { name: string; value: string } }> {
  const bucket = yandexProjectId;
  const apex = domain.replace(/^www\./, "");

  const originGroupId = await ensureOriginGroup(apex);

  let resource = await findCdnResourceByCname(apex);
  if (!resource) {
    const created = await cdnRequest(`/resources`, {
      method: "POST",
      body: JSON.stringify({
        folderId: YC_FOLDER_ID,
        cname: apex,
        origin: { originGroupId },
        // HTTPS: craft-ai.ru origin (our Express proxy) has a valid TLS cert
        originProtocol: "HTTPS",
        active: true,
      }),
    });
    resource = created?.response;
    if (!resource) throw new Error("Yandex CDN: не удалось создать ресурс для домена");

    // Patch: 
    // - customServerName: craft-ai.ru (TLS SNI + Host for HTTPS connection to our server)
    // - staticRequestHeaders: X-Custom-Domain → domain (tells our proxy which bucket to serve)
    // - edgeCacheSettings: cache responses for 1 hour
    try {
      await cdnRequest(`/resources/${resource.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          options: {
            customServerName: { enabled: true, value: "craft-ai.ru" },
            staticRequestHeaders: { enabled: true, value: { "X-Custom-Domain": apex } },
            edgeCacheSettings: { enabled: true, defaultValue: "3600" },
          },
        }),
      });
      console.log(`[Yandex CDN] Express proxy configured for domain ${apex}`);
    } catch (err) {
      console.warn("[Yandex CDN] Failed to configure proxy options (non-fatal):", err);
    }
  }

  const providerCname = resource.providerCname || resource.cname;

  // Request the SSL certificate — get the TXT challenge value before we write the zone
  let txtRecord: { name: string; value: string } | undefined;
  try {
    txtRecord = await requestManagedCertificate(apex);
  } catch (err) {
    console.warn("[Yandex] Certificate request failed (non-fatal, retry later):", err);
  }

  // Auto-create DNS zone + write ANAME + TXT so the user only needs to change NS servers
  try {
    const zoneId = await ensureDnsZone(apex);
    const records: Array<{ name: string; type: string; ttl: number; data: string[] }> = [
      // ANAME on the root — Yandex DNS flattens this to an A record for clients
      { name: `${apex}.`, type: "ANAME", ttl: 600, data: [`${providerCname}.`] },
    ];
    // www CNAME so www.domain also works
    records.push({ name: `www.${apex}.`, type: "CNAME", ttl: 600, data: [`${apex}.`] });

    if (txtRecord) {
      const txtName = txtRecord.name.endsWith(".") ? txtRecord.name : `${txtRecord.name}.`;
      records.push({ name: txtName, type: "TXT", ttl: 300, data: [txtRecord.value] });
    }

    await upsertDnsRecords(zoneId, records);
    console.log(`[Yandex DNS] Zone + ANAME + TXT auto-configured for ${apex}`);
  } catch (err) {
    // Non-fatal: user can still use old manual CNAME approach
    console.warn("[Yandex DNS] Auto-zone setup failed (non-fatal):", err);
  }

  return {
    verified: false,
    cname: providerCname,
    nameservers: YANDEX_NAMESERVERS,
    // txtRecord intentionally omitted — added to DNS zone automatically above
  };
}

function certNameFor(domain: string): string {
  return `craft-ai-${domain.replace(/[^a-zA-Z0-9]/g, "-")}`.slice(0, 50);
}

async function findCertificateByDomain(domain: string): Promise<any | null> {
  const token = await getIamToken();
  const res = await fetch(`${CM_API}/certificates?folderId=${YC_FOLDER_ID}&pageSize=1000`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return null;
  return (data?.certificates || []).find((c: any) => c.name === certNameFor(domain)) || null;
}

async function getCertificateFull(certId: string): Promise<any | null> {
  const token = await getIamToken();
  const res = await fetch(`${CM_API}/certificates/${certId}?view=FULL`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return null;
  return data;
}

/**
 * Ensures a managed Let's Encrypt certificate exists for the domain (reuses an
 * existing one if already requested) and returns the DNS TXT challenge record
 * the user needs to add, if the certificate isn't already issued.
 */
async function requestManagedCertificate(domain: string): Promise<{ name: string; value: string } | undefined> {
  const token = await getIamToken();

  let cert = await findCertificateByDomain(domain);
  if (!cert) {
    const res = await fetch(`${CM_API}/certificates/requestNew`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        folderId: YC_FOLDER_ID,
        name: certNameFor(domain),
        domains: [domain],
        challengeType: "DNS",
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`Certificate Manager error: ${res.status} ${JSON.stringify(data)}`);
    }
    cert = data;
  }

  const certId = cert?.id;
  if (!certId) return undefined;

  const full = await getCertificateFull(certId);
  const challenge = full?.challenges?.find((c: any) => c.dnsChallenge)?.dnsChallenge;
  if (challenge?.name && challenge?.value) {
    return { name: challenge.name, value: `${challenge.value}` };
  }
  return undefined;
}

/**
 * Attaches an issued Certificate Manager certificate to a CDN resource so
 * HTTPS works for the custom domain. No-op if the resource already has this
 * certificate attached.
 */
async function attachCertificateToResource(resourceId: string, certId: string): Promise<void> {
  await cdnRequest(`/resources/${resourceId}?updateMask=sslCertificate`, {
    method: "PATCH",
    body: JSON.stringify({
      sslCertificate: { type: "CM", data: { cm: { id: certId } } },
    }),
  });
}

export async function checkDomainStatus(
  yandexProjectId: string,
  domain: string
): Promise<{ verified: boolean; dnsReady: boolean; message?: string }> {
  const { promises: dns } = await import("dns");
  const apex = domain.replace(/^www\./, "");

  let resource: any = null;
  try {
    resource = await findCdnResourceByCname(apex);
  } catch (err) {
    console.warn("[Yandex] Failed to look up CDN resource for domain status:", err);
  }
  if (!resource) return { verified: false, dnsReady: false, message: "Домен ещё не привязан" };

  const targetCname: string = resource.providerCname;

  // Primary: check NS records → user changed nameservers to Yandex Cloud DNS
  let nsOk = false;
  try {
    const nsRecords = await dns.resolveNs(apex);
    nsOk = nsRecords.some((ns) => ns.toLowerCase().includes("yandexcloud.net"));
  } catch {}

  // Fallback: check CNAME record (old manual approach still works)
  let cnameOk = false;
  if (!nsOk) {
    try {
      const records = await dns.resolveCname(apex);
      cnameOk = records.some((r) => r.toLowerCase() === (targetCname || "").toLowerCase());
    } catch {}
    if (!cnameOk) {
      try {
        const wwwRecords = await dns.resolveCname(`www.${apex}`);
        cnameOk = wwwRecords.some((r) => r.toLowerCase() === (targetCname || "").toLowerCase());
      } catch {}
    }
  }

  if (!nsOk && !cnameOk) {
    return { verified: false, dnsReady: false, message: "DNS ещё не обновился — подождите 30-60 минут" };
  }

  // If using the NS approach and cert challenge hasn't been written yet (e.g. zone was
  // just created), try to refresh the TXT record in the zone now that NS has propagated.
  if (nsOk) {
    try {
      const zoneId = await findDnsZone(apex);
      if (zoneId) {
        const cert = await findCertificateByDomain(apex);
        if (cert?.id) {
          const full = await getCertificateFull(cert.id);
          const challenge = full?.challenges?.find((c: any) => c.dnsChallenge)?.dnsChallenge;
          if (challenge?.name && challenge?.value && cert.status !== "ISSUED") {
            const txtName = challenge.name.endsWith(".") ? challenge.name : `${challenge.name}.`;
            await upsertDnsRecords(zoneId, [
              { name: txtName, type: "TXT", ttl: 300, data: [challenge.value] },
            ]).catch(() => {});
          }
        }
      }
    } catch { /* non-fatal */ }
  }

  // DNS is pointed correctly. Make sure the managed certificate is issued and
  // attached to the CDN resource before declaring the domain fully verified.
  try {
    const cert = await findCertificateByDomain(apex);
    if (cert?.id) {
      const currentType = resource?.sslCertificate?.type;
      const currentCertId = resource?.sslCertificate?.data?.cm?.id;
      if (cert.status === "ISSUED" && !(currentType === "CM" && currentCertId === cert.id)) {
        await attachCertificateToResource(resource.id, cert.id);
      } else if (cert.status === "INVALID" || cert.status === "RENEWAL_FAILED") {
        return {
          verified: false,
          dnsReady: true,
          message: "Не удалось выпустить SSL-сертификат — проверьте TXT-запись и попробуйте снова",
        };
      } else if (cert.status !== "ISSUED") {
        return {
          verified: false,
          dnsReady: true,
          message: "DNS обновлён, SSL-сертификат выдаётся (может занять до 30 минут)",
        };
      }
    }
  } catch (err) {
    console.warn("[Yandex] Certificate status check failed (non-fatal):", err);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const httpsRes = await fetch(`https://${apex}`, { method: "HEAD", signal: controller.signal, redirect: "follow" });
    clearTimeout(timeout);
    if (httpsRes.status < 500) return { verified: true, dnsReady: true };
    return { verified: false, dnsReady: true, message: "DNS обновлён, SSL-сертификат выдаётся (может занять до 30 минут)" };
  } catch {
    return { verified: false, dnsReady: true, message: "DNS обновлён, SSL-сертификат выдаётся (может занять до 30 минут)" };
  }
}
