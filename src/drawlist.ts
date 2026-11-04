// 장면을 카메라로 투영해 2차원 그리기 명령 목록으로 만든다 (이미지 픽셀 좌표).
// 확대·이동할 때는 이 목록을 변환만 바꿔 다시 칠하면 되므로 투영은 장면이 바뀔 때만 한다.

import { type Camera, horizonY, project, unproject } from "./camera.ts";
import type { LandmarkKind } from "./catalog.ts";
import { convexHull, localToWorld, pointInPolygon, rectCorners, ribbon, segmentDistance, type Vec2 } from "./geom.ts";
import { isPlace, numberMap, type Building } from "./layout.ts";
import type { Face, Model, P3 } from "./model.ts";
import { mix, raw, shade, tone, type Palette, type RGB } from "./palette.ts";
import { cellHash, createNoise2D, subRng } from "./rng.ts";
import type { Scene, Tree } from "./scene.ts";

export type Cmd =
  | { k: "fill"; paths: Float32Array[]; fill: string; stroke?: string; lw?: number; evenodd?: boolean }
  | { k: "line"; paths: Float32Array[]; stroke: string; lw: number; dash?: number[]; cap?: CanvasLineCap }
  | { k: "trees"; data: Float32Array; n: number }
  | { k: "ellipses"; data: Float32Array; fill: string }
  | { k: "sky"; y: number; top: string; bottom: string }
  | { k: "haze"; to: number; color: string }
  | { k: "glow"; data: Float32Array; color: string }
  | { k: "globe"; x: number; y: number; r: number };

/** 이름표 자리. dx·dy가 있으면 손으로 옮긴 자리 (이름표 왼쪽 위 - 기준점, 기본 글자 크기 픽셀) */
export interface LabelAnchor { no: number; id: number; name: string; x: number; y: number; core: boolean; dx?: number; dy?: number; hidden?: boolean }
export interface PointAnchor {
  id: number; name: string; x: number; y: number; kind: LandmarkKind | "gate" | "place"; dx?: number; dy?: number; hidden?: boolean;
}
export interface Hit { id: number; hull: Float32Array; landmark?: boolean }

export interface DrawList {
  width: number;
  height: number;
  palette: Palette;
  cmds: Cmd[];
  labels: LabelAnchor[];
  points: PointAnchor[];
  hits: Hit[];
  /** 나무 색 (그릴 때 고른다): [종류][묶음] = [그늘, 기본, 밝은 면] */
  treeColors: string[][][];
}

const TREE_STRIDE = 6;

/** 산 지형 사각형과 숲 나무 (색과 무관해 계절·시간을 바꿔도 다시 쓴다) */
export interface Forest { quads: { pts: Float32Array; b: number; row: number }[]; trees: Tree[] }

