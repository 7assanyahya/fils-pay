import { createHmac } from "node:crypto";
import { timingSafeEqualHex } from "../lib/crypto.js";

/** Verifies the signature on an inbound acquirer callback. */

interface ParsedAcquirerSignatureHeader {
  timestamp: number;
  signature: string;
}

function parseAcquirerSignatureHeader(header: string): ParsedAcquirerSignatureHeader | null {
  let timestampStr: string | null = null;
  let signature: string | null = null;

  for (const part of header.split(",")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (key === "t") timestampStr = value;
    else if (key === "v1") signature = value;
  }

  if (!timestampStr || !signature) return null;
  if (!/^\d+$/.test(timestampStr)) return null;

  const timestamp = Number.parseInt(timestampStr, 10);
  if (!Number.isFinite(timestamp)) return null;

  return { timestamp, signature };
}

export type VerifyAcquirerCallbackFailureReason = "malformed_header" | "signature_mismatch" | "timestamp_out_of_range";

export interface VerifyAcquirerCallbackResult {
  valid: boolean;
  reason?: VerifyAcquirerCallbackFailureReason;
}

/**
 * Verifies the acquirer callback signature when present and required.
 *
 * `payload` should be the raw request body string — the exact bytes the
 * acquirer signed. A parsed object is re-serialized with JSON.stringify,
 * which only matches if the sender serialized identically (key order,
 * whitespace, number formatting), so it is accepted for unit tests only.
 * `maxAgeSeconds` > 0 rejects a timestamp outside ±maxAgeSeconds of `now`,
 * so a captured callback can't be replayed later.
 */
export function verifyAcquirerCallbackSignature(
  payload: unknown,
  header: string | undefined,
  secret: string,
  requireSignature = false,
  maxAgeSeconds = 0,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifyAcquirerCallbackResult {
  if (!header) {
    return requireSignature
      ? { valid: false, reason: "malformed_header" }
      : { valid: true };
  }

  const parsed = parseAcquirerSignatureHeader(header);
  if (!parsed) return { valid: false, reason: "malformed_header" };

  if (maxAgeSeconds > 0 && Math.abs(nowSeconds - parsed.timestamp) > maxAgeSeconds) {
    return { valid: false, reason: "timestamp_out_of_range" };
  }

  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${body}`)
    .digest("hex");

  if (!timingSafeEqualHex(expected, parsed.signature)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  return { valid: true };
}
