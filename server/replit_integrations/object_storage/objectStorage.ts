import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const ROOT = "/data/storage";
const PRIV = () => process.env.PRIVATE_OBJECT_DIR || `${ROOT}/private`;
const PUB = () => (process.env.PUBLIC_OBJECT_SEARCH_PATHS || `${ROOT}/public`).split(",").map((s) => s.trim()).filter(Boolean);
const META = ".meta.json";

function abs(p: string) {
  return path.posix.normalize(p.startsWith("/") ? p : `/${p}`);
}
function parse(p: string) {
  const parts = abs(p).split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("Invalid object path");
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}
function fp(bucket: string, objectName: string) {
  return abs([bucket, ...objectName.split("/").filter(Boolean)].join("/"));
}
function ctype(p: string) {
  const e = path.posix.extname(p).toLowerCase();
  const m: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
    ".pdf": "application/pdf",
  };
  return m[e] || "application/octet-stream";
}

export class LocalFile {
  constructor(public absolutePath: string, public name: string) {}
  async exists(): Promise<[boolean]> {
    try { await fs.promises.access(this.absolutePath); return [true]; } catch { return [false]; }
  }
  async save(buf: Buffer, opts?: { contentType?: string; resumable?: boolean }) {
    await fs.promises.mkdir(path.posix.dirname(this.absolutePath), { recursive: true });
    await fs.promises.writeFile(this.absolutePath, buf);
    let meta: any = {};
    try { meta = JSON.parse(await fs.promises.readFile(this.absolutePath + META, "utf8")); } catch {}
    meta.contentType = opts?.contentType || meta.contentType || ctype(this.absolutePath);
    await fs.promises.writeFile(this.absolutePath + META, JSON.stringify(meta), "utf8");
  }
  createReadStream() { return fs.createReadStream(this.absolutePath); }
  async getMetadata(): Promise<[any]> {
    const st = await fs.promises.stat(this.absolutePath);
    let meta: any = {};
    try { meta = JSON.parse(await fs.promises.readFile(this.absolutePath + META, "utf8")); } catch {}
    return [{ size: st.size, contentType: meta.contentType || ctype(this.absolutePath), metadata: meta.metadata || {} }];
  }
  async setMetadata(payload: { metadata?: Record<string, string> }) {
    let meta: any = {};
    try { meta = JSON.parse(await fs.promises.readFile(this.absolutePath + META, "utf8")); } catch {}
    meta.metadata = { ...(meta.metadata || {}), ...(payload.metadata || {}) };
    await fs.promises.mkdir(path.posix.dirname(this.absolutePath), { recursive: true });
    await fs.promises.writeFile(this.absolutePath + META, JSON.stringify(meta), "utf8");
  }
}

export const objectStorageClient = {
  bucket(bucketName: string) {
    return { file: (objectName: string) => new LocalFile(fp(bucketName, objectName), objectName) };
  },
};

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  getPublicObjectSearchPaths() { return PUB().map(abs); }
  getPrivateObjectDir() { return abs(PRIV()); }
  async searchPublicObject(filePath: string) {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const full = path.posix.join(searchPath, filePath.replace(/^\/+/, ""));
      const { bucketName, objectName } = parse(full);
      const file = objectStorageClient.bucket(bucketName).file(objectName);
      if ((await file.exists())[0]) return file as any;
    }
    return null;
  }
  async downloadObject(file: any, res: Response, cacheTtlSec = 3600, req?: Request) {
    try {
      const [metadata] = await file.getMetadata();
      const acl = await getObjectAclPolicy(file);
      const isPublic = acl?.visibility === "public";
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": String(metadata.size || 0),
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
      });
      const stream = file.createReadStream();
      stream.on("error", (err: any) => {
        if (err.code === "EPIPE" || err.code === "ECONNRESET") return;
        console.error("Stream error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Error streaming file" });
      });
      req?.on("close", () => stream.destroy());
      stream.pipe(res);
    } catch (e) {
      console.error("Error downloading file:", e);
      if (!res.headersSent) res.status(500).json({ error: "Error downloading file" });
    }
  }
  async getObjectEntityUploadURL() { return `/objects/uploads/${randomUUID()}`; }
  async getObjectEntityFile(objectPath: string) {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const id = objectPath.replace(/^\/objects\//, "");
    if (!id) throw new ObjectNotFoundError();
    const full = path.posix.join(this.getPrivateObjectDir(), id);
    const { bucketName, objectName } = parse(full);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    if (!(await file.exists())[0]) throw new ObjectNotFoundError();
    return file as any;
  }
  normalizeObjectEntityPath(rawPath: string) {
    if (!rawPath) return rawPath;
    if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) {
      const pathname = new URL(rawPath).pathname;
      return pathname.startsWith("/objects/") ? pathname : rawPath;
    }
    if (rawPath.startsWith("/objects/")) return rawPath;
    const dir = this.getPrivateObjectDir();
    const n = abs(rawPath);
    if (!n.startsWith(`${dir}/`)) return rawPath;
    return `/objects/${n.slice(dir.length + 1)}`;
  }
  async trySetObjectEntityAclPolicy(rawPath: string, aclPolicy: ObjectAclPolicy) {
    const normalized = this.normalizeObjectEntityPath(rawPath);
    if (!normalized.startsWith("/")) return normalized;
    const file = await this.getObjectEntityFile(normalized);
    await setObjectAclPolicy(file, aclPolicy);
    return normalized;
  }
  async canAccessObjectEntity(opts: { userId?: string; objectFile: any; requestedPermission?: ObjectPermission }) {
    return canAccessObject({
      userId: opts.userId,
      objectFile: opts.objectFile,
      requestedPermission: opts.requestedPermission ?? ObjectPermission.READ,
    });
  }
}
