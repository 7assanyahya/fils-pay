import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import { formatIsoDate } from "../lib/dateFormat.js";

/**
 * Uniform error -> HTTP response mapping. Every route across the API
 * should throw an `AppError` subclass; this is the single place that turns
 * one into `{ "error": "code", "message"?: "string" }`.
 */
// am: 500s log the full err incl. pg detail, might contain card ref? fine its server-side
export function errorHandler(
  err: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (err instanceof AppError) {
    reply.code(err.statusCode).send({ error: err.code, message: err.message });
    return;
  }

  const fastifyErr = err as FastifyError;

  // YA: 400 not 422 for schema validation errors — API.md section 2. correct
  if (fastifyErr.validation) {
    reply.code(400).send({ error: "validation_error", message: fastifyErr.message });
    return;
  }

  if (fastifyErr.code === "FST_REQ_FILE_TOO_LARGE" || fastifyErr.code === "FST_FILES_LIMIT") {
    reply.code(413).send({ error: "file_too_large", message: fastifyErr.message });
    return;
  }

  // A body the content-type parser couldn't parse (malformed JSON) is the
  // client's error; the parsers already mark it 400.
  if (fastifyErr.code === "FST_ERR_CTP_INVALID_JSON_BODY" || (fastifyErr.statusCode === 400 && err instanceof SyntaxError)) {
    reply.code(400).send({ error: "invalid_json", message: "request body is not valid JSON" });
    return;
  }

  // A malformed id (e.g. a non-UUID path segment) reaching a uuid column is
  // Postgres' invalid_text_representation. Nothing with that id can exist,
  // so answer 404 like the admin routes do, not 500.
  if ((err as { code?: string }).code === "22P02") {
    reply.code(404).send({ error: "not_found", message: "not_found" });
    return;
  }

  request.log.error({ err, occurredOn: formatIsoDate(new Date()) }, "unhandled error");
  reply.code(500).send({ error: "internal_error" });
}
