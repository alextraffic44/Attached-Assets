import crypto from "crypto";

const VERCEL_API = "https://api.vercel.com";
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;

function headers(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${VERCEL_TOKEN}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export interface DeployFile {
  filename: string;
  content: string;
}

async function disableProtection(name: string): Promise<void> {
  try {
    await fetch(`${VERCEL_API}/v9/projects/${name}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ ssoProtection: null, passwordProtection: null }),
    });
  } catch {
    // non-critical, ignore
  }
}

async function ensureProject(name: string): Promise<string> {
  const getRes = await fetch(`${VERCEL_API}/v9/projects/${name}`, {
    headers: headers(),
  });

  if (getRes.ok) {
    const proj = (await getRes.json()) as any;
    await disableProtection(name);
    return proj.id;
  }

  const createRes = await fetch(`${VERCEL_API}/v9/projects`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ name, framework: null }),
  });

  const proj = (await createRes.json()) as any;
  if (!createRes.ok) {
    throw new Error(
      proj?.error?.message || `Cannot create Vercel project: ${createRes.status}`
    );
  }
  await disableProtection(name);
  return proj.id;
}

// Upload a single file to Vercel file store, return its sha1
async function uploadFile(content: string): Promise<string> {
  const buf = Buffer.from(content, "utf8");
  const sha1 = crypto.createHash("sha1").update(buf).digest("hex");

  const res = await fetch(`${VERCEL_API}/v2/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      "Content-Type": "application/octet-stream",
      "x-vercel-digest": sha1,
      "Content-Length": String(buf.length),
    },
    body: buf,
  });

  // 200 = uploaded, 409 = already exists — both are fine
  if (res.status !== 200 && res.status !== 409) {
    const err = await res.text();
    throw new Error(`File upload failed (${res.status}): ${err}`);
  }

  return sha1;
}

export async function deployToVercel(
  projectId: number,
  files: DeployFile[]
): Promise<{ url: string; deploymentId: string; vercelProjectId: string }> {
  if (!VERCEL_TOKEN) throw new Error("VERCEL_TOKEN не настроен");

  const projectName = `craft-ai-p${projectId}`;
  const vercelProjectId = await ensureProject(projectName);

  // Upload all files first, collect sha1 hashes
  const deployFiles: { file: string; sha: string; size: number }[] = [];
  for (const f of files) {
    const buf = Buffer.from(f.content, "utf8");
    const sha = await uploadFile(f.content);
    deployFiles.push({ file: f.filename, sha, size: buf.length });
  }

  const payload = {
    name: projectName,
    files: deployFiles,
    projectSettings: { framework: null },
    target: "production",
  };

  const res = await fetch(`${VERCEL_API}/v13/deployments`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as any;

  if (!res.ok) {
    console.error("[Vercel deploy] Full error:", JSON.stringify(data));
    throw new Error(data?.error?.message || `Vercel deploy error: ${res.status}`);
  }

  const rawUrl: string = data.url || data.alias?.[0] || "";
  const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

  return { url, deploymentId: data.id, vercelProjectId };
}

export async function addCustomDomain(
  vercelProjectId: string,
  domain: string
): Promise<{ verified: boolean; cname: string }> {
  if (!VERCEL_TOKEN) throw new Error("VERCEL_TOKEN не настроен");

  const res = await fetch(`${VERCEL_API}/v9/projects/${vercelProjectId}/domains`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ name: domain }),
  });

  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(data?.error?.message || `Domain error: ${res.status}`);

  return { verified: data.verified ?? false, cname: "cname.vercel-dns.com" };
}

export async function unpublishFromVercel(projectId: number): Promise<void> {
  if (!VERCEL_TOKEN) return;

  const projectName = `craft-ai-p${projectId}`;
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
    const vercelProjectId = await ensureProject(projectName);
    const sha = await uploadFile(suspendedPage);
    const buf = Buffer.from(suspendedPage, "utf8");

    await fetch(`${VERCEL_API}/v13/deployments`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        name: projectName,
        files: [{ file: "index.html", sha, size: buf.length }],
        projectSettings: { framework: null },
        target: "production",
      }),
    });
  } catch (err) {
    console.error(`[Vercel] Failed to unpublish project ${projectId}:`, err);
  }
}

export async function checkDomainStatus(
  vercelProjectId: string,
  domain: string
): Promise<{ verified: boolean }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://${domain}`, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);
    const server = res.headers.get("server") || "";
    const via = res.headers.get("x-vercel-id") || res.headers.get("x-powered-by") || "";
    const isVercel = server.toLowerCase().includes("vercel") || via.length > 0 || res.ok;
    console.log("[Domain Check]", domain, "status:", res.status, "server:", server, "vercel:", isVercel);
    return { verified: isVercel && res.status < 500 };
  } catch (err: any) {
    console.log("[Domain Check]", domain, "failed:", err.message);
    return { verified: false };
  }
}