export function buildDrawList(scene: Scene, cam: Camera, pal: Palette, seed: string, forest?: Forest): DrawList {
  const cmds: Cmd[] = [];
  const P = (x: number, y: number, z = 0): [number, number, number] => project(cam, x, y, z);
  const flat = (pts: readonly (readonly number[])[], z = 0): Float32Array => {
    const a = new Float32Array(pts.length * 2);
    pts.forEach((p, i) => {
      const q = P(p[0], p[1], p.length > 2 ? p[2] : z);
      a[i * 2] = q[0];
      a[i * 2 + 1] = q[1];
    });
    return a;
  };
  const fill = (paths: Float32Array[], c: string, extra: Partial<Extract<Cmd, { k: "fill" }>> = {}): void => {
    if (paths.length) cmds.push({ k: "fill", paths, fill: c, ...extra });
  };
  const line = (paths: Float32Array[], c: string, lw: number, extra: Partial<Extract<Cmd, { k: "line" }>> = {}): void => {
    if (paths.length) cmds.push({ k: "line", paths, stroke: c, lw, ...extra });
  };
  const site = scene.site;
  const W = cam.width, H = cam.height;
  const hy = horizonY(cam);

  // ── 하늘·바탕 ──
  if (hy > -40) cmds.push({ k: "sky", y: hy, top: tone(pal, pal.sky[0]), bottom: tone(pal, pal.sky[1]) });
  const baseColor = scene.surround === "city" ? pal.cityGround : pal.forestFloor;
  cmds.push({ k: "fill", paths: [new Float32Array([-10, Math.max(-10, hy), W + 10, Math.max(-10, hy), W + 10, H + 10, -10, H + 10])], fill: tone(pal, baseColor) });

  // ── 산 지형 (숲 모드) ──
  const fr = forest ?? computeForest(scene, cam, seed);
  const forestTrees = fr.trees;
  {
    let row = -1;
    let groups = new Map<number, Float32Array[]>();
    const flush = (): void => {
      for (const [b, paths] of groups) {
        const k = 0.55 + (b / (HILL_BUCKETS - 1)) * 0.7;
        const c = mix(pal.forestFloor, pal.forestHill, 0.5).map((v) => v * k) as RGB;
        cmds.push({ k: "fill", paths, fill: tone(pal, c) });
      }
      groups = new Map();
    };
    for (const q of fr.quads) {
      if (q.row !== row) { flush(); row = q.row; }
      let g = groups.get(q.b);
      if (!g) groups.set(q.b, (g = []));
      g.push(q.pts);
    }
    flush();
  }

  // ── 도시 바닥·거리 ──
  for (const g of scene.cityGround) fill([flat(g)], tone(pal, pal.cityGround));
  const streetPaths = scene.streets.map((s) => flat(ribbon(s.pts, s.width / 2 + 2.5)));
  fill(streetPaths, tone(pal, mix(pal.cityGround, [236, 234, 228], 0.5)));
  fill(scene.streets.map((s) => flat(ribbon(s.pts, s.width / 2))), tone(pal, pal.road, 0.92));

  // ── 캠퍼스 바닥 ──
  fill([flat(site.boundary)], tone(pal, pal.lawn), { stroke: tone(pal, pal.lawn, 0.8), lw: 1 });
  lawnPatches(scene, pal, seed, cmds, flat);

  // 정문 앞 광장 (경계에서 간선도로까지)
  const gy = site.gateS[1];
  fill([flat([[-48, gy - 30], [48, gy - 30], [56, site.arterialY - 14], [-56, site.arterialY - 14]])], tone(pal, pal.plaza));
  // 중심축 산책로
  drawAxis(scene, pal, fill, line, flat);
  // 포장 마당
  fill(scene.aprons.map((p) => flat(p)), tone(pal, pal.paving));
  // 광장·운동장
  for (const b of scene.layout.buildings) {
    if (b.shape === "plaza") drawPlaza(b, pal, fill, line, flat);
    else if (b.shape === "field") drawFieldGround(b, pal, fill, line, flat);
  }
  // 연못·기념비 둘레·문장
  for (const l of scene.layout.landmarks) drawLandmarkGround(l.kind, l.x, l.y, pal, fill, line, flat, seed);

  // ── 도로 ──
  for (const road of site.roads) {
    if (road.kind === "street") continue;
    if (road.kind === "path") {
      fill([flat(ribbon(road.pts, road.width / 2))], tone(pal, pal.walkway), { stroke: tone(pal, pal.walkway, 0.88), lw: 0.4 });
      continue;
    }
    const z = road.kind === "forest" ? (x: number, y: number) => scene.height(x, y) : () => 0;
    const rib = ribbon(road.pts, road.width / 2 + 1.6, road.closed).map((p) => [p[0], p[1], z(p[0], p[1])]);
    fill([flat(rib)], tone(pal, road.kind === "arterial" ? pal.roadEdge : pal.roadEdge));
    const core = ribbon(road.pts, road.width / 2, road.closed).map((p) => [p[0], p[1], z(p[0], p[1])]);
    fill([flat(core)], tone(pal, road.kind === "arterial" ? pal.arterial : pal.road));
  }
  // 간선도로 차선·횡단보도
  {
    const ay = site.arterialY;
    const dashes: Float32Array[] = [];
    for (const off of [-9, -4.5, 4.5, 9]) {
      for (let x = -2400; x < 2400; x += 14) {
        if (Math.abs(x) < 20) continue;
        dashes.push(flat([[x, ay + off - 0.25], [x + 7, ay + off - 0.25], [x + 7, ay + off + 0.25], [x, ay + off + 0.25]]));
      }
    }
    fill(dashes, tone(pal, pal.marking, 0.95));
    fill([flat([[-2400, ay - 0.9], [2400, ay - 0.9], [2400, ay - 0.3], [-2400, ay - 0.3]]), flat([[-2400, ay + 0.3], [2400, ay + 0.3], [2400, ay + 0.9], [-2400, ay + 0.9]])], tone(pal, [236, 196, 70]));
    const zebra: Float32Array[] = [];
    for (let x = -14; x <= 14; x += 3) zebra.push(flat([[x, ay - 14], [x + 1.6, ay - 14], [x + 1.6, ay + 14], [x, ay + 14]]));
    fill(zebra, tone(pal, pal.marking));
  }
  // 순환도로 가운데 점선
  {
    const ring = site.ring;
    const dashes: Float32Array[] = [];
    for (let i = 0; i < ring.length; i += 2) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      dashes.push(flat(ribbon([a, [a[0] + (b[0] - a[0]) * 0.6, a[1] + (b[1] - a[1]) * 0.6]], 0.25)));
    }
    fill(dashes, tone(pal, pal.marking, 0.95));
  }
  // 산책로
  fill(scene.walkways.map((w) => flat(ribbon(w, 2.2))), tone(pal, pal.walkway));
  // 주차장
  for (const p of scene.parkings) drawParking(p, pal, fill, line, flat, seed);

  // ── 그림자 ──
  const sun = pal.sun;
  const sdx = -sun[0] / Math.max(0.2, sun[2]), sdy = -sun[1] / Math.max(0.2, sun[2]);
  const shadowPaths: Float32Array[] = [];
  for (const b of scene.layout.buildings) {
    const m = scene.models.get(b.id);
    if (!m) continue;
    for (const part of m.parts) {
      const pts: Vec2[] = [];
      for (const f of part.faces) for (const p of f.pts) { pts.push([p[0], p[1]]); pts.push([p[0] + sdx * p[2], p[1] + sdy * p[2]]); }
      if (pts.length >= 3) shadowPaths.push(flat(convexHull(pts)));
    }
  }
  for (const c of scene.city) {
    const poly = rectCorners(c.x, c.y, c.w, c.d, c.angle);
    const pts: Vec2[] = [...poly, ...poly.map((p) => [p[0] + sdx * c.h, p[1] + sdy * c.h] as Vec2)];
    shadowPaths.push(flat(convexHull(pts)));
  }
  fill(shadowPaths, `rgba(20,30,50,${pal.shadowAlpha})`);
  // 숲 나무는 부지마다 한 번만 만들어 두므로 '나무 베기' 자리는 여기서 거른다.
  const cuts = scene.layout.clearings ?? [];
  const allTrees = scene.trees.concat(cuts.length
    ? forestTrees.filter((t) => !cuts.some((c) => Math.abs(c.x - t.x) < c.r && Math.abs(c.y - t.y) < c.r && Math.hypot(c.x - t.x, c.y - t.y) < c.r))
    : forestTrees);
  {
    const data: number[] = [];
    for (const t of allTrees) {
      const h = treeHeight(t);
      const g = P(t.x + sdx * h * 0.8, t.y + sdy * h * 0.8, t.z);
      const r = (cam.f / Math.max(1, g[2])) * t.r;
      if (g[0] < -40 || g[0] > W + 40 || g[1] < -40 || g[1] > H + 40) continue;
      data.push(g[0], g[1], r * 1.05, r * 0.7);
    }
    cmds.push({ k: "ellipses", data: new Float32Array(data), fill: `rgba(20,30,40,${pal.shadowAlpha * 0.85})` });
  }

  // ── 물체 (멀리 있는 것부터) ──
  interface Item { depth: number; kind: 0 | 1 | 2 | 3 | 4; i: number }
  const items: Item[] = [];
  const buildings = scene.layout.buildings;
  buildings.forEach((b, i) => {
    if (isPlace(b) && b.shape !== "field") return;
    const poly = rectCorners(b.x, b.y, b.w, b.d, b.angle);
    let dmin = Infinity;
    for (const p of poly) dmin = Math.min(dmin, P(p[0], p[1])[2]);
    items.push({ depth: dmin, kind: 0, i });
  });
  allTrees.forEach((t, i) => {
    const q = P(t.x, t.y, t.z);
    if (q[0] < -60 || q[0] > W + 60 || q[1] < -80 || q[1] > H + 60) return;
    items.push({ depth: q[2], kind: 1, i });
  });
  scene.layout.landmarks.forEach((l, i) => items.push({ depth: P(l.x, l.y)[2] - 1, kind: 2, i }));
  scene.city.forEach((c, i) => {
    const poly = rectCorners(c.x, c.y, c.w, c.d, c.angle);
    let dmin = Infinity;
    for (const p of poly) dmin = Math.min(dmin, P(p[0], p[1])[2]);
    items.push({ depth: dmin, kind: 3, i });
  });
  items.push({ depth: P(0, site.gateS[1])[2] - 2, kind: 4, i: 0 });
  items.push({ depth: P(0, site.gateN[1])[2] - 2, kind: 4, i: 1 });
  items.sort((a, b) => b.depth - a.depth);

  const hits: Hit[] = [];
  const labels: LabelAnchor[] = [];
  const points: PointAnchor[] = [];
  let treeBuf: number[] = [];
  const flushTrees = (): void => {
    if (!treeBuf.length) return;
    cmds.push({ k: "trees", data: new Float32Array(treeBuf), n: treeBuf.length / TREE_STRIDE });
    treeBuf = [];
  };
  // 종류(0~3) + 음영 단계 × 4 → 색 표 번호
  const kindIndex = (t: Tree): number => t.kind + 4 * (t.s ?? 1);
  const groupCount = [pal.deciduous.length, pal.conifer.length, pal.blossom.length, pal.avenue.length];
  for (const it of items) {
    if (it.kind === 1) {
      const t = allTrees[it.i];
      const h = treeHeight(t);
      const q = P(t.x, t.y, t.z + h);
      const base = P(t.x, t.y, t.z);
      const r = (cam.f / Math.max(1, q[2])) * t.r;
      const ki = kindIndex(t);
      const gc = groupCount[t.kind];
      treeBuf.push(q[0], q[1], r, ki, Math.floor(t.c * gc) % gc, base[1] - q[1]);
      if (treeBuf.length >= 64 * TREE_STRIDE) flushTrees();
      continue;
    }
    flushTrees();
    if (it.kind === 0) {
      const b = buildings[it.i];
      if (b.shape === "field") { drawStands(b, cam, pal, cmds); continue; }
      const m = scene.models.get(b.id);
      if (!m) continue;
      const hull = drawModel(m, cam, pal, cmds, b);
      hits.push({ id: b.id, hull });
    } else if (it.kind === 2) {
      const l = scene.layout.landmarks[it.i];
      drawLandmark(l.kind, l.x, l.y, cam, pal, cmds);
      const s = P(l.x, l.y, landmarkHeight(l.kind));
      const g = P(l.x, l.y, 0);
      points.push({ id: l.id, name: l.name, x: s[0], y: s[1], kind: l.kind, dx: l.labelDx, dy: l.labelDy, hidden: l.labelHidden });
      const rr = Math.max(6, (cam.f / g[2]) * 7);
      hits.push({ id: l.id, landmark: true, hull: new Float32Array([g[0] - rr, s[1] - rr, g[0] + rr, s[1] - rr, g[0] + rr, g[1] + rr * 0.5, g[0] - rr, g[1] + rr * 0.5]) });
    } else if (it.kind === 3) {
      drawCityBox(scene.city[it.i], cam, pal, cmds);
    } else {
      const north = it.i === 1;
      const y = north ? site.gateN[1] : site.gateS[1];
      drawGate(y, north, cam, pal, cmds);
      const top = P(0, y, north ? 7 : 10);
      points.push({ id: north ? -2 : -1, name: north ? "후문" : "정문", x: top[0], y: top[1], kind: "gate" });
    }
  }
  flushTrees();

  // ── 밤: 가로등 빛 ──
  if (pal.time === "night") {
    const data: number[] = [];
    for (const l of scene.lamps) {
      const q = P(l[0], l[1], 6);
      data.push(q[0], q[1], Math.max(3, (cam.f / q[2]) * 9));
    }
    cmds.push({ k: "glow", data: new Float32Array(data), color: "255,214,150" });
  }
  // ── 먼 곳 대기 원근 ──
  cmds.push({ k: "haze", to: H * 0.32, color: tone(pal, pal.haze) });

  // ── 라벨 위치 ──
  const numbers = numberMap(buildings);
  buildings.forEach((b) => {
    let top: P3;
    if (isPlace(b)) top = [b.x, b.y, b.shape === "field" ? 6 : 2];
    else top = scene.models.get(b.id)?.top ?? [b.x, b.y, 10];
    const q = P(top[0], top[1], top[2]);
    const no = numbers.get(b.id);
    // 번호 없는 시설은 상징물처럼 이름만 단다.
    const extra = { dx: b.labelDx, dy: b.labelDy, hidden: b.labelHidden };
    if (no === undefined) points.push({ id: b.id, name: b.name, x: q[0], y: q[1], kind: "place", ...extra });
    else labels.push({ no, id: b.id, name: b.name, x: q[0], y: q[1], core: no <= 4, ...extra });
    if (isPlace(b)) {
      const poly = rectCorners(b.x, b.y, b.w, b.d, b.angle);
      hits.push({ id: b.id, hull: flat(poly) });
    }
  });

  const treeColors: string[][][] = [];
  for (const k of [0.8, 1, 1.12]) {
    for (const groups of [pal.deciduous, pal.conifer, pal.blossom, pal.avenue]) {
      treeColors.push(groups.map((g) => g.map((c) => tone(pal, c, k))));
    }
  }
  return { width: W, height: H, palette: pal, cmds, labels, points, hits, treeColors };
}

