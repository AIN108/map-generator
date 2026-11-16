import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { TOOL_HINTS, TOOL_KEYS, TOOL_KO } from "../src/ui/tools.ts";

test("숫자 키 순서는 화면의 도구 목록 순서와 같고, 모든 도구에 안내·이름이 있다", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const order = [...html.matchAll(/name="tool" value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(TOOL_KEYS, order);
  for (const t of TOOL_KEYS) {
    assert.ok(TOOL_HINTS[t].length > 0, t);
    assert.ok(TOOL_KO[t].length > 0, t);
  }
  assert.equal(Object.keys(TOOL_HINTS).length, TOOL_KEYS.length);
});
