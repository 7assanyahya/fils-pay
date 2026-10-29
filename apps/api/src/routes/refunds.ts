import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { toFils } from "@filspay/money";
import { requireMerchantAuth, requireMerchantWriterActor, requireMerchantRole } from "../auth/requireMerchantAuth.js";
import { initiateMerchantRefund, assertRefundRequestScope } from "../refunds/initiateMerchantRefund.js";
import { BadRequestError } from "../lib/errors.js";

interface RefundBody {
  transactionId?: string;
  amountFils?: number;
  reason?: string;
  idempotencyKey?: string;
}

interface MerchantRefundParams {
  merchantId: string;
}

function extractIdempotencyKey(request: FastifyRequest): string {
  const header = request.headers["idempotency-key"];
  const headerKey = Array.isArray(header) ? header[0] : header;
  const bodyKey = (request.body as RefundBody | undefined)?.idempotencyKey;
  return headerKey || bodyKey || randomUUID();
}

/**
 * Public partner API: POST /v1/refunds
 */
export async function refundRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: RefundBody }>(
    "/",
    { preHandler: [requireMerchantAuth, requireMerchantRole("owner", "finance")] },
    async (request, reply) => {
      const { transactionId, amountFils, reason } = request.body ?? {};
      if (!transactionId) {
        throw new BadRequestError("invalid_request", "transactionId is required");
      }
      const idempotencyKey = extractIdempotencyKey(request);
      const actor = requireMerchantWriterActor(request.merchantAuth!);

      const result = await initiateMerchantRefund(app.db, app.acquirer, {
        merchantId: request.merchantAuth!.merchantId,
        transactionId,
        amountFils: amountFils !== undefined ? toFils(amountFils) : undefined,
        idempotencyKey,
        actor,
        reason,
      });

      reply.code(result.statusCode).send(result.body);
    },
  );
}

/**
 * Merchant dashboard API: POST /v1/merchants/:merchantId/refunds
 */
export async function merchantRefundRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: MerchantRefundParams; Body: RefundBody }>(
    "/:merchantId/refunds",
    { preHandler: [requireMerchantAuth, requireMerchantRole("owner", "finance")] },
    async (request, reply) => {
      assertRefundRequestScope(request.merchantAuth!, request.params.merchantId);
      const { transactionId, amountFils, reason } = request.body ?? {};
      if (!transactionId) {
        throw new BadRequestError("invalid_request", "transactionId is required");
      }
      const idempotencyKey = extractIdempotencyKey(request);
      const actor = requireMerchantWriterActor(request.merchantAuth!);

      const result = await initiateMerchantRefund(app.db, app.acquirer, {
        merchantId: request.params.merchantId,
        transactionId,
        amountFils: amountFils !== undefined ? toFils(amountFils) : undefined,
        idempotencyKey,
        actor,
        reason,
      });

      reply.code(result.statusCode).send(result.body);
    },
  );
}
