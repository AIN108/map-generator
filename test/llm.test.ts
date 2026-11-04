import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateCost, extractWithClaude, LLM_MODEL, OUTPUT_SCHEMA, parseLlmOutput, systemPrompt } from "../src/llm.ts";
import { parseProgram } from "../src/program.ts";

test("지시문은 앱이 읽는 종류·외관·상징물 이름을 그대로 알려 주고, 예시는 목록 형식으로 읽힌다", () => {
  const s = systemPrompt();
  for (const w of ["도서관", "기숙사", "운동장", "코트", "벽돌", "유리", "분수", "연못", "번호 없음", "@상징물"]) assert.ok(s.includes(w), w);
  const example = s.slice(s.indexOf("예:") + 3);
  const parsed = parseProgram(example);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.program.items.length, 5);
  assert.equal(parsed.program.landmarks.length, 1);
  assert.equal(LLM_MODEL, "claude-opus-5-5");
  assert.deepEqual(OUTPUT_SCHEMA.required, ["program", "notes"]);
});

test("응답 읽기: JSON 목록과 참고 사항, 틀린 응답은 알아듣기 쉬운 오류", () => {
  assert.deepEqual(parseLlmOutput('{"program":" 본관 | 본부 \\n","notes":["층수 없음", 3]}'), { program: "본관 | 본부", notes: ["층수 없음"] });
  assert.throws(() => parseLlmOutput("목록입니다"), /읽지 못했습니다/);
  assert.throws(() => parseLlmOutput('{"notes":[]}'), /목록이 없습니다/);
  assert.ok(Math.abs(estimateCost(1_000_000, 100_000) - 6) < 1e-9, "입력 $4 + 출력 $20×0.1");
});

test("키·글이 없거나 글이 너무 길면 보내지 않는다", async () => {
  await assert.rejects(extractWithClaude("", "글"), /API 키/);
  await assert.rejects(extractWithClaude("sk-ant-x", "   "), /설정 글이 없습니다/);
  await assert.rejects(extractWithClaude("sk-ant-x", "가".repeat(200_001)), /너무 깁니다/);
});
