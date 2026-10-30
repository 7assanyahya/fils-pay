import { assertPublicDestination } from "./ssrfGuard.js";

/**
 * The injectable HTTP send — `runDispatchPass` and everything it calls take
 * a `WebhookTransport` as an explicit parameter, never calling `fetch`
 * directly deep inside dispatch logic. Same "pass the effectful dependency
 * in" shape as `AcquirerSimulator`.
 */

/**
 * @property timeoutMs Covers the whole exchange including reading the body (the abort
 * signal stays armed until the body has been read).
 */
export interface WebhookTransportRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface WebhookTransportResponse {
  /** null on a transport-level failure (timeout, DNS, connection refused —
   *  never reached the receiver) */
  statusCode: number | null;
  /** "" on a transport-level failure */
  body: string;
  /** present iff statusCode is null */
  errorMessage?: string;
}

export type WebhookTransport = (req: WebhookTransportRequest) => Promise<WebhookTransportResponse>;

/** Upper bound on how much of a receiver's response body is read. The
 *  delivery log keeps a 2000-byte excerpt; anything past this is dropped
 *  instead of buffered, so a huge response can't exhaust the API's memory. */
const MAX_RESPONSE_BYTES = 64 * 1024;

export interface FetchTransportOptions {
  /** Refuse loopback/private/link-local destinations and don't follow
   *  redirects into them (production; see ssrfGuard.ts). */
  blockPrivateNetworks?: boolean;
}

async function readBounded(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_RESPONSE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).subarray(0, MAX_RESPONSE_BYTES).toString("utf8");
}

/** Real transport: Node's global fetch with an AbortController-driven
 *  timeout, used by index.ts's production wiring. Redirects are never
 *  followed (a 3xx is recorded as a non-2xx response), so a receiver can't
 *  bounce a signed delivery to an internal address. */
export function createFetchTransport(options: FetchTransportOptions = {}): WebhookTransport {
  return async (req: WebhookTransportRequest): Promise<WebhookTransportResponse> => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      if (options.blockPrivateNetworks) {
        await assertPublicDestination(req.url);
      }
      const response = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
        redirect: "manual",
      });
      const body = await readBounded(response);
      return { statusCode: response.status, body };
    } catch (err) {
      return {
        statusCode: null,
        body: "",
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  };
}