export const treeHeight = (t: Tree): number => t.r * (t.kind === 1 ? 1.5 : 1.25) + 1.2;

// ── 지형과 산 숲 ────────────────────────────────────────────────────
const HILL_BUCKETS = 9;

export function computeForest(scene: Scene, cam: Camera, seed: string): Forest {
  const trees: Tree[] = [];
  const quads: Forest["quads"] = [];
  if (scene.surround !== "forest") {
    bufferTrees(scene, seed, trees);
    return { quads, trees };
  }
  const site = scene.site;
  const W = cam.width, H = cam.height;
  const step = 14;
  const hash = cellHash(seed, "forest");
  // 음영은 낮 기준 해 방향으로 고정한다 (색만 시간대에 따라 바뀐다).
  const sun = [-0.55, 0.5, 0.68];
  const sl = Math.hypot(sun[0], sun[1], sun[2]);
  const rowsTop = Math.max(-60, horizonY(cam) + 6);
  const roads = site.roads.filter((r) => r.kind !== "street");
  type GP = { x: number; y: number; z: number; sx: number; sy: number } | undefined;
  let prev: GP[] | undefined;
  let rowIndex = 0;
  for (let sy = rowsTop; sy <= H + step; sy += step, rowIndex++) {
    const cur: GP[] = [];
    for (let sx = -step * 2; sx <= W + step * 2; sx += step) {
      const g = unproject(cam, sx, sy);
      if (!g || Math.hypot(g[0] - cam.cx, g[1] - cam.cy) > 6000) { cur.push(undefined); continue; }
      const z = scene.height(g[0], g[1]);
      const q = project(cam, g[0], g[1], z);
      cur.push({ x: g[0], y: g[1], z, sx: q[0], sy: q[1] });
    }
    if (prev) {
      for (let i = 0; i + 1 < cur.length; i++) {
        const a = prev[i], b = prev[i + 1], c = cur[i + 1], d = cur[i];
        if (!a || !b || !c || !d) continue;
        if (a.z + b.z + c.z + d.z < 0.5) continue; // 평지는 바탕색으로 충분
        const dzx = (b.z - a.z + c.z - d.z) / 2 / Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
        const dzy = (d.z - a.z + c.z - b.z) / 2 / Math.max(1, Math.hypot(d.x - a.x, d.y - a.y));
        const n = [-dzx, -dzy, 1];
        const nl = Math.hypot(n[0], n[1], n[2]);
        const lit = (n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]) / nl / sl;
        const k = Math.max(0.55, Math.min(1.25, 0.55 + 0.75 * lit));
        quads.push({ pts: new Float32Array([a.sx, a.sy, b.sx, b.sy, c.sx, c.sy, d.sx, d.sy]), b: Math.round(((k - 0.55) / 0.7) * (HILL_BUCKETS - 1)), row: rowIndex });
      }
    }
    // 숲 나무: 화면에서 고른 밀도로 (멀수록 실제 크기가 큰 나무로 친다)
    for (let i = 0; i + 1 < cur.length; i++) {
      const a = cur[i], b = cur[i + 1];
      if (!a || !b) continue;
      for (let s = 0; s < 2; s++) {
        const key = rowIndex * 1000 + i * 2 + s;
        const u = hash(key), v = hash(key + 500000);
        const g2 = unproject(cam, a.sx + (b.sx - a.sx) * u, sy + step * v);
        if (!g2) continue;
        const [x, y] = g2;
        if (!inForest(scene, x, y, roads)) continue;
        const depth = project(cam, x, y, 0)[2];
        const rpx = 6.2 + hash(key + 900000) * 3.2;
        const r = Math.min(16, Math.max(2.6, (rpx * depth) / cam.f));
        const z = scene.height(x, y);
        const roll = hash(key + 1300000);
        // 비탈 방향에 따라 그늘·양지 (해가 남서쪽에 있다)
        const e = 6;
        const gx = (scene.height(x + e, y) - scene.height(x - e, y)) / (2 * e);
        const gy = (scene.height(x, y + e) - scene.height(x, y - e)) / (2 * e);
        const lit = (-gx * sun[0] - gy * sun[1] + sun[2]) / Math.hypot(gx, gy, 1) / sl;
        const sh = lit < 0.72 ? 0 : lit > 0.9 ? 2 : 1;
        trees.push({ x, y, z, r, kind: roll < 0.3 + Math.min(0.35, z / 400) ? 1 : 0, c: hash(key + 1700000), s: z > 1 ? sh : 1 });
      }
    }
    prev = cur;
  }
  return { quads, trees };
}

function inForest(scene: Scene, x: number, y: number, roads: Scene["site"]["roads"]): boolean {
  const site = scene.site;
  if (y > site.arterialY - site.roads[0].width / 2 - 6) return false;
  const e = Math.hypot(x / site.rx, y / site.ry);
  if (e < 1.12 && pointInPolygon([x, y], site.boundary)) return false;
  if (e < 1.2) {
    // 정문 앞 광장
    if (Math.abs(x) < 64 && y > site.gateS[1] - 30) return false;
    for (const r of roads) {
      if (r.kind === "ring" || r.kind === "campus") continue;
      for (let i = 0; i + 1 < r.pts.length; i++) if (segmentDistance([x, y], r.pts[i], r.pts[i + 1]) < r.width / 2 + 4) return false;
    }
  } else {
    for (const r of roads) {
      if (r.kind !== "forest") continue;
      for (let i = 0; i + 1 < r.pts.length; i++) if (segmentDistance([x, y], r.pts[i], r.pts[i + 1]) < r.width / 2 + 5) return false;
    }
  }
  return true;
}

/** 도시 모드: 캠퍼스 둘레의 녹지 띠 */
function bufferTrees(scene: Scene, seed: string, trees: Tree[]): void {
  const site = scene.site;
  const hash = cellHash(seed, "buffer");
  let k = 0;
  for (let a = 0; a < Math.PI * 2; a += 0.004) {
    for (let band = 0; band < 6; band++) {
      const t = hash(k++), u = hash(k++);
      const rr = 1.0 + 0.02 + band * 0.025 + t * 0.02;
      const x = Math.cos(a + u * 0.004) * site.rx * rr, y = Math.sin(a + u * 0.004) * site.ry * rr;
      if (pointInPolygon([x, y], site.boundary)) continue;
      if (y > site.arterialY - 22) continue;
      if (Math.abs(x) < 64 && y > site.gateS[1] - 30) continue;
      if (site.roads.some((r) => r.kind === "connector" && Math.abs(r.pts[0][0] - x) < 10 && y > 0)) continue;
      if (site.roads.some((r) => r.kind === "forest" && r.pts.some((p, i) => i + 1 < r.pts.length && segmentDistance([x, y], p, r.pts[i + 1]) < 8))) continue;
      if (hash(k++) < 0.35) continue;
      trees.push({ x, y, z: 0, r: 3.2 + hash(k++) * 2, kind: hash(k++) < 0.3 ? 1 : 0, c: hash(k++) });
    }
  }
}

