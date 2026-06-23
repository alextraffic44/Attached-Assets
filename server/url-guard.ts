import dns from "dns";
import { promisify } from "util";

const lookup = promisify(dns.lookup);

function ipToParts(ip: string): number[] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

/** True for private, loopback, link-local, and reserved ranges (IPv4 + common IPv6). */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  let addr = ip;
  // Strip IPv6 zone / map prefixes
  if (addr.startsWith("::ffff:")) addr = addr.slice(7);
  const lower = addr.toLowerCase();

  // IPv6 loopback / link-local / unique-local
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true;

  const parts = ipToParts(addr);
  if (!parts) {
    // Unknown / non-IPv4 form we couldn't classify — treat as unsafe.
    return !/^\d+\.\d+\.\d+\.\d+$/.test(addr);
  }
  const [a, b] = parts;
  if (a === 10) return true;                       // 10.0.0.0/8
  if (a === 127) return true;                      // loopback
  if (a === 0) return true;                        // 0.0.0.0/8
  if (a === 169 && b === 254) return true;         // link-local + cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;         // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true;                       // multicast / reserved
  return false;
}

/**
 * Validate that a user-supplied URL is a public http(s) URL, resolving DNS to
 * block SSRF to localhost / private / cloud-metadata addresses.
 * Throws on rejection. Returns the parsed URL on success.
 */
export async function assertPublicHttpUrl(urlString: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Некорректный URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Разрешены только http/https");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error("Доступ к внутренним адресам запрещён");
  }
  // If the host is a literal IP, check it directly.
  if (ipToParts(host) || host.includes(":")) {
    if (isPrivateIp(host)) throw new Error("Доступ к внутренним адресам запрещён");
    return url;
  }
  // Resolve all addresses; reject if any is private.
  const results = await lookup(host, { all: true });
  if (!results.length) throw new Error("Не удалось разрешить адрес");
  for (const r of results) {
    if (isPrivateIp(r.address)) throw new Error("Доступ к внутренним адресам запрещён");
  }
  return url;
}
