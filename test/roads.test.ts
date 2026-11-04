import assert from "node:assert/strict";
import { test } from "node:test";
import { fitCamera } from "../src/camera.ts";
import { addRoad, cloneLayout, layoutFromJSON, paintTrees, removeRoad, restoreRoads } from "../src/edit.ts";
import { checkPlacement, EDIT_RULES, generateLayout, isPlace, placementContext } from "../src/layout.ts";
import { effectiveSite, roadAt } from "../src/roads.ts";
import { deriveScene } from "../src/scene.ts";
import { generateSite } from "../src/site.ts";

const setup = () => {
  const seed = "roads";
  const site = generateSite(seed, 20);
  const layout = generateLayout(site, { seed, buildings: 20, hospital: true, name: "" });
  return { seed, site, layout, cam: fitCamera(site.boundary, "mid", 1600, 1200) };
};

test("그린 길은 부지 도로가 되어 건물을 그 위에 둘 수 없다", () => {
  const { site, layout } = setup();
  const l = cloneLayout(layout);
  const b = l.buildings.find((x) => !isPlace(x) && x.type !== "admin")!;
  assert.equal(checkPlacement(placementContext(effectiveSite(site, l)), l.buildings, b, b.id, [], EDIT_RULES), undefined);
  // 건물을 지나가는 길은 받지 않는다
  assert.equal(addRoad(l, "road", [[b.x - 60, b.y], [b.x + 60, b.y]]).ok, false);
  const moved = cloneLayout(l);
  moved.buildings = moved.buildings.filter((x) => x.id !== b.id);
  const r = addRoad(moved, "road", [[b.x - 60, b.y], [b.x + 60, b.y]]);
  assert.equal(r.ok, true, r.message);
  l.roads = moved.roads;
  l.nextId = moved.nextId;
  const es = effectiveSite(site, l);
  assert.equal(es.roads.length, site.roads.length + 1);
  assert.equal(effectiveSite(site, l), es, "같은 편집이면 같은 부지 객체");
  assert.equal(checkPlacement(placementContext(es), l.buildings, b, b.id, [], EDIT_RULES), "road");
  // 지우기
  const hit = roadAt(site, l, b.x, b.y)!;
  assert.equal(hit.custom, r.id);
  assert.equal(removeRoad(l, hit).ok, true);
  assert.equal(effectiveSite(site, l).roads.length, site.roads.length);
});

test("캠퍼스 도로는 숨길 수 있지만 순환도로·간선도로는 지울 수 없다", () => {
  const { site, layout } = setup();
  const l = cloneLayout(layout);
  const idx = site.roads.findIndex((r) => r.kind === "campus" && !r.closed);
  assert.ok(idx > 0);
  const p = site.roads[idx].pts[Math.floor(site.roads[idx].pts.length / 2)];
  const hit = roadAt(site, l, p[0], p[1])!;
  assert.equal(hit.siteIndex, idx);
  removeRoad(l, hit);
  assert.equal(effectiveSite(site, l).roads.length, site.roads.length - 1);
  const ring = site.roads.find((r) => r.kind === "ring")!;
  const rp = ring.pts[10];
  const ringHit = roadAt(site, l, rp[0], rp[1], 2);
  assert.ok(!ringHit || ringHit.siteIndex !== site.roads.indexOf(ring), "순환도로는 고르지 않는다");
  assert.equal(restoreRoads(l).ok, true);
  assert.equal(effectiveSite(site, l), site);
});

test("나무 베기·심기, 나중에 칠한 것이 앞선다", () => {
  const { seed, site, layout, cam } = setup();
  const l = cloneLayout(layout);
  const base = deriveScene(site, l, seed, "forest", cam).trees;
  const t = base[Math.floor(base.length / 2)];
  const inCircle = (trees: typeof base, x: number, y: number, r: number) => trees.filter((q) => Math.hypot(q.x - x, q.y - y) < r).length;
  assert.ok(inCircle(base, t.x, t.y, 25) > 0);
  paintTrees(l, "clear", [{ x: t.x, y: t.y, r: 25 }]);
  assert.equal(inCircle(deriveScene(site, l, seed, "forest", cam).trees, t.x, t.y, 25), 0, "벤 곳에는 나무가 없다");
  paintTrees(l, "plant", [{ x: t.x, y: t.y, r: 25 }]);
  assert.equal(l.clearings, undefined, "심은 곳 안의 베기 표시는 지워진다");
  assert.ok(inCircle(deriveScene(site, l, seed, "forest", cam).trees, t.x, t.y, 25) > 0, "다시 심었다");
});

test("길·나무 편집도 JSON으로 저장·검증된다", () => {
  const { layout } = setup();
  const l = cloneLayout(layout);
  assert.equal(addRoad(l, "path", [[3000, 0], [3010, 10], [3020, 0]]).ok, true);
  l.hiddenRoads = [3];
  paintTrees(l, "plant", [{ x: 5, y: 5, r: 20 }]);
  const back = layoutFromJSON(JSON.parse(JSON.stringify(l)));
  assert.deepEqual(back, cloneLayout(l));
  assert.throws(() => layoutFromJSON({ ...JSON.parse(JSON.stringify(l)), roads: [{ id: 999, kind: "road", pts: [[0, 0]] }] }));
  assert.throws(() => layoutFromJSON({ ...JSON.parse(JSON.stringify(l)), groves: [{ x: 0, y: 0, r: 999 }] }));
  assert.throws(() => layoutFromJSON({ ...JSON.parse(JSON.stringify(l)), roads: [{ id: l.buildings[0].id, kind: "road", pts: [[0, 0], [5, 5]] }] }), /id/);
});
