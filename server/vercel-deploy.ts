const VERCEL_API = "https://api.vercel.com";
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;

function headers() {
  return {
    Authorization: `Bearer ${VERCEL_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export interface DeployFile {
  filename: string;
  content: string;
}

async function ensureProject(name: string): Promise<string> {
  // Check if project exists
  const getRes = await fetch(`${VERCEL_API}/v9/projects/${name}`, {
    headers: headers(),
  });

  if (getRes.ok) {
    const proj = await getRes.json() as any;
    return proj.id;
  }

  // Create project
  const createRes = await fetch(`${VERCEL_API}/v9/projects`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ name, framework: null }),
  });

  const proj = await createRes.json() as any;
  if (!createRes.ok) {
    throw new Error(proj?.error?.message || `Cannot create Vercel project: ${createRes.status}`);
  }
  return proj.id;
}

export async function deployToVercel(
  projectId: number,
  files: DeployFile[]
): Promise<{ url: string; deploymentId: string }> {
  if (!VERCEL_TOKEN) throw new Error("VERCEL_TOKEN не настроен");

  const projectName = `craft-ai-p${projectId}`;

  const vercelProjectId = await ensureProject(projectName);

  const payload = {
    name: projectName,
    projectId: vercelProjectId,
    files: files.map((f) => ({
      file: f.filename,
      data: Buffer.from(f.content).toString("base64"),
      encoding: "base64",
    })),
    projectSettings: { framework: null },
    target: "production",
  };

  const res = await fetch(`${VERCEL_API}/v13/deployments`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });

  const data = await res.json() as any;

  if (!res.ok) {
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

  const data = await res.json() as any;
  if (!res.ok) throw new Error(data?.error?.message || `Domain error: ${res.status}`);

  return { verified: data.verified ?? false, cname: "cname.vercel-dns.com" };
}

export async function checkDomainStatus(
  vercelProjectId: string,
  domain: string
): Promise<{ verified: boolean }> {
  if (!VERCEL_TOKEN) return { verified: false };

  const res = await fetch(
    `${VERCEL_API}/v9/projects/${vercelProjectId}/domains/${domain}`,
    { headers: headers() }
  );
  const data = await res.json() as any;
  return { verified: data.verified ?? false };
}
