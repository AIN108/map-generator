// src/ui/shareLink.ts 단위 테스트 (지금 동작을 그대로 고정한다)
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { toSavedFile, type SavedFile } from "../src/edit.ts";
import { generateLayout } from "../src/layout.ts";
import { encodeShare } from "../src/share.ts";
import { generateSite } from "../src/site.ts";
import { createShareLink } from "../src/ui/shareLink.ts";
import { byId, fire, flush, installDom } from "./helpers/dom.ts";

const dom = installDom();
const w = dom.window;

const site = generateSite("share-dom", 12);
const layout = generateLayout(site, { seed: "share-dom", buildings: 12, hospital: false, name: "" });
const file: SavedFile = toSavedFile({ seed: "share-dom", buildings: 12, hospital: false, season: "spring", time: "day", view: "mid", surround: "forest" }, layout);

const state = { edits: false, program: false, ready: true, edited: false, backup: "" };
const opened: SavedFile[] = [];
const messages: { text: string; error: boolean }[] = [];
let rewrites = 0;
const share = createShareLink({
  current: () => file,
  hasEdits: () => state.edits,
  hasProgram: () => state.program,
  open: (f) => { opened.push(f); return state.backup; },
  rewriteHash: () => { rewrites++; },
  ready: () => state.ready,
  edited: () => state.edited,
  status: (text, error = false) => { messages.push({ text, error }); },
});
const data = await encodeShare(file);

beforeEach(async () => {
  // 앞 테스트가 바꾼 해시의 hashchange 처리가 다 끝난 뒤 기록을 비운다
  Object.assign(state, { edits: false, program: false, ready: false, edited: false, backup: "" });
  w.location.hash = "#seed=a";
  await flush(30);
  state.ready = true;
  opened.length = 0;
  messages.length = 0;
  dom.clipboard.length = 0;
  dom.confirm.asked.length = 0;
  dom.confirm.answer = true;
  rewrites = 0;
});

test("편집이 없으면 지금 주소를 그대로 복사한다", async () => {
  fire(byId("copyLink"), "click");
  await flush();
  assert.deepEqual(dom.clipboard, ["https://example.test/#seed=a"]);
  assert.deepEqual(messages, [{ text: "현재 조감도 링크를 복사했습니다.", error: false }]);
});

test("편집이 있으면 배치를 &l=로 붙이고, 목록이 있으면 그렇게 알린다", async () => {
  state.edits = true;
  state.program = true;
  fire(byId("copyLink"), "click");
  await flush(20);
  assert.equal(dom.clipboard[0], `https://example.test/#seed=a&l=${data}`);
  assert.match(messages[0].text, /^편집한 배치와 건물 목록까지 담은 링크를 복사했습니다 \([\d,]+자\)\./);
});

test("openFromHash: &l=이 없으면 열지 않는다", async () => {
  assert.deepEqual(await share.openFromHash(), { opened: false });
  assert.equal(opened.length, 0);
});

test("openFromHash: 배치를 열고, 보관한 판이 있으면 그 이름을 알린다", async () => {
  w.location.hash = `#seed=a&l=${data}`;
  state.backup = "링크 열기 전 1/2 03:04";
  assert.deepEqual(await share.openFromHash(), { opened: true });
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0].layout, file.layout);
  assert.equal(messages[0].text, "링크에 담긴 배치를 열었습니다. 이 브라우저에 있던 편집은 '저장해 둔 판'의 '링크 열기 전 1/2 03:04'에 보관했습니다.");
});

test("openFromHash: 손상된 배치는 열지 않고 오류 문구를 돌려준다", async () => {
  w.location.hash = "#seed=a&l=AAAA";
  const r = await share.openFromHash();
  assert.equal(r.opened, false);
  assert.match(r.error ?? "", /^링크에 담긴 배치를 열지 못했습니다: 링크의 배치가 손상되었습니다/);
  w.location.hash = "#seed=a&l=@@";
  assert.match((await share.openFromHash()).error ?? "", /올바르지 않습니다/);
});

/** 주소의 해시를 바꾼다. happy-dom이 브라우저처럼 hashchange를 보낸다. */
const go = async (hash: string): Promise<void> => { w.location.hash = hash; await flush(20); };

test("열려 있는 탭에 배치 링크를 붙이면(hashchange) 편집이 있을 때 묻고, 거절하면 주소만 되돌린다", async () => {
  state.edited = true;
  dom.confirm.answer = false;
  await go(`#seed=a&l=${data}`);
  assert.equal(dom.confirm.asked.length, 1);
  assert.equal(opened.length, 0);
  assert.equal(rewrites, 1);
  dom.confirm.answer = true;
  await go(`#seed=c&l=${data}`);
  assert.equal(dom.confirm.asked.length, 2);
  assert.equal(opened.length, 1);
});

test("hashchange: 준비 전이거나 &l=이 없으면 무시하고, 열지 못하면 주소를 되돌리고 오류로 알린다", async () => {
  state.ready = false;
  await go(`#seed=a&l=${data}`);
  assert.equal(opened.length, 0);
  state.ready = true;
  await go("#seed=b");
  assert.equal(opened.length + rewrites + messages.length, 0);
  await go("#seed=b&l=AAAA");
  assert.equal(rewrites, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].error, true);
  assert.match(messages[0].text, /^링크에 담긴 배치를 열지 못했습니다/);
});
