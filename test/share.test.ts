import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneLayout, toCustom, toSavedFile } from "../src/edit.ts";
import { generateLayout, isPlace } from "../src/layout.ts";
import { decodeShare, encodeShare, MAX_SHARE_CHARS } from "../src/share.ts";
import { generateSite } from "../src/site.ts";

test("편집한 배치를 링크 조각으로 줄였다 풀면 그대로", async () => {
  const seed = "share";
  const site = generateSite(seed, 32);
  const layout = cloneLayout(generateLayout(site, { seed, buildings: 32, hospital: true, name: "" }));
  toCustom(layout, layout.buildings.find((b) => !isPlace(b) && b.type !== "admin")!.id);
  layout.roads = [{ id: 999, kind: "path", pts: [[0, 0], [30, 12], [60, 0]] }];
  layout.nextId = 1000;
  const file = toSavedFile({ seed, buildings: 32, hospital: true, season: "winter", time: "night", view: "high", surround: "city", program: "본관 | 본부\n도서관 | 8층" }, layout);
  const s = await encodeShare(file);
  assert.match(s, /^[A-Za-z0-9_-]+$/, "주소에 그대로 쓸 수 있는 글자");
  assert.ok(s.length < MAX_SHARE_CHARS);
  assert.ok(s.length < JSON.stringify(file).length / 2, `압축 ${s.length} / ${JSON.stringify(file).length}`);
  const back = await decodeShare(s);
  assert.deepEqual(back, file);
});

test("잘리거나 손상된 링크는 알아듣기 쉬운 오류", async () => {
  const seed = "share2";
  const site = generateSite(seed, 12);
  const file = toSavedFile({ seed, buildings: 12, hospital: false, season: "spring", time: "day", view: "mid", surround: "forest" },
    generateLayout(site, { seed, buildings: 12, hospital: false, name: "" }));
  const s = await encodeShare(file);
  await assert.rejects(decodeShare(s.slice(0, Math.floor(s.length / 2))), /손상/);
  await assert.rejects(decodeShare("@@@"), /올바르지/);
  // 형식은 맞지만 내용이 저장 파일이 아니면 검증에서 거절
  const junk = await encodeShare({ format: "campus-map/v1", options: { seed: "" }, layout: {} } as never);
  await assert.rejects(decodeShare(junk), /시드/);
});
