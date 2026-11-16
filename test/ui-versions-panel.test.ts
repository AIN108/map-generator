// src/ui/versionsPanel.ts 단위 테스트 (지금 동작을 그대로 고정한다)
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { toSavedFile, type SavedFile } from "../src/edit.ts";
import { generateLayout } from "../src/layout.ts";
import { generateSite } from "../src/site.ts";
import { createVersionsPanel } from "../src/ui/versionsPanel.ts";
import { MAX_VERSIONS, readVersions, VERSIONS_KEY } from "../src/versions.ts";
import { byId, fire, installDom } from "./helpers/dom.ts";

const dom = installDom();

const site = generateSite("ver-ui", 12);
const base = generateLayout(site, { seed: "ver-ui", buildings: 12, hospital: false, name: "" });
const fileOf = (name: string): SavedFile => {
  const f = toSavedFile({ seed: "ver-ui", buildings: 12, hospital: false, season: "spring", time: "day", view: "mid", surround: "forest" }, base);
  f.layout.name = name;
  return f;
};

let current = fileOf("가람대학교");
let edited = false;
const opened: SavedFile[] = [];
const messages: { text: string; error: boolean }[] = [];
const panel = createVersionsPanel({
  current: () => ({ file: current, layoutJSON: JSON.stringify(current.layout), universityName: current.layout.name }),
  edited: () => edited,
  open: (f) => { opened.push(f); current = f; },
  status: (text, error = false) => { messages.push({ text, error }); },
});

const list = byId<HTMLSelectElement>("versionList");
const nameInput = byId<HTMLInputElement>("versionName");
const lastMessage = (): { text: string; error: boolean } | undefined => messages[messages.length - 1];

beforeEach(() => {
  messages.length = 0;
  opened.length = 0;
  dom.confirm.asked.length = 0;
  dom.confirm.answer = true;
  edited = false;
});

test("이름 없이 저장하면 대학 이름 뒤에 번호를 붙여 저장하고 목록·개수를 고친다", () => {
  fire(byId("versionSave"), "click");
  assert.equal(lastMessage()?.text, "'가람대학교 1' 판을 저장했습니다.");
  assert.deepEqual(readVersions(localStorage).map((v) => v.name), ["가람대학교 1"]);
  assert.equal(byId("versionCount").textContent, "1");
  assert.equal(list.value, "가람대학교 1");
  assert.match(list.options[0].textContent ?? "", /^가람대학교 1 · \d+\/\d+ \d\d:\d\d · \d+동$/);
  assert.equal(byId<HTMLButtonElement>("versionLoad").disabled, false);
});

test("Enter로 이름 붙여 저장, 같은 이름이면 묻고 바꾼다", () => {
  nameInput.value = "1안";
  fire(nameInput, "keydown", { key: "Enter" });
  assert.equal(nameInput.value, "");
  assert.equal(lastMessage()?.text, "'1안' 판을 저장했습니다.");
  nameInput.value = "1안";
  dom.confirm.answer = false;
  fire(byId("versionSave"), "click");
  assert.deepEqual(dom.confirm.asked, ["'1안' 판이 이미 있습니다. 지금 상태로 바꿀까요?"]);
  assert.equal(lastMessage()?.text, "'1안' 판을 저장했습니다.", "거절하면 그대로");
  dom.confirm.answer = true;
  fire(byId("versionSave"), "click");
  assert.equal(lastMessage()?.text, "'1안' 판을 새로 고쳐 저장했습니다.");
});

test("불러오기: 편집이 없으면 묻지 않고 열고, 저장 안 한 편집이 있으면 묻는다", () => {
  list.value = "1안";
  fire(list, "change");
  fire(byId("versionLoad"), "click");
  assert.equal(opened.length, 1);
  assert.equal(dom.confirm.asked.length, 0);
  assert.equal(lastMessage()?.text, "'1안' 판을 불러왔습니다.");
  edited = true;
  current = fileOf("고친대학교");
  dom.confirm.answer = false;
  fire(byId("versionLoad"), "click");
  assert.deepEqual(dom.confirm.asked, ["저장하지 않은 편집은 사라집니다. '1안' 판을 불러올까요?"]);
  assert.equal(opened.length, 1, "거절하면 열지 않는다");
});

test("지우기는 묻고 지운다", () => {
  list.value = "가람대학교 1";
  fire(byId("versionDelete"), "click");
  assert.deepEqual(dom.confirm.asked, ["'가람대학교 1' 판을 지울까요?"]);
  assert.deepEqual(readVersions(localStorage).map((v) => v.name), ["1안"]);
  assert.equal(lastMessage()?.text, "'가람대학교 1' 판을 지웠습니다.");
});

test("add(): 판을 더하고, 개수가 넘치면 가장 오래된 판을 뺀다", () => {
  for (let i = 0; i < MAX_VERSIONS + 2; i++) assert.equal(panel.add(`자동 ${i}`, fileOf(`자동${i}대학교`)), true);
  const names = readVersions(localStorage).map((v) => v.name);
  assert.equal(names.length, MAX_VERSIONS);
  assert.equal(names[0], `자동 ${MAX_VERSIONS + 1}`);
  assert.equal(panel.add("   ", current), false, "빈 이름은 저장하지 않는다");
});

test("저장 공간이 모자라면 오류로 알린다", (t) => {
  t.mock.method(localStorage, "setItem", () => { throw new Error("QuotaExceededError"); });
  nameInput.value = "큰 판";
  fire(byId("versionSave"), "click");
  assert.deepEqual(lastMessage(), { text: "브라우저 저장 공간이 모자랍니다. 쓰지 않는 판을 지우거나 'JSON 저장'을 쓰세요.", error: true });
});

test("다른 탭에서 바뀐 판도 storage 이벤트로 다시 읽는다", () => {
  localStorage.setItem(VERSIONS_KEY, "[]");
  const w = (globalThis as unknown as { window: { StorageEvent: typeof StorageEvent; dispatchEvent(e: Event): boolean } }).window;
  w.dispatchEvent(new w.StorageEvent("storage", { key: VERSIONS_KEY }));
  assert.equal(byId("versionCount").textContent, "0");
  assert.equal(byId<HTMLButtonElement>("versionLoad").disabled, true);
});
