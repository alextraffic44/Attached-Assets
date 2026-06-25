import crypto from "crypto";

const NETLIFY_API = "https://api.netlify.com/api/v1";
const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN;

function headers(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${NETLIFY_TOKEN}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export interface DeployFile {
  filename: string;
  content?: string;
  contentBuffer?: Buffer;
}

async function ensureSite(name: string): Promise<string> {
  // Try to find existing site by name
  const listRes = await fetch(`${NETLIFY_API}/sites?name=${encodeURIComponent(name)}&filter=all`, {
    headers: headers(),
  });

  if (listRes.ok) {
    const sites = (await listRes.json()) as any[];
    const existing = sites.find((s: any) => s.name === name);
    if (existing) return existing.id;
  }

  // Create a new site
  const createRes = await fetch(`${NETLIFY_API}/sites`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ name }),
  });

  const site = (await createRes.json()) as any;
  if (!createRes.ok) {
    throw new Error(site?.message || `Cannot create Netlify site: ${createRes.status}`);
  }
  return site.id;
}

function sha1(buf: Buffer): string {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

/**
 * Poll the Netlify API until the deployment reaches "ready" state (all CDN nodes
 * have the new files) or the timeout is hit. This prevents the race condition where
 * the publish endpoint returns before Netlify finishes propagating to all edges,
 * causing broken images / 404s on the first page load (especially on custom domains).
 */
async function waitForDeployReady(deployId: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let delay = 3000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, delay));
    try {
      const res = await fetch(`${NETLIFY_API}/deploys/${deployId}`, { headers: headers() });
      if (!res.ok) { delay = Math.min(delay * 1.5, 10000); continue; }
      const data = (await res.json()) as any;
      const state: string = data.state || "";
      console.log(`[Netlify] deploy ${deployId} state: ${state}`);
      if (state === "ready") return;
      if (state === "error") throw new Error(`Netlify deployment failed: ${data.error_message || "unknown error"}`);
    } catch (err: any) {
      if (err.message?.startsWith("Netlify deployment failed")) throw err;
    }
    delay = Math.min(delay * 1.3, 8000);
  }
  // Timeout — not fatal, site may still come up shortly
  console.warn(`[Netlify] deploy ${deployId} did not reach "ready" within ${timeoutMs / 1000}s — proceeding anyway`);
}

export async function deployToNetlify(
  projectId: number,
  files: DeployFile[]
): Promise<{ url: string; deploymentId: string; netlifyProjectId: string }> {
  if (!NETLIFY_TOKEN) throw new Error("NETLIFY_TOKEN не настроен");

  const siteName = `craft-ai-p${projectId}`;
  const siteId = await ensureSite(siteName);

  // Build file digest map { "/path": "sha1" }
  const fileMap: Record<string, string> = {};
  const buffers: Map<string, Buffer> = new Map();

  for (const f of files) {
    const buf = f.contentBuffer ?? Buffer.from(f.content ?? "", "utf8");
    const path = f.filename.startsWith("/") ? f.filename : `/${f.filename}`;
    const hash = sha1(buf);
    fileMap[path] = hash;
    buffers.set(path, buf);
  }

  // Create deploy with digest map
  const deployRes = await fetch(`${NETLIFY_API}/sites/${siteId}/deploys`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ files: fileMap }),
  });

  const deploy = (await deployRes.json()) as any;
  if (!deployRes.ok) {
    console.error("[Netlify deploy] Error:", JSON.stringify(deploy));
    throw new Error(deploy?.message || `Netlify deploy error: ${deployRes.status}`);
  }

  const deployId: string = deploy.id;
  const required: string[] = deploy.required || [];

  // Build a reverse map from sha1 → path
  const hashToPath: Map<string, string> = new Map();
  for (const [path, hash] of Object.entries(fileMap)) {
    hashToPath.set(hash, path);
  }

  // Upload only files Netlify doesn't have yet
  for (const hash of required) {
    const path = hashToPath.get(hash);
    if (!path) continue;
    const buf = buffers.get(path);
    if (!buf) continue;

    const uploadRes = await fetch(`${NETLIFY_API}/deploys/${deployId}/files${path}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${NETLIFY_TOKEN}`,
        "Content-Type": "application/octet-stream",
      },
      body: buf,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`File upload failed for ${path} (${uploadRes.status}): ${err}`);
    }
  }

  // Wait for Netlify to finish processing the deployment and make it live on ALL CDN
  // edges. Without this, the custom domain may serve stale/incomplete content for
  // 30-90 seconds while Netlify propagates — causing broken images on first load.
  await waitForDeployReady(deployId);

  const url = `https://${siteName}.netlify.app`;
  return { url, deploymentId: deployId, netlifyProjectId: siteId };
}

