import assert from "node:assert/strict";
import { test } from "node:test";
import { convexOverlap, pointInPolygon } from "../src/geom.ts";
import { footprint, generateLayout, isPlace } from "../src/layout.ts";
import { generateSite } from "../src/site.ts";

const make = (seed: string, buildings = 24, hospital = true) => {
  const site = generateSite(seed, buildings);
  return { site, layout: generateLayout(site, { seed, buildings, hospital, name: "" }) };
};

test("같은 시드와 옵션이면 같은 배치", () => {
  assert.deepEqual(make("same").layout, make("same").layout);
  assert.notDeepEqual(make("a").layout.buildings, make("b").layout.buildings);
});

test("1~4번은 대학본부·중앙광장·중앙도서관·학생회관", () => {
  const { layout } = make("order");
  assert.deepEqual(layout.buildings.slice(0, 4).map((b) => b.type), ["admin", "plaza", "library", "union"]);
});

for (const seed of ["s1", "s2", "s3", "campus", "미적분"]) {
  test(`건물끼리 겹치지 않고 순환도로 안에 있다 (${seed})`, () => {
    const { site, layout } = make(seed, 30);
    const polys = layout.buildings.map(footprint);
    for (let i = 0; i < polys.length; i++) {
      for (const p of polys[i]) assert.ok(pointInPolygon(p, site.ring), `${layout.buildings[i].name}이 순환도로 밖`);
      for (let j = i + 1; j < polys.length; j++) {
        assert.ok(!convexOverlap(polys[i], polys[j], 1), `${layout.buildings[i].name} ↔ ${layout.buildings[j].name}`);
      }
    }
    // 대학 문장 기념물은 정문 앞(캠퍼스 경계 밖) 광장에 둔다.
    for (const m of layout.landmarks) if (m.kind !== "emblem") assert.ok(pointInPolygon([m.x, m.y], site.boundary), `${m.name}이 캠퍼스 밖`);
    const ids = [...layout.buildings.map((b) => b.id), ...layout.landmarks.map((m) => m.id)];
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => id < layout.nextId));
  });
}

test("건물 수 옵션과 병원 옵션을 따른다", () => {
  for (const n of [10, 18, 32]) {
    const { layout } = make(`count${n}`, n);
    const count = layout.buildings.filter((b) => !isPlace(b)).length;
    assert.ok(count >= n - 2 && count <= n, `${n} 요청 → ${count}`);
  }
  const noMed = make("nomed", 32, false).layout;
  assert.ok(!noMed.buildings.some((b) => ["hospital", "med", "nursingLec", "nursingLab", "pharmacy"].includes(b.type)));
  const med = make("med", 24, true).layout;
  assert.ok(med.buildings.some((b) => b.type === "hospital"));
  assert.ok(med.buildings.find((b) => b.type === "hospital")!.name.startsWith(med.name));
});