type FillFn = (paths: Float32Array[], c: string, extra?: Partial<Extract<Cmd, { k: "fill" }>>) => void;
type LineFn = (paths: Float32Array[], c: string, lw: number, extra?: Partial<Extract<Cmd, { k: "line" }>>) => void;
type FlatFn = (pts: readonly (readonly number[])[], z?: number) => Float32Array;

function lawnPatches(scene: Scene, pal: Palette, seed: string, cmds: Cmd[], flat: FlatFn): void {
  const noise = createNoise2D(subRng(seed, "lawn"));
  const site = scene.site;
  const paths: Float32Array[] = [];
  for (let i = 0; i < 70; i++) {
    const a = noise(i * 1.7, 3.1) * Math.PI, r = 0.15 + 0.7 * Math.abs(noise(i * 2.3, 9.4));
    const cx = Math.cos(a * 2 + i) * site.rx * r, cy = Math.sin(a * 2 + i) * site.ry * r;
    const rad = 18 + 30 * Math.abs(noise(i * 0.7, 1.3));
    const pts: Vec2[] = [];
    for (let k = 0; k < 14; k++) {
      const t = (k / 14) * Math.PI * 2;
      const w = rad * (0.75 + 0.25 * noise(i + Math.cos(t), Math.sin(t)));
      pts.push([cx + Math.cos(t) * w * 1.4, cy + Math.sin(t) * w]);
    }
    if (pts.every((p) => pointInPolygon(p, site.boundary))) paths.push(flat(pts));
  }
  cmds.push({ k: "fill", paths, fill: tone(pal, pal.lawnLight, 1, 0.55) });
}

function drawAxis(scene: Scene, pal: Palette, fill: FillFn, line: LineFn, flat: FlatFn): void {
  const site = scene.site;
  const plaza = scene.layout.buildings.find((b) => b.shape === "plaza");
  const y0 = plaza ? plaza.y + plaza.d / 2 : site.plaza.y + site.plaza.d / 2;
  const y1 = site.gateS[1] - 28;
  const rect = (x0: number, x1: number, a: number, b: number): Float32Array => flat([[x0, a], [x1, a], [x1, b], [x0, b]]);
  if (y1 > y0) {
    fill([rect(-22, 22, y0, y1)], tone(pal, pal.plaza));
    fill([rect(-13, -6.5, y0 + 4, y1 - 4), rect(6.5, 13, y0 + 4, y1 - 4)], tone(pal, pal.lawn, 1.03));
    // 화단
    if (pal.flowers.length) {
      for (let y = y0 + 10, k = 0; y < y1 - 10; y += 22, k++) {
        const c = pal.flowers[k % pal.flowers.length];
        fill([rect(-12, -7.5, y, y + 8), rect(7.5, 12, y, y + 8)], tone(pal, c));
      }
    }
    line([rect(-22, 22, y0, y1)], tone(pal, pal.plaza, 0.86), 0.6);
  }
  // 본관 뒤 길과 후문
  const admin = scene.layout.buildings.find((b) => b.type === "admin");
  const ny0 = admin ? admin.y - admin.d / 2 - 2 : site.adminY - 18;
  fill([rect(-5, 5, site.gateN[1], ny0)], tone(pal, pal.walkway));
  fill([rect(-30, 30, site.gateN[1] - 6, site.gateN[1] + 22)], tone(pal, pal.plaza));
}

function drawPlaza(b: Building, pal: Palette, fill: FillFn, line: LineFn, flat: FlatFn): void {
  const L = (u: number, v: number): Vec2 => localToWorld(b.x, b.y, b.angle, u, v);
  const R = (u0: number, v0: number, u1: number, v1: number): Float32Array => flat([L(u0, v0), L(u1, v0), L(u1, v1), L(u0, v1)]);
  const hw = b.w / 2, hd = b.d / 2;
  fill([R(-hw, -hd, hw, hd)], tone(pal, pal.plaza), { stroke: tone(pal, pal.plaza, 0.82), lw: 0.8 });
  // 바닥 무늬
  const grid: Float32Array[] = [];
  for (let u = -hw + 12; u < hw; u += 12) grid.push(flat([L(u, -hd), L(u, hd)]));
  for (let v = -hd + 12; v < hd; v += 12) grid.push(flat([L(-hw, v), L(hw, v)]));
  line(grid, tone(pal, pal.plaza, 0.9), 0.4);
  // 모서리 잔디
  const cw = hw * 0.32, cd = hd * 0.34;
  fill([
    R(-hw + 4, -hd + 4, -hw + 4 + cw, -hd + 4 + cd), R(hw - 4 - cw, -hd + 4, hw - 4, -hd + 4 + cd),
    R(-hw + 4, hd - 4 - cd, -hw + 4 + cw, hd - 4), R(hw - 4 - cw, hd - 4 - cd, hw - 4, hd - 4),
  ], tone(pal, pal.lawn, 1.04), { stroke: tone(pal, pal.lawn, 0.85), lw: 0.5 });
  // 가운데 원형 무늬
  const circle = (r: number): Float32Array => {
    const pts: Vec2[] = [];
    for (let k = 0; k < 32; k++) { const a = (k / 32) * Math.PI * 2; pts.push(L(Math.cos(a) * r, Math.sin(a) * r)); }
    return flat(pts);
  };
  line([circle(16), circle(10)], tone(pal, pal.plaza, 0.8), 0.7);
  // 본관 쪽 반사 연못 두 개와 가운데 길
  fill([R(-12, -hd - 30, 12, -hd)], tone(pal, pal.plaza));
  fill([R(-48, -hd - 26, -16, -hd - 6), R(16, -hd - 26, 48, -hd - 6)], tone(pal, pal.water), { stroke: tone(pal, pal.paving), lw: 1.4 });
  fill([R(-44, -hd - 22, -30, -hd - 18), R(20, -hd - 22, 34, -hd - 18)], tone(pal, pal.waterLight, 1, 0.6));
}

function stadiumOutline(cu: number, cv: number, len: number, rad: number, L: (u: number, v: number) => Vec2): Vec2[] {
  const pts: Vec2[] = [];
  for (let k = 0; k <= 16; k++) { const a = -Math.PI / 2 + (k / 16) * Math.PI; pts.push(L(cu + len / 2 + Math.cos(a) * rad, cv + Math.sin(a) * rad)); }
  for (let k = 0; k <= 16; k++) { const a = Math.PI / 2 + (k / 16) * Math.PI; pts.push(L(cu - len / 2 + Math.cos(a) * rad, cv + Math.sin(a) * rad)); }
  return pts;
}

function fieldDims(b: Building): { cv: number; R: number; len: number } {
  const standD = 13;
  const d = b.d - standD;
  const R = d / 2;
  return { cv: standD / 2, R, len: Math.max(10, b.w - d) };
}

function drawFieldGround(b: Building, pal: Palette, fill: FillFn, line: LineFn, flat: FlatFn): void {
  const L = (u: number, v: number): Vec2 => localToWorld(b.x, b.y, b.angle, u, v);
  const { cv, R, len } = fieldDims(b);
  fill([flat([L(-b.w / 2 - 4, -b.d / 2 - 4), L(b.w / 2 + 4, -b.d / 2 - 4), L(b.w / 2 + 4, b.d / 2 + 4), L(-b.w / 2 - 4, b.d / 2 + 4)])], tone(pal, pal.paving));
  fill([flat(stadiumOutline(0, cv, len, R, L))], tone(pal, pal.track));
  const lanes: Float32Array[] = [];
  for (const k of [2.2, 4.4, 6.6]) lanes.push(flat([...stadiumOutline(0, cv, len, R - k, L), L(len / 2, cv - R + k)]));
  line(lanes, tone(pal, [240, 230, 220], 0.95), 0.35);
  const inner = R - 9;
  fill([flat(stadiumOutline(0, cv, len, inner, L))], tone(pal, pal.field));
  // 잔디 줄무늬
  const fw = len + inner * 1.2, fd = inner * 1.7;
  const stripes: Float32Array[] = [];
  const n = 10;
  for (let k = 0; k < n; k += 2) {
    const u0 = -fw / 2 + (fw / n) * k, u1 = u0 + fw / n;
    stripes.push(flat([L(u0, cv - fd / 2), L(u1, cv - fd / 2), L(u1, cv + fd / 2), L(u0, cv + fd / 2)]));
  }
  fill(stripes, tone(pal, pal.fieldLight));
  const box = (u0: number, v0: number, u1: number, v1: number): Float32Array => flat([L(u0, v0), L(u1, v0), L(u1, v1), L(u0, v1), L(u0, v0)]);
  const lines: Float32Array[] = [box(-fw / 2, cv - fd / 2, fw / 2, cv + fd / 2), flat([L(0, cv - fd / 2), L(0, cv + fd / 2)])];
  const circ: Vec2[] = [];
  for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; circ.push(L(Math.cos(a) * 8, cv + Math.sin(a) * 8)); }
  lines.push(flat(circ));
  lines.push(box(-fw / 2, cv - 16, -fw / 2 + 14, cv + 16), box(fw / 2 - 14, cv - 16, fw / 2, cv + 16));
  line(lines, tone(pal, [250, 250, 246]), 0.45);
}

