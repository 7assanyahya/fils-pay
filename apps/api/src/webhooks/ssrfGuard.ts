import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Outbound webhook deliveries go to merchant-supplied URLs, and the response
 * excerpt is shown back to the merchant. Without a guard a merchant could
 * point an endpoint at the settlement internal API, Postgres, or a cloud
 * metadata address and read the replies (SSRF). Production refuses
 * loopback, private, link-local, CGNAT, multicast and unspecified addresses,
 * both at registration (literal hosts) and at send time (after DNS).
 */

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const BLOCKED_V4: Array<[string, number]> = [
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

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const value = ipv4ToInt(ip);
    return BLOCKED_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (value & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isBlockedAddress(mapped[1]!);
    if (lower === "::" || lower === "::1") return true;
    // fc00::/7 (unique local), fe80::/10 (link-local), ff00::/8 (multicast)
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith("ff");
  }
  return false;
}

/** Synchronous check for a URL's literal host (no DNS): localhost names and blocked IP literals. */
export function isBlockedLiteralHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return isBlockedAddress(host);
}

/** Resolves the URL's host and throws if any address it resolves to is blocked. */
export async function assertPublicDestination(rawUrl: string): Promise<void> {
  const host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, "");
  if (isBlockedLiteralHost(host)) {
    throw new Error("destination_not_allowed");
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
    throw new Error("destination_not_allowed");
  }
}
