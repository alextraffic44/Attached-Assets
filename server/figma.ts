import { storage } from "./storage";

const FIGMA_CLIENT_ID = process.env.FIGMA_CLIENT_ID || "";
const FIGMA_CLIENT_SECRET = process.env.FIGMA_CLIENT_SECRET || "";
const FIGMA_REDIRECT_URI = process.env.FIGMA_REDIRECT_URI || "https://craft-ai.ru/api/auth/figma/callback";

export function getFigmaAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: FIGMA_CLIENT_ID,
    redirect_uri: FIGMA_REDIRECT_URI,
    scope: "files:read",
    state,
    response_type: "code",
  });
  return `https://www.figma.com/oauth?${params.toString()}`;
}

export async function exchangeFigmaCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const res = await fetch("https://api.figma.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: FIGMA_CLIENT_ID,
      client_secret: FIGMA_CLIENT_SECRET,
      redirect_uri: FIGMA_REDIRECT_URI,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Figma token exchange failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function refreshFigmaToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const res = await fetch("https://api.figma.com/v1/oauth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: FIGMA_CLIENT_ID,
      client_secret: FIGMA_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Figma token refresh failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function getValidFigmaToken(userId: number): Promise<string | null> {
  const user = await storage.getUser(userId);
  if (!user?.figmaAccessToken || !user?.figmaRefreshToken) return null;

  if (user.figmaExpiresAt && new Date(user.figmaExpiresAt) > new Date(Date.now() + 60000)) {
    return user.figmaAccessToken;
  }

  try {
    const refreshed = await refreshFigmaToken(user.figmaRefreshToken);
    const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
    await storage.updateUserFigmaTokens(userId, refreshed.access_token, user.figmaRefreshToken, expiresAt);
    return refreshed.access_token;
  } catch {
    await storage.clearUserFigmaTokens(userId);
    return null;
  }
}

export function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/(file|design|proto)\/([a-zA-Z0-9]+)/);
    if (!match) return null;
    const fileKey = match[2];
    const nodeId = u.searchParams.get("node-id") || undefined;
    return { fileKey, nodeId };
  } catch {
    return null;
  }
}

export async function getFigmaFileNodes(token: string, fileKey: string, nodeId?: string) {
  const url = nodeId
    ? `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`
    : `https://api.figma.com/v1/files/${fileKey}`;
  const res = await fetch(url, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Figma API error: ${res.status} ${text}`);
  }
  return res.json();
}

export async function exportFigmaImage(token: string, fileKey: string, nodeId: string, scale: number = 2): Promise<string> {
  const res = await fetch(
    `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=${scale}`,
    { headers: { "Authorization": `Bearer ${token}` } }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Figma image export failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const imageUrl = data.images?.[nodeId];
  if (!imageUrl) throw new Error("No image returned from Figma");
  return imageUrl;
}

export async function downloadImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type") || "image/png";
  return { base64: buffer.toString("base64"), mimeType };
}

function extractDesignMeta(fileData: any, nodeId?: string): Record<string, any> {
  const meta: Record<string, any> = {};
  try {
    if (nodeId && fileData.nodes) {
      const node = fileData.nodes[nodeId]?.document;
      if (node) {
        meta.name = node.name;
        meta.type = node.type;
        if (node.absoluteBoundingBox) {
          meta.width = node.absoluteBoundingBox.width;
          meta.height = node.absoluteBoundingBox.height;
        }
        if (node.fills) meta.fills = node.fills;
        if (node.style) meta.typography = node.style;
      }
    } else if (fileData.document) {
      meta.name = fileData.name;
      meta.lastModified = fileData.lastModified;
    }
  } catch {}
  return meta;
}

export async function extractFigmaDesign(
  userId: number,
  figmaUrl: string
): Promise<{
  imageBase64: string;
  mimeType: string;
  metadata: Record<string, any>;
  fileName: string;
}> {
  const token = await getValidFigmaToken(userId);
  if (!token) throw new Error("Figma не подключён. Авторизуйтесь через Figma.");

  const parsed = parseFigmaUrl(figmaUrl);
  if (!parsed) throw new Error("Неверная ссылка на Figma. Скопируйте ссылку на фрейм из Figma.");

  const { fileKey, nodeId } = parsed;

  const fileData = await getFigmaFileNodes(token, fileKey, nodeId);
  const metadata = extractDesignMeta(fileData, nodeId);

  const targetNodeId = nodeId || "0:1";
  const imageUrl = await exportFigmaImage(token, fileKey, targetNodeId);
  const { base64, mimeType } = await downloadImageAsBase64(imageUrl);

  return {
    imageBase64: base64,
    mimeType,
    metadata,
    fileName: `figma-${metadata.name || fileKey}.png`,
  };
}
