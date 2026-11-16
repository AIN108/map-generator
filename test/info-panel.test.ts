import assert from "node:assert/strict";
import { test } from "node:test";
import { generateLayout, isPlace, numberMap } from "../src/layout.ts";
import { generateSite } from "../src/site.ts";
import { gridCell } from "../src/siteplan.ts";
import { infoRows } from "../src/ui/infoPanel.ts";

const site = generateSite("info", 14);
const layout = generateLayout(site, { seed: "info", buildings: 14, hospital: false, name: "" });

test("고른 것이 없거나 배치가 없으면 안내 한 줄", () => {
  const hint = [["안내", "건물에 마우스를 올리거나 눌러 보세요."]];
  assert.deepEqual(infoRows(layout, site, undefined), hint);
  assert.deepEqual(infoRows(undefined, site, { kind: "building", id: 1 }), hint);
});

test("건물: 번호·이름·용도·배치도 칸·층수·바닥·연면적·외관 순서", () => {
  const b = layout.buildings.find((x) => !isPlace(x))!;
  const rows = infoRows(layout, site, { kind: "building", id: b.id });
  assert.deepEqual(rows.map((r) => r[0]), ["번호", "이름", "용도", "배치도 칸", "층수", "바닥", "연면적", "외관"]);
  assert.equal(rows[0][1], `${numberMap(layout.buildings).get(b.id)}번`);
  assert.equal(rows[1][1], b.name);
  assert.equal(rows[3][1], gridCell({ site }, b.x, b.y));
  assert.match(rows[4][1], new RegExp(`^지상 ${b.floors}층 \\(높이 약 \\d+ m\\)$`));
  // 부지가 없으면 배치도 칸은 뺀다
  assert.ok(!infoRows(layout, undefined, { kind: "building", id: b.id }).some((r) => r[0] === "배치도 칸"));
});

test("광장·운동장은 크기만, 상징물은 이름·설명, 없는 id는 빈 목록", () => {
  const place = layout.buildings.find((x) => isPlace(x))!;
  const rows = infoRows(layout, site, { kind: "building", id: place.id });
  assert.equal(rows[rows.length - 1][0], "크기");
  assert.ok(!rows.some((r) => r[0] === "층수"));
  const m = layout.landmarks[0];
  assert.deepEqual(infoRows(layout, site, { kind: "landmark", id: m.id }).map((r) => r[0]), ["상징물", "설명"]);
  assert.deepEqual(infoRows(layout, site, { kind: "building", id: 999999 }), []);
});
