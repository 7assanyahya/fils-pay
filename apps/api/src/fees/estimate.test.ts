import assert from "node:assert/strict";
import { test } from "node:test";
import { toFils } from "@filspay/money";
import { estimateFeeFils } from "./estimate.js";

test("estimateFeeFils computes integer platform fees matching ComputeSettlementFee", () => {
  assert.equal(estimateFeeFils(10_000, 250, 0), 250);
  assert.equal(estimateFeeFils(10_000, 250, 1000), 225);
  assert.equal(estimateFeeFils(1_005, 175, 0), 18);
});
