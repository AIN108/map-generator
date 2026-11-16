// src/ui/llmPanel.ts·src/ui/notePanel.ts 단위 테스트 (지금 동작을 그대로 고정한다)
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { addNote, cloneLayout, findNote, type EditResult } from "../src/edit.ts";
import { generateLayout, type Layout } from "../src/layout.ts";
import { MAX_PROSE_CHARS } from "../src/llm.ts";
import { generateSite } from "../src/site.ts";
import { createLlmPanel } from "../src/ui/llmPanel.ts";
import { createNotePanel } from "../src/ui/notePanel.ts";
import { byId, fire, flush, installDom } from "./helpers/dom.ts";

installDom();

// ── Claude로 읽기 칸 ──
const KEY_STORE = "cmg:anthropic-key:v1";
localStorage.setItem(KEY_STORE, "sk-ant-saved");
let prose = { text: "", source: "목록 칸의 글" };
const filled: { text: string; lines: string[] }[] = [];
const llm = createLlmPanel({ prose: () => prose, fill: (text, lines) => filled.push({ text, lines }) });
const report = byId("llmReport");
const key = byId<HTMLInputElement>("llmKey");
const remember = byId<HTMLInputElement>("llmRemember");

test("기억해 둔 키가 있으면 처음부터 채우고 '기억'을 켠다", () => {
  assert.equal(key.value, "sk-ant-saved");
  assert.equal(remember.checked, true);
});

test("refresh: 글이 없으면 안내, 있으면 글자 수·어림 토큰·비용, 너무 길면 표시", () => {
  prose = { text: "  ", source: "목록 칸의 글" };
  llm.refresh();
  assert.match(report.textContent ?? "", /^읽을 글이 없습니다/);
  prose = { text: "가".repeat(300), source: "설정.md" };
  llm.refresh();
  assert.equal(report.textContent, "보낼 글: 설정.md 300자 (입력 약 200토큰, 어림 $0.08 안팎)");
  prose = { text: "가".repeat(MAX_PROSE_CHARS + 1), source: "긴 글.txt" };
  llm.refresh();
  assert.match(report.textContent ?? "", / — 너무 깁니다$/);
});

test("'기억'을 끄면 저장한 키를 지우고, 켜고 키를 바꾸면 저장한다", () => {
  remember.checked = false;
  fire(remember, "change");
  assert.equal(localStorage.getItem(KEY_STORE), null);
  remember.checked = true;
  key.value = "  sk-ant-new  ";
  fire(key, "change");
  assert.equal(localStorage.getItem(KEY_STORE), "sk-ant-new");
});

test("키 없이 실행하면 API를 부르지 않고 오류로 알린 뒤 단추를 되살린다", async () => {
  key.value = " ";
  prose = { text: "도서관은 중앙광장 동쪽에 있다.", source: "설정.md" };
  fire(byId("llmRun"), "click");
  assert.equal(byId<HTMLButtonElement>("llmRun").disabled, true);
  assert.equal(byId("llmCancel").hidden, false);
  await flush();
  assert.equal(report.textContent, "API 키를 넣어 주세요.");
  assert.equal(report.classList.contains("error"), true);
  assert.equal(byId<HTMLButtonElement>("llmRun").disabled, false);
  assert.equal(byId("llmCancel").hidden, true);
  assert.deepEqual(filled, []);
  assert.equal(localStorage.getItem(KEY_STORE), null, "실행할 때 빈 키는 기억하지 않는다");
});

// ── 메모 핀 칸 ──
const site = generateSite("note-ui", 12);
let layout: Layout = generateLayout(site, { seed: "note-ui", buildings: 12, hospital: false, name: "" });
const a = addNote(layout, 10, 20, "사건 현장").id!;
const b = addNote(layout, -30, 5, "동아리방").id!;
let selected: number | undefined;
let closed = 0;
const applied: (string | undefined)[] = [];
const notes = createNotePanel({
  layout: () => layout,
  selected: () => selected,
  apply: (edit: (l: Layout) => EditResult, mergeKey?: string) => {
    const next = cloneLayout(layout);
    const r = edit(next);
    if (r.ok) { layout = next; applied.push(mergeKey); }
    return r.ok;
  },
  where: (x, y) => `(${x}, ${y})`,
  close: () => { closed++; },
});
const box = byId("noteBox");
const title = byId<HTMLInputElement>("noteTitle");
const text = byId<HTMLTextAreaElement>("noteText");
const color = byId<HTMLSelectElement>("noteColor");

beforeEach(() => { applied.length = 0; });

test("고른 메모가 없으면 칸을 숨기고, 고르면 제목·내용·색·자리를 채운다", () => {
  selected = undefined;
  notes.sync();
  assert.equal(box.hidden, true);
  selected = a;
  notes.sync();
  assert.equal(box.hidden, false);
  assert.equal(byId("noteLegend").textContent, "메모 · 사건 현장");
  assert.equal(title.value, "사건 현장");
  assert.equal(text.value, "");
  assert.equal(color.value, "red");
  assert.equal(byId("noteWhere").textContent, "(10, 20)");
  assert.ok(color.options.length >= 2, "색 목록을 채운다");
});

test("제목·내용·색을 바꾸면 그 메모에 반영한다 (내용은 묶음 키를 쓴다)", () => {
  selected = a;
  notes.sync();
  title.value = "새 제목";
  fire(title, "change");
  text.value = "밤 11시";
  fire(text, "change");
  color.value = color.options[1].value;
  fire(color, "change");
  const n = findNote(layout, a)!;
  assert.equal(n.title, "새 제목");
  assert.equal(n.text, "밤 11시");
  assert.equal(n.color, color.options[1].value);
  assert.deepEqual(applied, [undefined, `note-text:${a}`, undefined]);
});

test("쓰기 시작한 뒤 다른 메모를 골라도 바뀐 글은 처음 메모에 들어간다", () => {
  selected = a;
  notes.sync();
  fire(text, "focus");
  selected = b;
  text.value = "원래 메모에 들어갈 글";
  fire(text, "change");
  assert.equal(findNote(layout, a)!.text, "원래 메모에 들어갈 글");
  assert.equal(findNote(layout, b)!.text, undefined);
});

test("지우기에 성공하면 닫고, 닫기 단추도 닫는다", () => {
  selected = b;
  notes.sync();
  fire(byId("noteDelete"), "click");
  assert.equal(findNote(layout, b), undefined);
  assert.equal(closed, 1);
  fire(byId("noteClose"), "click");
  assert.equal(closed, 2);
});
