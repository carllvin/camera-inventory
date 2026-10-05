/**
 * Download a remote image for the server without letting a URL reach our own
 * network (SSRF): only http(s), only public IPs (checked at connect time, so DNS
 * rebinding cannot sneak past), limited redirects, size and time.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { DomainError } from "../domain/context";

export const MAX_REMOTE_IMAGE_BYTES = 15 * 1024 * 1024;

function ipv4ToInt(ip: string) {
  return ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return !V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits)));
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return false;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (/^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff")) return false; // ULA, link-local, multicast
    return true;
  }
  return false;
}

/** DNS lookup that refuses non-public addresses; used by the socket itself. */
function safeLookup(hostname: string, options: object, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, "");
    const list = (addresses as LookupAddress[]).filter((a) => isPublicAddress(a.address));
    if (list.length === 0) return cb(Object.assign(new Error(`Blocked address for ${hostname}`), { code: "EBLOCKED" }), "");
    if ((options as { all?: boolean }).all) return cb(null, list);
    cb(null, list[0]!.address, list[0]!.family);
  });
}

export interface FetchedImage {
  bytes: Buffer;
  contentType: string;
  finalUrl: string;
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Tests only: allow loopback (local fake servers). */
  allowPrivateForTests?: boolean;
}

export async function fetchRemoteImage(rawUrl: string, opts: SafeFetchOptions = {}): Promise<FetchedImage> {
  const maxBytes = opts.maxBytes ?? MAX_REMOTE_IMAGE_BYTES;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new DomainError("VALIDATION", "That is not a valid image address.");
  }
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new DomainError("VALIDATION", "Only http(s) image addresses are allowed.");
    if (url.username || url.password) throw new DomainError("VALIDATION", "Image addresses with credentials are not allowed.");
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, "")) && !opts.allowPrivateForTests && !isPublicAddress(url.hostname.replace(/^\[|\]$/g, ""))) {
      throw new DomainError("VALIDATION", "This address is not allowed.");
    }
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const lib = url.protocol === "https:" ? https : http;
      const req = lib.get(
        url,
        {
          lookup: opts.allowPrivateForTests ? undefined : (safeLookup as never),
          headers: { "user-agent": "CameraInventory/1.0 (reference image fetch)", accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" },
          timeout: timeoutMs,
        },
        resolve,
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
    }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "EBLOCKED") throw new DomainError("VALIDATION", "This address points to a private network and is not allowed.");
      throw new DomainError("VALIDATION", "The image could not be downloaded (site unreachable or too slow).");
    });
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      url = new URL(res.headers.location, url);
      continue;
    }
    if (status !== 200) {
      res.resume();
      throw new DomainError("VALIDATION", `The site answered with error ${status}.`);
    }
    const contentType = String(res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (!contentType.startsWith("image/") || contentType === "image/svg+xml") {
      res.resume();
      throw new DomainError("VALIDATION", "That address is not an image (or it is an SVG, which is not accepted).");
    }
    const declared = Number(res.headers["content-length"] ?? 0);
    if (declared > maxBytes) {
      res.resume();
      throw new DomainError("VALIDATION", "The image is too large.");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res) {
      size += (chunk as Buffer).length;
      if (size > maxBytes) {
        res.destroy();
        throw new DomainError("VALIDATION", "The image is too large.");
      }
      chunks.push(chunk as Buffer);
    }
    return { bytes: Buffer.concat(chunks), contentType, finalUrl: url.toString() };
  }
  throw new DomainError("VALIDATION", "Too many redirects.");
}
