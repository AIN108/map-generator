import assert from "node:assert/strict";
import { test } from "node:test";
import { fitCamera } from "../src/camera.ts";
import { layoutToProse } from "../src/export.ts";
import { pointInPolygon, rectCorners } from "../src/geom.ts";
import { generateLayout, isPlace, numberMap } from "../src/layout.ts";
import { extractFromProse } from "../src/program.ts";
import { deriveScene, entrance } from "../src/scene.ts";
import { generateSite } from "../src/site.ts";
import { buildWalkGrid, walkRoute, WALK_SPEED } from "../src/walk.ts";

const setup = (seed: string) => {
  const site = generateSite(seed, 20);
  const layout = generateLayout(site, { seed, buildings: 20, hospital: true, name: "" });
  const scene = deriveScene(site, layout, seed, "forest", fitCamera(site.boundary, "mid", 1600, 1200));
  return { site, layout, scene, grid: buildWalkGrid(scene) };
};

test("걷는 길은 건물을 지나지 않고, 곧은 거리보다 짧지 않다", () => {
  const { layout, grid } = setup("walk");
  const bs = layout.buildings.filter((b) => !isPlace(b));
  let found = 0;
  for (let i = 0; i < 6; i++) {
    const a = bs[i], b = bs[bs.length - 1 - i];
    const from = entrance(a, 4), to = entrance(b, 4);
    const r = walkRoute(grid, from, to);
    if (!r) continue;
    found++;
    assert.ok(r.meters + 1e-6 >= Math.hypot(to[0] - from[0], to[1] - from[1]), "곧은 거리 이상");
    assert.ok(Math.abs(r.minutes - r.meters / WALK_SPEED) < 1e-9);
    // 길 위의 점들이 (출발·도착 건물 말고) 다른 건물 안에 있지 않다
    for (let k = 1; k < r.path.length; k++) {
      const p = r.path[k - 1], q = r.path[k];
      const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 2);
      for (let s = 0; s <= n; s++) {
        const pt: [number, number] = [p[0] + ((q[0] - p[0]) * s) / n, p[1] + ((q[1] - p[1]) * s) / n];
        for (const o of bs) {
          if (o === a || o === b) continue;
          assert.ok(!pointInPolygon(pt, rectCorners(o.x, o.y, o.w - 2, o.d - 2, o.angle)), `${o.name}을(를) 지나감`);
        }
      }
    }
  }
  assert.ok(found >= 5, `길 찾기 ${found}/6`);
});

test("설정 글로 내보낸 것을 다시 읽으면 시설·층수·외관이 같다", () => {
  const { layout, scene, grid } = setup("prose");
  const { text } = layoutToProse(layout, scene, grid);
  assert.match(text, /\| 번호 \| 시설 \| 정문에서/);
  const back = extractFromProse(text).program;
  const numbers = numberMap(layout.buildings);
  const listed = layout.buildings.filter((b) => numbers.has(b.id) && b.shape !== "field");
  for (const b of listed) {
    const it = back.items.find((i) => i.name === b.name);
    assert.ok(it, `${b.name} 빠짐`);
    if (!isPlace(b)) {
      assert.equal(it.floors, b.floors, `${b.name} 층수`);
      if (b.type !== "admin") assert.equal(it.style, b.style, `${b.name} 외관`);
    }
    assert.ok(it.place, `${b.name} 위치`);
  }
  assert.equal(back.name, layout.name);
  assert.equal(back.landmarks.length, new Set(layout.landmarks.map((m) => m.kind)).size);
});
