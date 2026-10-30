import type { Pool } from "pg";
import type { Config } from "../config.js";
import { insertAdminAuditLog } from "../adminAudit/log.js";
import { issueApiKeyInTx, type IssuedApiKey } from "../apiKeys/issue.js";
import { withTransaction } from "../db/withTransaction.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";

export interface RotatedApiKey extends IssuedApiKey {
  previousKeyId: string;
}

/** Rotates a merchant's API key, atomically with its audit row. */
/** How long the previous key keeps working after a rotation, so the merchant
 *  can deploy the new one. Bounded: verifyApiKey stops honouring the old key
 *  once revoke_after passes (migration 0056 added the column, but nothing
 *  ever set it, so rotated keys stayed valid forever). */
export const API_KEY_ROTATION_GRACE_HOURS = 24;

export async function rotateApiKeyAsAdmin(
  pool: Pool,
  config: Pick<Config, "nodeEnv">,
  input: { merchantId: string; apiKeyId: string; adminUserId: string; label?: string },
): Promise<RotatedApiKey> {
  return withTransaction(pool, async (client) => {
    const existing = await client.query<{
      id: string;
      label: string | null;
      revoked_at: Date | null;
      revoke_after: Date | null;
    }>(
      `SELECT id, label, revoked_at, revoke_after FROM api_keys WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [input.apiKeyId, input.merchantId],
    );
    const row = existing.rows[0];
    if (!row) {
      throw new NotFoundError("api_key_not_found");
    }
    if (row.revoked_at) {
      throw new ConflictError("api_key_already_revoked");
    }
    // Already rotated: its revocation is scheduled (or past). Rotating it
    // again would push revoke_after out and bring an expired key back.
    if (row.revoke_after) {
      throw new ConflictError("api_key_already_rotated");
    }

    const issued = await issueApiKeyInTx(client, config, {
      merchantId: input.merchantId,
      createdByAdminUserId: input.adminUserId,
      label: input.label ?? row.label ?? undefined,
      rotatedFromKeyId: input.apiKeyId,
    });

    await client.query(
      `UPDATE api_keys SET revoke_after = now() + make_interval(hours => $2)
        WHERE id = $1 AND revoked_at IS NULL`,
      [input.apiKeyId, API_KEY_ROTATION_GRACE_HOURS],
    );

    await insertAdminAuditLog(client, {
      adminUserId: input.adminUserId,
      action: "api_key_rotate",
      targetType: "api_key",
      targetId: input.apiKeyId,
      metadata: { merchantId: input.merchantId, newKeyId: issued.id },
    });

    return { ...issued, previousKeyId: input.apiKeyId };
  });
}
