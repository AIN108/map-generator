import assert from "node:assert/strict";
import { test } from "node:test";
import { fitCamera } from "../src/camera.ts";
import { buildDrawList, computeForest } from "../src/drawlist.ts";
import { pointInPolygon, rectCorners } from "../src/geom.ts";
import { generateLayout, isPlace } from "../src/layout.ts";
import { makePalette } from "../src/palette.ts";
import { deriveScene } from "../src/scene.ts";
import { generateSite } from "../src/site.ts";

const build = (seed: string, surround: "forest" | "city") => {
  const site = generateSite(seed, 20);
  const layout = generateLayout(site, { seed, buildings: 20, hospital: true, name: "" });
  const cam = fitCamera(site.boundary, "mid", 1600, 1200);
  const scene = deriveScene(site, layout, seed, surround, cam);
  return { site, layout, cam, scene };
};

test("캠퍼스 나무는 건물 위에 심지 않는다", () => {
  const { layout, scene } = build("trees", "forest");
  for (const b of layout.buildings) {
    if (isPlace(b)) continue;
    const box = rectCorners(b.x, b.y, b.w, b.d, b.angle);
    for (const t of scene.trees) assert.ok(!pointInPolygon([t.x, t.y], box), `${b.name} 위에 나무`);
  }
});

test("장면과 그리기 목록은 시드로 정해지고 좌표에 NaN이 없다", () => {
  for (const surround of ["forest", "city"] as const) {
    const a = build("det", surround), b = build("det", surround);
    assert.equal(a.scene.trees.length, b.scene.trees.length);
    const pal = makePalette("autumn", "night");
    const dl = buildDrawList(a.scene, a.cam, pal, "det", computeForest(a.scene, a.cam, "det"));
    assert.ok(dl.cmds.length > 100);
    for (const c of dl.cmds) {
      if (c.k === "fill" || c.k === "line") for (const p of c.paths) assert.ok(p.every(Number.isFinite));
      if (c.k === "trees" || c.k === "ellipses") assert.ok(c.data.every(Number.isFinite));
    }
    assert.equal(dl.labels.length, a.layout.buildings.length);
    assert.deepEqual(dl.labels.map((l) => l.no), a.layout.buildings.map((_, i) => i + 1));
  }
});