function drawStands(b: Building, cam: Camera, pal: Palette, cmds: Cmd[]): void {
  const L = (u: number, v: number, z: number): P3 => { const w = localToWorld(b.x, b.y, b.angle, u, v); return [w[0], w[1], z]; };
  const { len } = fieldDims(b);
  const v0 = -b.d / 2, v1 = -b.d / 2 + 11;
  const hu = len / 2 + 8;
  const proj = (p: P3): number[] => { const q = project(cam, p[0], p[1], p[2]); return [q[0], q[1]]; };
  const quad = (pts: P3[]): Float32Array => new Float32Array(pts.flatMap(proj));
  // 계단식 관람석 (앞이 낮고 뒤가 높다)
  const seat = [L(-hu, v1, 1), L(hu, v1, 1), L(hu, v0, 8), L(-hu, v0, 8)];
  const back = [L(-hu, v0, 0), L(hu, v0, 0), L(hu, v0, 8), L(-hu, v0, 8)];
  const sideL = [L(-hu, v0, 0), L(-hu, v1, 0), L(-hu, v1, 1), L(-hu, v0, 8)];
  const sideR = [L(hu, v1, 0), L(hu, v0, 0), L(hu, v0, 8), L(hu, v1, 1)];
  const toCam = (p: P3, n: Vec2): boolean => (cam.cx - p[0]) * n[0] + (cam.cy - p[1]) * n[1] > 0;
  const nBack = localToWorld(0, 0, b.angle, 0, -1), nL = localToWorld(0, 0, b.angle, -1, 0), nR = localToWorld(0, 0, b.angle, 1, 0);
  if (toCam(back[0], nBack)) cmds.push({ k: "fill", paths: [quad(back)], fill: tone(pal, [200, 200, 196], 0.8) });
  if (toCam(sideL[0], nL)) cmds.push({ k: "fill", paths: [quad(sideL)], fill: tone(pal, [200, 200, 196], 0.85) });
  if (toCam(sideR[0], nR)) cmds.push({ k: "fill", paths: [quad(sideR)], fill: tone(pal, [200, 200, 196], 0.85) });
  cmds.push({ k: "fill", paths: [quad(seat)], fill: tone(pal, [70, 104, 160], 1.05) });
  const rows: Float32Array[] = [];
  for (let k = 1; k < 7; k++) {
    const t = k / 7;
    rows.push(quad([L(-hu, v1 + (v0 - v1) * t, 1 + 7 * t), L(hu, v1 + (v0 - v1) * t, 1 + 7 * t)]));
  }
  cmds.push({ k: "line", paths: rows, stroke: tone(pal, [220, 226, 236]), lw: 0.4 });
  // 지붕
  const roof = [L(-hu * 0.7, v1 - 2, 12), L(hu * 0.7, v1 - 2, 12), L(hu * 0.7, v0 - 1, 13), L(-hu * 0.7, v0 - 1, 13)];
  cmds.push({ k: "fill", paths: [quad(roof)], fill: tone(pal, [236, 238, 240], 0.98), stroke: tone(pal, [160, 166, 172]), lw: 0.5 });
  // 조명탑
  const poles: Float32Array[] = [];
  const heads: Float32Array[] = [];
  for (const [u, v] of [[-b.w / 2 - 2, -b.d / 2 - 2], [b.w / 2 + 2, -b.d / 2 - 2], [-b.w / 2 - 2, b.d / 2 + 2], [b.w / 2 + 2, b.d / 2 + 2]]) {
    poles.push(quad([L(u, v, 0), L(u, v, 26)]));
    heads.push(quad([L(u - 2.5, v, 25), L(u + 2.5, v, 25), L(u + 2.5, v, 28), L(u - 2.5, v, 28)]));
  }
  cmds.push({ k: "line", paths: poles, stroke: tone(pal, [120, 124, 128]), lw: 0.7 });
  cmds.push({ k: "fill", paths: heads, fill: pal.time === "night" ? raw([255, 244, 210]) : tone(pal, [230, 232, 236]) });
}

function drawParking(p: { x: number; y: number; w: number; d: number; angle: number }, pal: Palette, fill: FillFn, line: LineFn, flat: FlatFn, seed: string): void {
  const L = (u: number, v: number): Vec2 => localToWorld(p.x, p.y, p.angle, u, v);
  fill([flat([L(-p.w / 2, -p.d / 2), L(p.w / 2, -p.d / 2), L(p.w / 2, p.d / 2), L(-p.w / 2, p.d / 2)])], tone(pal, pal.parking), { stroke: tone(pal, pal.roadEdge), lw: 0.8 });
  const long = p.w >= p.d;
  const n = Math.floor((long ? p.w : p.d) / 2.8);
  const marks: Float32Array[] = [];
  const cars: Float32Array[][] = [[], [], [], []];
  const hash = cellHash(seed, `car${Math.round(p.x)}:${Math.round(p.y)}`);
  for (let i = 0; i <= n; i++) {
    const t = -0.5 + i / n;
    for (const side of [-1, 1]) {
      if (long) marks.push(flat([L(t * p.w, side * p.d / 2), L(t * p.w, side * p.d * 0.18)]));
      else marks.push(flat([L(side * p.w / 2, t * p.d), L(side * p.w * 0.18, t * p.d)]));
      if (i < n && hash(i * 2 + (side > 0 ? 1 : 0)) < 0.62) {
        const c = Math.floor(hash(i * 7 + (side > 0 ? 3 : 5)) * 4);
        const tc = -0.5 + (i + 0.5) / n;
        const [u0, v0, u1, v1] = long
          ? [tc * p.w - 0.95, side > 0 ? p.d * 0.22 : -p.d / 2 + 0.6, tc * p.w + 0.95, side > 0 ? p.d / 2 - 0.6 : -p.d * 0.22]
          : [side > 0 ? p.w * 0.22 : -p.w / 2 + 0.6, tc * p.d - 0.95, side > 0 ? p.w / 2 - 0.6 : -p.w * 0.22, tc * p.d + 0.95];
        cars[c].push(flat([L(u0, v0), L(u1, v0), L(u1, v1), L(u0, v1)], 0.8));
      }
    }
  }
  line(marks, tone(pal, pal.marking, 0.9), 0.3);
  const carColors: RGB[] = [[236, 236, 236], [40, 44, 52], [150, 156, 164], [168, 42, 40]];
  cars.forEach((paths, i) => fill(paths, tone(pal, carColors[i])));
}

function drawLandmarkGround(kind: LandmarkKind, x: number, y: number, pal: Palette, fill: FillFn, line: LineFn, flat: FlatFn, seed: string): void {
  const circle = (r: number, ry = r, n = 28, wob = 0): Vec2[] => {
    const pts: Vec2[] = [];
    const noise = wob ? createNoise2D(subRng(seed, `pond${Math.round(x)}`)) : undefined;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const w = noise ? 1 + wob * noise(Math.cos(a) * 1.5, Math.sin(a) * 1.5) : 1;
      pts.push([x + Math.cos(a) * r * w, y + Math.sin(a) * ry * w]);
    }
    return pts;
  };
  switch (kind) {
    case "pond":
      fill([flat(circle(30, 21, 40, 0.18))], tone(pal, [196, 186, 168]));
      fill([flat(circle(27, 18.5, 40, 0.18))], tone(pal, pal.season === "winter" ? [214, 228, 240] : pal.water));
      fill([flat(circle(12, 5, 20).map((p) => [p[0] - 6, p[1] - 5] as Vec2))], tone(pal, pal.waterLight, 1, 0.5));
      break;
    case "obelisk":
      fill([flat(circle(24))], tone(pal, pal.lawn, 0.96));
      fill([flat(circle(14))], tone(pal, pal.plaza));
      line([flat([...circle(19), circle(19)[0]])], tone(pal, pal.walkway), 2.4);
      break;
    case "emblem": {
      fill([flat(circle(9))], tone(pal, [178, 150, 92]));
      fill([flat(circle(7))], tone(pal, [40, 58, 104]));
      const star: Vec2[] = [];
      for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; const r = k % 2 ? 2.4 : 5.2; star.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
      fill([flat(star)], tone(pal, [214, 186, 110]));
      break;
    }
    case "fountain":
      fill([flat(circle(9))], tone(pal, [200, 196, 188]));
      fill([flat(circle(7.6))], tone(pal, pal.water));
      break;
    case "garden": {
      fill([flat(circle(14))], tone(pal, pal.paving));
      fill([flat(circle(9))], tone(pal, pal.lawn, 1.05));
      break;
    }
    case "book": case "curve": case "globe": case "loop": case "statue": case "bell":
      fill([flat(circle(kind === "curve" ? 12 : 8))], tone(pal, pal.paving));
      break;
  }
}