export async function addCustomDomain(
  netlifyProjectId: string,
  domain: string
): Promise<{ verified: boolean; cname: string; nameservers: string[] }> {
  if (!NETLIFY_TOKEN) throw new Error("NETLIFY_TOKEN не настроен");

  const apex = domain.replace(/^www\./, "");

  // 1. Set custom domain on the site
  const res = await fetch(`${NETLIFY_API}/sites/${netlifyProjectId}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ custom_domain: apex }),
  });

  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(data?.message || `Domain error: ${res.status}`);

  const siteName: string = data.name;

  // 2. Create (or fetch) Netlify DNS zone so users get managed nameservers
  //    instead of using raw A-record 75.2.60.5 (often blocked in Russia)
  let nameservers: string[] = [];
  try {
    // Try to create the zone
    const zoneRes = await fetch(`${NETLIFY_API}/dns_zones`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: apex, site_id: netlifyProjectId }),
    });
    const zoneData = (await zoneRes.json()) as any;
    if (zoneData?.dns_servers?.length) {
      nameservers = zoneData.dns_servers;
    } else if (zoneData?.errors || zoneData?.code === 422) {
      // Zone may already exist — fetch it
      const listRes = await fetch(`${NETLIFY_API}/dns_zones`, { headers: headers() });
      if (listRes.ok) {
        const zones = (await listRes.json()) as any[];
        const existing = zones.find((z: any) => z.name === apex);
        if (existing?.dns_servers?.length) nameservers = existing.dns_servers;
      }
    }
  } catch (e) {
    console.warn("[Netlify] DNS zone creation failed (non-critical):", e);
  }

  return { verified: false, cname: `${siteName}.netlify.app`, nameservers };
}

export async function unpublishFromNetlify(projectId: number): Promise<void> {
  if (!NETLIFY_TOKEN) return;

  const siteName = `craft-ai-p${projectId}`;
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
    await deployToNetlify(projectId, [
      { filename: "index.html", content: suspendedPage },
    ]);
  } catch (err) {
    console.error(`[Netlify] Failed to unpublish project ${projectId}:`, err);
  }
}

export async function checkDomainStatus(
  netlifyProjectId: string,
  domain: string
): Promise<{ verified: boolean; dnsReady: boolean; message?: string }> {
  const { promises: dns } = await import("dns");
  const NETLIFY_IP = "75.2.60.5";
  const apex = domain.replace(/^www\./, "");
  const www = `www.${apex}`;

  // Check if NS records point to Netlify (managed DNS via nsone.net)
  let nsOk = false;
  try {
    const nsRecords = await dns.resolveNs(apex);
    nsOk = nsRecords.some(ns => ns.toLowerCase().includes("nsone.net") || ns.toLowerCase().includes("netlify"));
    console.log("[Domain Check] NS", apex, ":", nsRecords, "netlify:", nsOk);
  } catch (e: any) {
    console.log("[Domain Check] NS lookup failed:", e.message);
  }

  // Check apex A-record (external DNS fallback)
  let apexOk = false;
  try {
    const addrs = await dns.resolve4(apex);
    apexOk = addrs.includes(NETLIFY_IP);
    console.log("[Domain Check] apex", apex, "A:", addrs, "netlify:", apexOk);
  } catch (e: any) {
    console.log("[Domain Check] apex lookup failed:", e.message);
  }

  // Check www CNAME (external DNS fallback)
  let wwwOk = false;
  try {
    const cnames = await dns.resolveCname(www);
    wwwOk = cnames.some(c => c.toLowerCase().includes("netlify"));
    console.log("[Domain Check] www", www, "CNAME:", cnames, "netlify:", wwwOk);
  } catch (e: any) {
    console.log("[Domain Check] www lookup failed:", e.message);
  }

  const dnsReady = nsOk || apexOk || wwwOk;

  if (!dnsReady) {
    return { verified: false, dnsReady: false, message: "DNS ещё не обновился — попробуйте через 30-60 минут" };
  }

  // DNS points to Netlify — now check if SSL/site is reachable
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://${apex}`, { method: "HEAD", signal: controller.signal, redirect: "follow" });
    clearTimeout(timeout);
    const server = res.headers.get("server") || "";
    const siteOk = server.toLowerCase().includes("netlify") && res.status < 500;
    console.log("[Domain Check] https check status:", res.status, "server:", server);
    if (siteOk) return { verified: true, dnsReady: true };
    return { verified: false, dnsReady: true, message: "DNS обновлён, SSL-сертификат выдаётся (1-15 минут)" };
  } catch {
    return { verified: false, dnsReady: true, message: "DNS обновлён, SSL-сертификат выдаётся (1-15 минут)" };
  }
}
