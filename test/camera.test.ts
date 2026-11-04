import assert from "node:assert/strict";
import { test } from "node:test";
import { fitCamera, project, unproject } from "../src/camera.ts";
import { generateSite } from "../src/site.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

for (const view of ["low", "mid", "high"] as const) {
  test(`지면 점을 투영했다가 되돌리면 제자리 (${view})`, () => {
    const site = generateSite("cam", 24);
    const cam = fitCamera(site.boundary, view, 1600, 1200);
    for (const [x, y] of [[0, 0], [300, -200], [-350, 250], [12.5, 99]]) {
      const [sx, sy] = project(cam, x, y, 0);
      const g = unproject(cam, sx, sy)!;
      close(g[0], x, 1e-6);
      close(g[1], y, 1e-6);
    }
  });

  test(`캠퍼스 경계가 이미지 안에 들어온다 (${view})`, () => {
    const site = generateSite("fit", 24);
    const cam = fitCamera(site.boundary, view, 1600, 1200);
    for (const [x, y] of site.boundary) {
      const [sx, sy, depth] = project(cam, x, y, 0);
      assert.ok(depth > 0);
      assert.ok(sx >= 0 && sx <= 1600 && sy >= 0 && sy <= 1200, `${sx}, ${sy}`);
    }
  });
}

test("남쪽(가까운 쪽)이 화면 아래, 높은 곳이 화면 위", () => {
  const site = generateSite("dir", 24);
  const cam = fitCamera(site.boundary, "mid", 1600, 1200);
  assert.ok(project(cam, 0, 100, 0)[1] > project(cam, 0, -100, 0)[1]);
  assert.ok(project(cam, 0, 0, 30)[1] < project(cam, 0, 0, 0)[1]);
});
