// src/ui/dom.ts·src/ui/dimensions.ts 단위 테스트 (지금 동작을 그대로 고정한다)
import assert from "node:assert/strict";
import { test } from "node:test";
import { fitCamera } from "../src/camera.ts";
import type { Building } from "../src/layout.ts";
import { generateSite } from "../src/site.ts";
import { drawDimensions } from "../src/ui/dimensions.ts";
import { $, download, errorText, safeFileName } from "../src/ui/dom.ts";
import { installDom, recordingContext } from "./helpers/dom.ts";

installDom();

test("$: 있는 요소는 돌려주고, 없으면 id를 담은 오류", () => {
  assert.equal($("map").tagName, "CANVAS");
  assert.throws(() => $("no-such-id"), /#no-such-id 요소가 없습니다/);
});

test("safeFileName: 글자·숫자·_·-만 남기고 40자로 자르며, 비면 campus", () => {
  assert.equal(safeFileName("한빛 대학교/조감도?"), "한빛_대학교_조감도_");
  assert.equal(safeFileName("a-b_c1"), "a-b_c1");
  assert.equal(safeFileName("가".repeat(50)).length, 40);
  assert.equal(safeFileName(""), "campus");
  assert.equal(safeFileName("///"), "_");
});

test("errorText: Error면 message, 아니면 문자열", () => {
  assert.equal(errorText(new Error("문제")), "문제");
  assert.equal(errorText("그냥"), "그냥");
  assert.equal(errorText(42), "42");
});

test("download: 숨은 링크를 만들어 누르고 떼어 낸 뒤 잠시 후 URL을 거둔다", async (t) => {
  const created: string[] = [], revoked: string[] = [], clicked: { name: string; href: string }[] = [];
  t.mock.method(URL, "createObjectURL", () => { created.push("blob:x"); return "blob:x"; });
  t.mock.method(URL, "revokeObjectURL", (u: string) => { revoked.push(u); });
  const proto = (globalThis as unknown as { window: { HTMLAnchorElement: { prototype: { click(): void } } } }).window.HTMLAnchorElement.prototype;
  t.mock.method(proto, "click", function (this: HTMLAnchorElement) { clicked.push({ name: this.download, href: this.getAttribute("href") ?? "" }); });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  download("조감도.png", new Blob(["x"]));
  assert.deepEqual(clicked, [{ name: "조감도.png", href: "blob:x" }]);
  assert.equal(document.querySelectorAll("a[download]").length, 0, "링크는 문서에서 떼어 낸다");
  assert.deepEqual(revoked, []);
  t.mock.timers.tick(1000);
  assert.deepEqual(revoked, ["blob:x"]);
  assert.deepEqual(created, ["blob:x"]);
});

const building = (over: Partial<Building> = {}): Building => ({
  id: 1, type: "humanities", name: "설계관", x: 0, y: 0, angle: 0, w: 60, d: 26, floors: 5, style: "modern", shape: "bar", variant: 0.3, ...over,
});

test("drawDimensions: 폭·깊이 치수를 적고, 높이는 top을 줄 때만 적는다", () => {
  const cam = fitCamera(generateSite("dim", 12).boundary, "mid", 1600, 1200);
  const c1 = recordingContext();
  drawDimensions(c1, cam, building(), 1);
  assert.deepEqual(c1.texts, ["60.0 m", "26.0 m"]);
  const c2 = recordingContext();
  drawDimensions(c2, cam, building({ w: 42.25, d: 18 }), 2, 19.6);
  assert.deepEqual(c2.texts, ["42.3 m", "18.0 m", "H 20 m"]);
  assert.ok(c2.calls.some((k) => k.name === "stroke"));
});
