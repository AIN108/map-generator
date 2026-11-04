import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPlacement, GENERATE_RULES, generateLayout, isPlace, placementContext } from "../src/layout.ts";
import { classifyName } from "../src/program.ts";
import { DENSITY_SCALE, generateSite, riverY } from "../src/site.ts";

const bbox = (pts: [number, number][]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { w: x1 - x0, h: y1 - y0, y0 };
};

test("격자형은 바둑판 길이 많고, 강변형은 동서로 길며 북쪽에 강이 흐른다", () => {
  const classic = generateSite("types", 24);
  const grid = generateSite("types", 24, { type: "grid" });
  const river = generateSite("types", 24, { type: "river" });
  const campus = (s: typeof classic) => s.roads.filter((r) => r.kind === "campus").length;
  assert.ok(campus(grid) > campus(classic) + 3, `격자 길 ${campus(grid)} / 전원형 ${campus(classic)}`);
  assert.equal(grid.type, "grid");
  assert.equal(classic.type, undefined, "전원형은 예전 부지와 같은 모양 (유형 표시 없음)");
  const rb = bbox(river.boundary), cb = bbox(classic.boundary);
  assert.ok(rb.w / rb.h > cb.w / cb.h * 1.25, "강변형은 더 길쭉하다");
  assert.ok(river.water && river.water.width > 50);
  const wy = riverY(river, 0)!;
  assert.ok(wy < rb.y0 - 40, "강은 캠퍼스 경계 북쪽 바깥");
  assert.deepEqual(generateSite("types", 24, { type: "river" }), river, "같은 시드면 같은 부지");
});

test("유형·밀도마다 건물이 규칙대로 놓이고, 격자형·강변형에는 코트·주차빌딩·식당이 나올 수 있다", () => {
  const seen = new Set<string>();
  for (const type of ["classic", "grid", "river"] as const) {
    for (const density of ["loose", "normal", "dense"] as const) {
      for (const seed of ["ct1", "ct2", "ct3"]) {
        const site = generateSite(seed, 28, { type, scale: DENSITY_SCALE[density] });
        const layout = generateLayout(site, { seed, buildings: 28, hospital: true, name: "" });
        const ctx = placementContext(site);
        for (const b of layout.buildings) {
          assert.equal(checkPlacement(ctx, layout.buildings, b, b.id, [], GENERATE_RULES), undefined, `${type}/${density}/${seed} ${b.name}`);
          if (type !== "classic") seen.add(b.type);
          else assert.ok(!["courts", "parking", "cafeteria"].includes(b.type), "전원형은 예전 종류만");
        }
        if (density !== "dense") assert.equal(layout.buildings.filter((b) => !isPlace(b)).length, 28, `${type}/${density}/${seed} 건물 수`);
      }
    }
  }
  assert.ok(seen.has("courts"), "코트");
  assert.ok(seen.has("parking") || seen.has("cafeteria"), "주차빌딩·식당");
  assert.equal(classifyName("테니스장"), "courts");
  assert.equal(classifyName("제2주차빌딩"), "parking");
  assert.equal(classifyName("학생식당"), "cafeteria");
});
