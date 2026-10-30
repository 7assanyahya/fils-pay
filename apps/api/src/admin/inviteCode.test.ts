import assert from "node:assert/strict";
import { test } from "node:test";
import { generateInviteCode } from "./inviteCode.js";

test("generateInviteCode produces an 8-character string from the alphabet by default", () => {
  for (let i = 0; i < 20; i++) {
    const code = generateInviteCode();
    assert.equal(code.length, 8);
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  }
});

test("generateInviteCode respects requested length", () => {
  const code = generateInviteCode(12);
  assert.equal(code.length, 12);
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/);
});