const landmarkHeight = (k: LandmarkKind | "gate"): number =>
  k === "obelisk" ? 18 : k === "globe" ? 9 : k === "bell" ? 8 : k === "statue" ? 6 : k === "loop" ? 6 : k === "curve" ? 5 : k === "pond" ? 1 : k === "emblem" ? 1 : 4;

function drawLandmark(kind: LandmarkKind, x: number, y: number, cam: Camera, pal: Palette, cmds: Cmd[]): void {
  const P = (dx: number, dy: number, z: number): number[] => { const q = project(cam, x + dx, y + dy, z); return [q[0], q[1]]; };
  const poly = (pts: [number, number, number][]): Float32Array => new Float32Array(pts.flatMap(([a, b, c]) => P(a, b, c)));
  const boxCmds = (w: number, d: number, z0: number, z1: number, color: RGB, roof?: RGB): void => {
    const hw = w / 2, hd = d / 2;
    const walls: [number[], [number, number]][] = [
      [[-hw, hd, hw, hd], [0, 1]], [[hw, hd, hw, -hd], [1, 0]], [[-hw, -hd, -hw, hd], [-1, 0]], [[hw, -hd, -hw, -hd], [0, -1]],
    ];
    for (const [[u0, v0, u1, v1], n] of walls) {
      if ((cam.cx - (x + (u0 + u1) / 2)) * n[0] + (cam.cy - (y + (v0 + v1) / 2)) * n[1] <= 0) continue;
      const k = shade(pal, [n[0], n[1], 0]);
      cmds.push({ k: "fill", paths: [poly([[u0, v0, z0], [u1, v1, z0], [u1, v1, z1], [u0, v0, z1]])], fill: tone(pal, color, k) });
    }
    cmds.push({ k: "fill", paths: [poly([[-hw, -hd, z1], [hw, -hd, z1], [hw, hd, z1], [-hw, hd, z1]])], fill: tone(pal, roof ?? color, 1.08) });
  };
  const metal: RGB = [196, 202, 210];
  switch (kind) {
    case "fountain": {
      const jets: Float32Array[] = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        jets.push(new Float32Array([...P(0, 0, 1), ...P(Math.cos(a) * 3, Math.sin(a) * 3, 3.2), ...P(Math.cos(a) * 5.5, Math.sin(a) * 5.5, 0.8)]));
      }
      jets.push(new Float32Array([...P(0, 0, 0.5), ...P(0, 0, 6)]));
      cmds.push({ k: "line", paths: jets, stroke: raw([240, 248, 255], 0.85), lw: 0.9, cap: "round" });
      break;
    }
    case "obelisk": {
      boxCmds(6, 6, 0, 1.6, [214, 210, 200]);
      const s0 = 1.5, s1 = 1.0, h = 15;
      const faces: [number, number][] = [[0, 1], [1, 0], [-1, 0]];
      for (const n of faces) {
        const k = shade(pal, [n[0], n[1], 0]);
        const [a, b] = n[1] !== 0 ? [[-1, 1], [1, 1]] : [[n[0], 1], [n[0], -1]];
        const pts: [number, number, number][] = [
          [a[0] * s0, a[1] * s0, 1.6], [b[0] * s0, b[1] * s0, 1.6], [b[0] * s1, b[1] * s1, h], [a[0] * s1, a[1] * s1, h],
        ];
        cmds.push({ k: "fill", paths: [poly(pts)], fill: tone(pal, [120, 118, 116], k) });
      }
      cmds.push({ k: "fill", paths: [poly([[-s1, s1, h], [s1, s1, h], [0, 0, h + 2.6]]), poly([[s1, s1, h], [s1, -s1, h], [0, 0, h + 2.6]])], fill: tone(pal, [150, 146, 140]) });
      break;
    }
    case "loop": {
      boxCmds(3, 1.6, 0, 0.8, [200, 196, 190]);
      const pts: number[] = [];
      for (let k = 0; k <= 48; k++) {
        const t = (k / 48) * Math.PI * 2;
        const den = 1 + Math.sin(t) ** 2;
        pts.push(...P((3.4 * Math.cos(t)) / den, 0, 3.4 + (3.4 * Math.sin(t) * Math.cos(t)) / den * 1.6));
      }
      const f = new Float32Array(pts);
      cmds.push({ k: "line", paths: [f], stroke: tone(pal, [110, 118, 128]), lw: 1.6, cap: "round" });
      cmds.push({ k: "line", paths: [f], stroke: tone(pal, metal, 1.1), lw: 0.8, cap: "round" });
      break;
    }
    case "globe": {
      boxCmds(3, 3, 0, 2.2, [206, 200, 190]);
      const c = project(cam, x, y, 5.6), r = (cam.f / c[2]) * 3.4;
      cmds.push({ k: "globe", x: c[0], y: c[1], r });
      break;
    }
    case "book": {
      boxCmds(7, 3, 0, 0.6, [190, 180, 160]);
      const page = (s: number): Float32Array => poly([[0, -1.5, 0.8], [0, 1.5, 0.8], [s * 4.2, 1.5, 3.2], [s * 4.2, -1.5, 3.2]]);
      cmds.push({ k: "fill", paths: [page(-1)], fill: tone(pal, [246, 242, 230], 1.0), stroke: tone(pal, [160, 150, 130]), lw: 0.4 });
      cmds.push({ k: "fill", paths: [page(1)], fill: tone(pal, [236, 230, 214], 0.94), stroke: tone(pal, [160, 150, 130]), lw: 0.4 });
      break;
    }
    case "curve": {
      const pts: number[] = [];
      for (let k = 0; k <= 40; k++) {
        const t = k / 40;
        pts.push(...P(-10 + 20 * t, Math.sin(t * Math.PI * 2) * 3, 1 + 3.2 * Math.abs(Math.sin(t * Math.PI * 3))));
      }
      const f = new Float32Array(pts);
      cmds.push({ k: "line", paths: [f], stroke: tone(pal, [70, 80, 92]), lw: 1.8, cap: "round" });
      cmds.push({ k: "line", paths: [f], stroke: tone(pal, [150, 200, 140]), lw: 0.9, cap: "round" });
      break;
    }
    case "garden": {
      const spots: [number, number, number][] = [[-6, -3, 2.4], [5, -5, 3.2], [-2, 6, 2.8], [7, 4, 1.8]];
      for (const [dx, dy, h] of spots) {
        const q = P(dx, dy, h), g = P(dx, dy, 0);
        cmds.push({ k: "line", paths: [new Float32Array([...g, ...q])], stroke: tone(pal, [120, 110, 100]), lw: 1.6, cap: "round" });
        cmds.push({ k: "ellipses", data: new Float32Array([q[0], q[1], 1.6, 1.6]), fill: tone(pal, [210, 200, 186]) });
      }
      break;
    }
    case "statue": {
      boxCmds(3.2, 3.2, 0, 2.6, [210, 204, 194]);
      const a = P(0, 0, 2.6), b = P(0, 0, 6.2);
      cmds.push({ k: "line", paths: [new Float32Array([...a, ...b])], stroke: tone(pal, [86, 70, 52]), lw: 1.8, cap: "round" });
      cmds.push({ k: "ellipses", data: new Float32Array([b[0], b[1] - 1, 1.1, 1.1]), fill: tone(pal, [96, 78, 58]) });
      break;
    }
    case "bell": {
      const posts: Float32Array[] = [];
      for (const [dx, dy] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) posts.push(new Float32Array([...P(dx, dy, 0), ...P(dx, dy, 5)]));
      cmds.push({ k: "line", paths: posts, stroke: tone(pal, [130, 50, 40]), lw: 1.2 });
      const bell = P(0, 0, 3.6);
      cmds.push({ k: "ellipses", data: new Float32Array([bell[0], bell[1], 1.6, 1.9]), fill: tone(pal, [80, 92, 70]) });
      const roof: [number, number, number][] = [[-4.6, 4.6, 5], [4.6, 4.6, 5], [4.6, -4.6, 5], [-4.6, -4.6, 5]];
      cmds.push({ k: "fill", paths: [poly([roof[3], roof[0], [0, 0, 8.4]]), poly([roof[0], roof[1], [0, 0, 8.4]]), poly([roof[1], roof[2], [0, 0, 8.4]])], fill: tone(pal, [70, 74, 82]), stroke: tone(pal, [40, 44, 50]), lw: 0.4 });
      break;
    }
    case "pond": case "emblem":
      break;
  }
}

