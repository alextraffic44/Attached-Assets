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

export async function deployToVercel(
  projectName: string,
  files: DeployFile[]
): Promise<{ url: string; deploymentId: string }> {
  if (!VERCEL_TOKEN) throw new Error("VERCEL_TOKEN не настроен");

  const safeName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 50);

  const payload = {
    name: safeName,
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
    throw new Error(data?.error?.message || `Vercel API error: ${res.status}`);
  }

  const rawUrl: string = data.url || data.alias?.[0] || "";
  const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

  return { url, deploymentId: data.id };
}

export async function addCustomDomain(
  vercelProjectId: string,
  domain: string
): Promise<{ verified: boolean; cname: string }> {
  if (!VERCEL_TOKEN) throw new Error("VERCEL_TOKEN не настроен");

  const res = await fetch(
    `${VERCEL_API}/v9/projects/${vercelProjectId}/domains`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: domain }),
    }
  );

  const data = await res.json() as any;
  if (!res.ok) throw new Error(data?.error?.message || `Domain error: ${res.status}`);

  return {
    verified: data.verified ?? false,
    cname: "cname.vercel-dns.com",
  };
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
