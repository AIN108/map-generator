// '링크 복사' 단추: DOM 없이 필요한 전역만 흉내 내 createShareLink의 상태 줄 안내를 검사한다.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { toSavedFile, type SavedFile } from "../src/edit.ts";
import { generateLayout } from "../src/layout.ts";
import { generateSite } from "../src/site.ts";
import { createShareLink, type ShareHost } from "../src/ui/shareLink.ts";

type Listener = () => unknown;
const clicks = new Map<string, Listener>();
let copied: string[] = [];
let clipboardFails = false;

const g = globalThis as Record<string, unknown>;
g.document = {
  getElementById: (id: string) => ({
    addEventListener: (type: string, fn: Listener) => { if (type === "click") clicks.set(id, fn); },
  }),
};
g.window = { addEventListener: () => undefined };
g.location = { href: "https://example.test/#seed=a", hash: "#seed=a" };
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    clipboard: {
      writeText: async (s: string) => {
        if (clipboardFails) throw new Error("denied");
        copied.push(s);
      },
    },
  },
});

const site = generateSite("share-ui", 12);
const layout = generateLayout(site, { seed: "share-ui", buildings: 12, hospital: false, name: "" });
const goodFile = (): SavedFile =>
  toSavedFile({ seed: "share-ui", buildings: 12, hospital: false, season: "spring", time: "day", view: "mid", surround: "forest" }, layout);

let messages: { text: string; error: boolean }[] = [];
let file: SavedFile | undefined;
const host: ShareHost = {
  current: () => file,
  hasEdits: () => true,
  hasProgram: () => false,
  open: () => "",
  rewriteHash: () => undefined,
  ready: () => true,
  edited: () => true,
  status: (text, error = false) => { messages.push({ text, error }); },
};
createShareLink(host);
const copyClick = async (): Promise<void> => { await clicks.get("copyLink")!(); };

beforeEach(() => {
  messages = [];
  copied = [];
  clipboardFails = false;
});

test("편집한 배치를 링크로 만들지 못하면 상태 줄에 오류로 알리고 복사하지 않는다", async () => {
  const broken = goodFile();
  (broken.layout as unknown as Record<string, unknown>).self = broken; // JSON.stringify가 실패하는 값
  file = broken;
  await copyClick();
  assert.deepEqual(copied, []);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].error, true);
  assert.match(messages[0].text, /^편집한 배치를 링크로 만들지 못했습니다 \(.+\)\. 'JSON 저장'을 쓰세요\.$/s);
});

test("정상이면 배치를 담은 링크를 복사하고 오류가 아닌 안내를 낸다 (기존 동작)", async () => {
  file = goodFile();
  await copyClick();
  assert.equal(copied.length, 1);
  assert.match(copied[0], /^https:\/\/example\.test\/#seed=a&l=[A-Za-z0-9_-]+$/);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].error, false);
  assert.match(messages[0].text, /편집한 배치까지 담은 링크를 복사했습니다/);
});

test("클립보드를 쓸 수 없으면 기존처럼 오류로 알린다", async () => {
  file = goodFile();
  clipboardFails = true;
  await copyClick();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].error, true);
  assert.match(messages[0].text, /클립보드에 접근할 수 없습니다/);
});