function drawGate(y: number, north: boolean, cam: Camera, pal: Palette, cmds: Cmd[]): void {
  const h = north ? 6 : 9;
  const span = north ? 10 : 15;
  for (const sx of [-1, 1]) {
    for (const off of north ? [0] : [0, 7]) {
      const x = sx * (span + off);
      const hh = off ? h * 0.65 : h;
      const s = off ? 1.4 : 1.8;
      const P = (dx: number, dy: number, z: number): number[] => { const q = project(cam, x + dx, y + dy, z); return [q[0], q[1]]; };
      const quad = (pts: [number, number, number][]): Float32Array => new Float32Array(pts.flatMap(([a, b, c]) => P(a, b, c)));
      const side = x < cam.cx ? 1 : -1;
      cmds.push({ k: "fill", paths: [quad([[side * s, s, 0], [side * s, -s, 0], [side * s, -s, hh], [side * s, s, hh]])], fill: tone(pal, [214, 206, 190], 0.84) });
      cmds.push({ k: "fill", paths: [quad([[-s, s, 0], [s, s, 0], [s, s, hh], [-s, s, hh]])], fill: tone(pal, [226, 218, 202], 1.0) });
      cmds.push({ k: "fill", paths: [quad([[-s - 0.4, -s - 0.4, hh], [s + 0.4, -s - 0.4, hh], [s + 0.4, s + 0.4, hh], [-s - 0.4, s + 0.4, hh]])], fill: tone(pal, [120, 112, 100]) });
    }
  }
}

function drawCityBox(c: Scene["city"][number], cam: Camera, pal: Palette, cmds: Cmd[]): void {
  const poly = rectCorners(c.x, c.y, c.w, c.d, c.angle);
  const wall = pal.cityWall[Math.floor(c.tone * pal.cityWall.length) % pal.cityWall.length];
  const roof = pal.cityRoof[Math.floor(c.tone * 7) % pal.cityRoof.length];
  const proj = (p: Vec2, z: number): number[] => { const q = project(cam, p[0], p[1], z); return [q[0], q[1]]; };
  const q0 = project(cam, c.x, c.y, 0);
  if (q0[0] < -200 || q0[0] > cam.width + 200 || q0[1] > cam.height + 200) return;
  for (let i = 0; i < 4; i++) {
    const a = poly[i], b = poly[(i + 1) % 4];
    const tx = b[0] - a[0], ty = b[1] - a[1], len = Math.hypot(tx, ty) || 1;
    const n: [number, number, number] = [ty / len, -tx / len, 0];
    if ((cam.cx - (a[0] + b[0]) / 2) * n[0] + (cam.cy - (a[1] + b[1]) / 2) * n[1] <= 0) continue;
    const k = shade(pal, n);
    const face = new Float32Array([...proj(a, 0), ...proj(b, 0), ...proj(b, c.h), ...proj(a, c.h)]);
    cmds.push({ k: "fill", paths: [face], fill: tone(pal, wall, k) });
    // 층 띠 (가까운 건물만)
    const ppmv = cam.f / Math.max(1, q0[2]);
    if (ppmv * 3.3 > 2.6) {
      const bands: Float32Array[] = [];
      const lit: Float32Array[] = [];
      for (let z = 1.2, f = 0; z < c.h - 1; z += 3.3, f++) {
        const quad = new Float32Array([...proj(a, z), ...proj(b, z), ...proj(b, z + 1.5), ...proj(a, z + 1.5)]);
        if (pal.litWindows > 0 && ((f * 7 + i * 3 + Math.floor(c.tone * 100)) % 10) / 10 < pal.litWindows) lit.push(quad);
        else bands.push(quad);
      }
      if (bands.length) cmds.push({ k: "fill", paths: bands, fill: tone(pal, [96, 118, 140], k) });
      if (lit.length) cmds.push({ k: "fill", paths: lit, fill: raw([255, 214, 140]) });
    }
  }
  const top = new Float32Array(poly.flatMap((p) => proj(p, c.h)));
  cmds.push({ k: "fill", paths: [top], fill: tone(pal, pal.snow ? mix(roof, [244, 246, 250], 0.75) : roof, 1.04), stroke: tone(pal, roof, 0.8), lw: 0.4 });
}

/** 건물 모델을 그린다. 화면에서 건물을 감싸는 볼록 다각형(클릭 판정용)을 돌려준다. */
function drawModel(m: Model, cam: Camera, pal: Palette, cmds: Cmd[], b: Building): Float32Array {
  const hullPts: Vec2[] = [];
  const parts = [...m.parts].sort((a, b2) => a.z0 - b2.z0 || project(cam, b2.cx, b2.cy, 0)[2] - project(cam, a.cx, a.cy, 0)[2]);
  let faceIndex = 0;
  for (const part of parts) {
    const walls: { f: Face; depth: number }[] = [];
    const roofs: { f: Face; depth: number }[] = [];
    for (const f of part.faces) {
      faceIndex++;
      if (f.helipad) { roofs.push({ f, depth: -1e9 }); continue; }
      let cx = 0, cy = 0, cz = 0;
      for (const p of f.pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
      cx /= f.pts.length; cy /= f.pts.length; cz /= f.pts.length;
      const toCam = (cam.cx - cx) * f.normal[0] + (cam.cy - cy) * f.normal[1] + (cam.cz - cz) * f.normal[2];
      if (toCam <= 0) continue;
      const depth = project(cam, cx, cy, cz)[2];
      if (f.normal[2] > 0.3) roofs.push({ f, depth }); else walls.push({ f, depth });
    }
    walls.sort((a, b2) => b2.depth - a.depth);
    roofs.sort((a, b2) => b2.depth - a.depth);
    for (const { f } of walls.concat(roofs)) {
      if (f.helipad) { drawHelipad(f.helipad.c, f.helipad.r, cam, pal, cmds); continue; }
      const k = shade(pal, f.normal);
      let color = f.color;
      if (pal.snow && f.normal[2] > 0.3) color = mix(color, [246, 248, 252], 0.78);
      const paths = [projectRing(f.pts, cam, hullPts)];
      if (f.holes) for (const h of f.holes) paths.push(projectRing(h, cam));
      cmds.push({
        k: "fill", paths, fill: tone(pal, color, k), stroke: tone(pal, color, k * 0.74), lw: f.minor ? 0.25 : 0.45,
        evenodd: !!f.holes,
      });
      if (f.win) drawWindows(f, k, cam, pal, cmds, b.id * 131 + faceIndex);
      else if (f.normal[2] > 0.99 && !f.minor && !f.holes && f.pts.length === 4) drawRoofDetail(f, cam, pal, cmds, b);
    }
  }
  const hull = convexHull(hullPts);
  return new Float32Array(hull.flatMap((p) => [p[0], p[1]]));
}

function projectRing(pts: readonly P3[], cam: Camera, collect?: Vec2[]): Float32Array {
  const a = new Float32Array(pts.length * 2);
  pts.forEach((p, i) => {
    const q = project(cam, p[0], p[1], p[2]);
    a[i * 2] = q[0];
    a[i * 2 + 1] = q[1];
    collect?.push([q[0], q[1]]);
  });
  return a;
}

/** 평지붕의 난간 테두리 */
function drawRoofDetail(f: Face, cam: Camera, pal: Palette, cmds: Cmd[], b: Building): void {
  const [a, b2, c, d] = f.pts;
  const len1 = Math.hypot(b2[0] - a[0], b2[1] - a[1]), len2 = Math.hypot(d[0] - a[0], d[1] - a[1]);
  if (len1 < 8 || len2 < 8) return;
  const t1 = 1.2 / len1, t2 = 1.2 / len2;
  const lerp3 = (p: P3, q: P3, t: number): P3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2]];
  const ia = lerp3(lerp3(a, b2, t1), lerp3(d, c, t1), t2);
  const ib = lerp3(lerp3(b2, a, t1), lerp3(c, d, t1), t2);
  const ic = lerp3(lerp3(c, d, t1), lerp3(b2, a, t1), t2);
  const id = lerp3(lerp3(d, c, t1), lerp3(a, b2, t1), t2);
  const color = STYLE_ROOF_INNER(b, pal);
  cmds.push({ k: "fill", paths: [projectRing([ia, ib, ic, id], cam)], fill: color });
  // 옥상 정원 (일부 현대식 건물)
  if (!pal.snow && b.variant > 0.72 && (b.style === "modern" || b.style === "glass") && len1 > 20 && len2 > 14) {
    const g1 = lerp3(lerp3(a, b2, 0.15), lerp3(d, c, 0.15), 0.25);
    const g2 = lerp3(lerp3(a, b2, 0.55), lerp3(d, c, 0.55), 0.25);
    const g3 = lerp3(lerp3(a, b2, 0.55), lerp3(d, c, 0.55), 0.75);
    const g4 = lerp3(lerp3(a, b2, 0.15), lerp3(d, c, 0.15), 0.75);
    cmds.push({ k: "fill", paths: [projectRing([g1, g2, g3, g4], cam)], fill: tone(pal, [118, 160, 92]) });
  }
}

