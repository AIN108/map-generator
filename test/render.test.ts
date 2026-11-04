// 그리기 회귀 검사: 몇 가지 시드·보기로 만든 그리기 목록의 요약(명령 종류별 개수, 좌표 해시)이 저장된 값과 같은지 본다.
// 그림을 일부러 바꿨다면 `UPDATE_GOLDEN=1 npm test`로 저장값을 새로 쓴다.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fitCamera, type ViewAngle } from "../src/camera.ts";
import { buildDrawList, computeForest } from "../src/drawlist.ts";
import { generateLayout } from "../src/layout.ts";
import { makePalette, type Season, type TimeOfDay } from "../src/palette.ts";
import { deriveScene, type Surround } from "../src/scene.ts";
import { generateSite } from "../src/site.ts";

const GOLDEN = new URL("./golden/drawlist.json", import.meta.url);
const CASES: { seed: string; n: number; season: Season; time: TimeOfDay; view: ViewAngle; surround: Surround }[] = [
  { seed: "golden-a", n: 24, season: "spring", time: "day", view: "mid", surround: "forest" },
  { seed: "golden-b", n: 32, season: "winter", time: "night", view: "high", surround: "city" },
  { seed: "golden-c", n: 12, season: "autumn", time: "dusk", view: "low", surround: "forest" },
];

function summary(c: (typeof CASES)[number]): Record<string, unknown> {
  const site = generateSite(c.seed, c.n);
  const layout = generateLayout(site, { seed: c.seed, buildings: c.n, hospital: true, name: "" });
  const cam = fitCamera(site.boundary, c.view, 1600, 1200);
  const scene = deriveScene(site, layout, c.seed, c.surround, cam);
  const dl = buildDrawList(scene, cam, makePalette(c.season, c.time), c.seed, computeForest(scene, cam, c.seed));
  const kinds: Record<string, number> = {};
  const h = createHash("sha1");
  const q = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);
  for (const cmd of dl.cmds) {
    kinds[cmd.k] = (kinds[cmd.k] ?? 0) + 1;
    h.update(cmd.k);
    for (const [k, v] of Object.entries(cmd)) {
      if (v instanceof Float32Array) for (let i = 0; i < v.length; i += 1) h.update(q(v[i]));
      else if (Array.isArray(v)) for (const p of v) h.update(p instanceof Float32Array ? Array.from(p, q).join(",") : String(p));
      else if (k !== "k") h.update(String(v));
    }
  }
  h.update(JSON.stringify(dl.labels.map((l) => [l.no, l.name, q(l.x), q(l.y)])));
  return { buildings: layout.buildings.length, trees: scene.trees.length, kinds, hash: h.digest("hex").slice(0, 16) };
}

test("그리기 목록이 저장된 요약과 같다 (그림을 일부러 바꿨으면 UPDATE_GOLDEN=1)", () => {
  const now = Object.fromEntries(CASES.map((c) => [`${c.seed}/${c.n}/${c.season}/${c.time}/${c.view}/${c.surround}`, summary(c)]));
  if (process.env.UPDATE_GOLDEN === "1" || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(now, null, 2) + "\n");
    return;
  }
  const saved = JSON.parse(readFileSync(GOLDEN, "utf8"));
  assert.deepEqual(now, saved);
});
