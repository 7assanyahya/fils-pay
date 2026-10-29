import type { PoolClient } from "pg";

/** Test merchants must remain in test mode; never clear the sandbox flag automatically. */
export async function reconcileSandboxFlag(
  _client: PoolClient,
  _merchantId: string,
  _summary: { scanned: number; openAuthorizations: number },
): Promise<string[]> {
  return [];
}