const STYLE_ROOF_INNER = (b: Building, pal: Palette): string => {
  if (pal.snow) return tone(pal, [238, 242, 246], 1.02);
  return tone(pal, b.style === "glass" ? [178, 186, 192] : b.style === "white" ? [204, 208, 212] : [184, 182, 176], 1.04);
};

function drawWindows(f: Face, k: number, cam: Camera, pal: Palette, cmds: Cmd[], seedNo: number): void {
  const w = f.win!;
  const [p0, p1, , p3] = f.pts;
  const zTop = p3[2];
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  if (L < 2) return;
  const mid = project(cam, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + zTop) / 2);
  const ppmv = cam.f / Math.max(1, mid[2]);
  const floorPx = w.floorH * ppmv;
  if (floorPx < 1.6) return;
  const n = Math.max(1, Math.round(L / w.bay));
  const pt = (s: number, z: number): number[] => {
    const q = project(cam, p0[0] + (p1[0] - p0[0]) * s, p0[1] + (p1[1] - p0[1]) * s, z);
    return [q[0], q[1]];
  };
  const quad = (s0: number, s1: number, z0: number, z1: number): Float32Array =>
    new Float32Array([...pt(s0, z0), ...pt(s1, z0), ...pt(s1, z1), ...pt(s0, z1)]);
  const glass: Float32Array[] = [];
  const lit: Float32Array[] = [];
  const frames: Float32Array[] = [];
  const lines: Float32Array[] = [];
  const litP = pal.litWindows;
  const isLit = (f2: number, c: number): boolean => {
    if (litP <= 0) return false;
    const x = Math.sin(seedNo * 12.9898 + f2 * 78.233 + c * 37.719) * 43758.5453;
    return x - Math.floor(x) < litP;
  };
  const doorS = w.door ? 2.6 / L : 0;
  const floors = Math.max(1, Math.round((zTop - w.z0) / w.floorH));
  const fh = (zTop - w.z0) / floors;
  const detail = floorPx > 4.5;
  for (let fl = 0; fl < floors; fl++) {
    const zb = w.z0 + fl * fh;
    if (w.type === "punched" || w.type === "arched") {
      const za = zb + fh * (w.type === "arched" ? 0.22 : 0.3), zc = zb + fh * (w.type === "arched" ? 0.84 : 0.78);
      const cols = detail ? n : Math.max(1, Math.round(n / 2));
      for (let c = 0; c < cols; c++) {
        const s0 = (c + (w.type === "arched" ? 0.3 : 0.24)) / cols, s1 = (c + (w.type === "arched" ? 0.7 : 0.76)) / cols;
        if (fl === 0 && doorS && Math.abs((s0 + s1) / 2 - 0.5) < doorS + 0.5 / cols) continue;
        if (detail && floorPx > 7) frames.push(quad(s0 - 0.06 / cols, s1 + 0.06 / cols, za - fh * 0.06, zc + fh * 0.06));
        (isLit(fl, c) ? lit : glass).push(quad(s0, s1, za, zc));
      }
    } else if (w.type === "ribbon") {
      const za = zb + fh * 0.32, zc = zb + fh * 0.82;
      if (fl === 0 && doorS) {
        glass.push(quad(0.03, 0.5 - doorS - 0.02, za, zc), quad(0.5 + doorS + 0.02, 0.97, za, zc));
      } else if (litP > 0) {
        for (let c = 0; c < n; c++) (isLit(fl, c) ? lit : glass).push(quad(Math.max(0.03, c / n), Math.min(0.97, (c + 1) / n), za, zc));
      } else glass.push(quad(0.03, 0.97, za, zc));
      if (detail) for (let c = 1; c < n; c++) lines.push(new Float32Array([...pt(c / n, za), ...pt(c / n, zc)]));
    } else if (w.type === "curtain") {
      if (fl > 0) lines.push(new Float32Array([...pt(0, zb), ...pt(1, zb)]));
      if (litP > 0) for (let c = 0; c < n; c++) if (isLit(fl, c)) lit.push(quad(c / n + 0.01, (c + 1) / n - 0.01, zb + 0.3, zb + fh - 0.3));
    }
  }
  if (w.type === "curtain" && detail) for (let c = 1; c < n; c++) lines.push(new Float32Array([...pt(c / n, w.z0), ...pt(c / n, zTop)]));
  if (frames.length) cmds.push({ k: "fill", paths: frames, fill: tone(pal, w.frame, k) });
  if (glass.length) cmds.push({ k: "fill", paths: glass, fill: tone(pal, w.color, k * 0.95) });
  if (lit.length) cmds.push({ k: "fill", paths: lit, fill: raw([255, 216, 146]) });
  if (lines.length) cmds.push({ k: "line", paths: lines, stroke: tone(pal, w.type === "curtain" ? w.frame : w.frame, k * (w.type === "curtain" ? 1 : 0.95)), lw: w.type === "curtain" ? 0.35 : 0.3 });
  if (w.door) {
    cmds.push({ k: "fill", paths: [quad(0.5 - doorS, 0.5 + doorS, w.z0, w.z0 + Math.min(3.2, fh * 0.85))], fill: tone(pal, [58, 66, 76], k) });
  }
  // 고전·벽돌 건물의 처마 띠
  if ((w.type === "punched" || w.type === "arched") && floorPx > 3) {
    cmds.push({ k: "fill", paths: [quad(0, 1, zTop - 0.9, zTop)], fill: tone(pal, w.frame, k) });
  }
}

function drawHelipad(c: P3, r: number, cam: Camera, pal: Palette, cmds: Cmd[]): void {
  const ring = (rr: number): Float32Array => {
    const a: number[] = [];
    for (let k = 0; k < 28; k++) { const t = (k / 28) * Math.PI * 2; const q = project(cam, c[0] + Math.cos(t) * rr, c[1] + Math.sin(t) * rr, c[2]); a.push(q[0], q[1]); }
    return new Float32Array(a);
  };
  cmds.push({ k: "fill", paths: [ring(r)], fill: tone(pal, [86, 150, 104]) });
  cmds.push({ k: "line", paths: [ring(r * 0.8)], stroke: tone(pal, [248, 248, 244]), lw: 0.7 });
  const hP = (u: number, v: number): number[] => { const q = project(cam, c[0] + u * r * 0.32, c[1] + v * r * 0.42, c[2]); return [q[0], q[1]]; };
  cmds.push({ k: "line", paths: [new Float32Array([...hP(-1, -1), ...hP(-1, 1)]), new Float32Array([...hP(1, -1), ...hP(1, 1)]), new Float32Array([...hP(-1, 0), ...hP(1, 0)])], stroke: tone(pal, [248, 248, 244]), lw: 1.1 });
}

