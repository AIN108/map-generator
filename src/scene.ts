// 장면: 배치(Layout)에서 저절로 따라 나오는 것들. 나무, 산책로, 포장 마당, 주차장, 주변 도시·산.
// 편집으로 건물을 옮기면 다시 계산한다. 나무 후보 자리는 시드로 고정해 두고, 빈 곳에만 심는다.

import { resolveForm } from "./form.ts";
import { type Camera, unproject } from "./camera.ts";
import {
  bounds, convexOverlap, insideAroundOrigin, localToWorld, pointInPolygon, polygonSegmentDistance, rectCorners, resample, segmentDistance, tangentAt,
  type Poly, type Vec2,
} from "./geom.ts";
import { footprint, isPlace, roadSegments, type Building, type Layout } from "./layout.ts";
import { buildModel, type Model } from "./model.ts";
import { cellHash, createNoise2D, fbm, subRng } from "./rng.ts";
import { AXIS_HALF, riverY, type Road, type Site } from "./site.ts";

export type Surround = "forest" | "city";
export const SURROUND_KO: Record<Surround, string> = { forest: "숲과 산", city: "도시" };

/** 0 활엽수, 1 침엽수, 2 꽃나무(봄 벚꽃), 3 가로수 */
export type TreeKind = 0 | 1 | 2 | 3;

export interface Tree {
  x: number;
  y: number;
  z: number;
  /** 수관 반지름 (m) */
  r: number;
  kind: TreeKind;
  /** 색 묶음 고르기용 난수 (0~1) */
  c: number;
  /** 산비탈 음영 단계 (0 그늘, 1 보통, 2 양지). 없으면 1 */
  s?: number;
}

export interface CityBox { x: number; y: number; w: number; d: number; angle: number; h: number; tone: number }
export interface Parking { x: number; y: number; w: number; d: number; angle: number }

export interface Scene {
  site: Site;
  layout: Layout;
  surround: Surround;
  models: Map<number, Model>;
  walkways: Vec2[][];
  aprons: Poly[];
  parkings: Parking[];
  trees: Tree[];
  /** trees 앞쪽의 이만큼은 배치에 따라 바뀌는 캠퍼스 나무 (나머지는 주변 가로수) */
  campusTrees: number;
  streets: Road[];
  city: CityBox[];
  /** 도시 지역 (그리기용 바닥) */
  cityGround: Poly[];
  lamps: Vec2[];
  /** 지형 높이 (숲의 산) */
  height: (x: number, y: number) => number;
}

const near = (a: Vec2, b: Vec2, r: number): boolean => Math.abs(a[0] - b[0]) < r && Math.abs(a[1] - b[1]) < r;

/** 건물 정면 출입구 앞 점 */
export function entrance(b: Building, out = 2): Vec2 {
  if (b.shape === "L" || b.shape === "U") {
    const f = resolveForm(b);
    const v = -b.d / 2 + b.d * f.depth + out;
    const u = b.shape === "L" ? (f.flip ? -1 : 1) * (b.w / 2 - b.w * f.wing) * 0.75 : 0;
    return localToWorld(b.x, b.y, b.angle, u, b.shape === "U" ? b.d / 2 + out : v);
  }
  const extra = b.shape === "gym" ? 6 : b.shape === "wings" ? 7 : 0;
  return localToWorld(b.x, b.y, b.angle, 0, b.d / 2 + out + extra);
}

export function makeTerrain(site: Site, seed: string, surround: Surround): (x: number, y: number) => number {
  if (surround === "city") return () => 0;
  const noise = createNoise2D(subRng(seed, "terrain"));
  const rx = site.rx * 1.06, ry = site.ry * 1.06;
  return (x: number, y: number): number => {
    const e = Math.hypot(x / rx, y / ry);
    if (e < 1) return 0;
    const out = (e - 1) * site.rx;
    const ramp = Math.min(1, out / 260);
    const ramp2 = ramp * ramp * (3 - 2 * ramp);
    // 정문 쪽(남쪽)은 평지로 둔다.
    const southFade = y > site.arterialY - 120 ? Math.max(0, 1 - (y - (site.arterialY - 120)) / 120) : 1;
    const n = fbm(noise, x / 420, y / 420, 4);
    const ridge = 1 - Math.abs(noise(x / 300 + 11, y / 300 - 7));
    const base = 30 + out * 0.12;
    // 강 둘레는 평평한 강변으로
    let riverFade = 1;
    const ry2 = riverY(site, x);
    if (ry2 !== undefined) {
      const dw = Math.abs(y - ry2) - site.water!.width / 2;
      riverFade = dw <= 20 ? 0 : Math.min(1, (dw - 20) / 220);
      riverFade = riverFade * riverFade * (3 - 2 * riverFade);
    }
    return Math.max(0, ramp2 * southFade * riverFade * (base + 70 * (0.5 + 0.5 * n) + 40 * ridge * ridge));
  };
}

export function deriveScene(
  site: Site, layout: Layout, seed: string, surround: Surround, cam: Camera, surroundings?: Surroundings,
): Scene {
  const models = new Map<number, Model>();
  for (const b of layout.buildings) if (!isPlace(b)) models.set(b.id, buildModel(b));
  const segs = roadSegments(site);
  const height = makeTerrain(site, seed, surround);
  // 도로 선분 격자 색인: 나무·주차장 자리 검사에서 가까운 선분만 본다.
  const SEG_CELL = 24, SEG_PAD = 4;
  const segGrid = new Map<number, number[]>();
  const gridKey = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);
  segs.forEach((s, k) => {
    const m = s.half + SEG_PAD;
    for (let i = Math.floor((s.minX - m) / SEG_CELL); i <= Math.floor((s.maxX + m) / SEG_CELL); i++) {
      for (let j = Math.floor((s.minY - m) / SEG_CELL); j <= Math.floor((s.maxY + m) / SEG_CELL); j++) {
        const key = gridKey(i, j);
        const list = segGrid.get(key);
        if (list) list.push(k); else segGrid.set(key, [k]);
      }
    }
  });
  let segStamp = 0;
  const segSeen = new Uint32Array(segs.length);
  /** 경계 상자에 SEG_PAD 이내로 걸칠 수 있는 도로 선분 */
  const segsNear = (x0: number, y0: number, x1: number, y1: number): number[] => {
    segStamp++;
    const out: number[] = [];
    for (let i = Math.floor(x0 / SEG_CELL); i <= Math.floor(x1 / SEG_CELL); i++) {
      for (let j = Math.floor(y0 / SEG_CELL); j <= Math.floor(y1 / SEG_CELL); j++) {
        for (const k of segGrid.get(gridKey(i, j)) ?? []) {
          if (segSeen[k] === segStamp) continue;
          segSeen[k] = segStamp;
          out.push(k);
        }
      }
    }
    return out;
  };

  const solids = layout.buildings.map((b) => ({ b, poly: footprint(b), r: Math.hypot(b.w, b.d) / 2 }));

  // ── 포장 마당 (건물 둘레·정면 앞) ──
  const aprons: Poly[] = [];
  for (const b of layout.buildings) {
    if (isPlace(b)) continue;
    aprons.push(rectCorners(b.x, b.y, b.w + 7, b.d + 7, b.angle));
    const front = localToWorld(b.x, b.y, b.angle, 0, b.d / 2 + 9);
    aprons.push(rectCorners(front[0], front[1], Math.min(b.w * 0.55, 40), 16, b.angle));
  }

  // ── 주차장: 큰 건물 옆에 ──
  const parkings: Parking[] = [];
  const parkRng = subRng(seed, "parking");
  for (const b of layout.buildings) {
    const want = b.type === "hospital" ? 2 : ["gym", "union", "admin", "auditorium", "intl", "business"].includes(b.type) ? 1 : parkRng() < 0.25 ? 1 : 0;
    if (want === 0 || isPlace(b)) continue;
    let placed = 0;
    const spots: [number, number, number][] = [
      [b.w / 2 + 22, 0, 0], [-b.w / 2 - 22, 0, 0], [0, -b.d / 2 - 18, 0], [b.w / 4, -b.d / 2 - 18, 0], [-b.w / 4, -b.d / 2 - 18, 0],
    ];
    for (const [u, v] of spots) {
      if (placed >= want) break;
      const c = localToWorld(b.x, b.y, b.angle, u, v);
      const vertical = Math.abs(u) > 0;
      const p: Parking = { x: c[0], y: c[1], w: vertical ? 28 : 46, d: vertical ? 40 : 24, angle: b.angle };
      const poly = rectCorners(p.x, p.y, p.w, p.d, p.angle);
      if (!poly.every((q) => insideAroundOrigin(site.ring, q[0], q[1]))) continue;
      if (solids.some((s) => near([s.b.x, s.b.y], c, s.r + 40) && convexOverlap(poly, s.poly, 4))) continue;
      if (site.reserved.some((r) => convexOverlap(poly, r, 0))) continue;
      const pb = bounds(poly);
      if (segsNear(pb.x0, pb.y0, pb.x1, pb.y1).some((k) => polygonSegmentDistance(poly, segs[k].a, segs[k].b) < segs[k].half + 1.5)) continue;
      if (parkings.some((q) => convexOverlap(poly, rectCorners(q.x, q.y, q.w, q.d, q.angle), 3))) continue;
      if (layout.landmarks.some((l) => convexOverlap(poly, rectCorners(l.x, l.y, l.kind === "pond" ? 64 : 24, l.kind === "pond" ? 46 : 24, 0), 2))) continue;
      parkings.push(p);
      placed++;
    }
  }
  const parkPolys = parkings.map((p) => rectCorners(p.x, p.y, p.w, p.d, p.angle));

  // ── 산책로: 출입구 → 가장 가까운 도로, 이웃 건물끼리 ──
  const walkways: Vec2[][] = [];
  const blocked = (a: Vec2, b: Vec2, skip: Set<number>): boolean => solids.some((s) =>
    !skip.has(s.b.id) && !isPlace(s.b) && polygonSegmentDistance(s.poly, a, b) < 1.5);
  const doors = new Map<number, Vec2>();
  for (const b of layout.buildings) {
    if (isPlace(b)) continue;
    const e = entrance(b, 6);
    doors.set(b.id, e);
    let best: Vec2 | undefined, bestD = Infinity;
    for (const s of segs) {
      const d = segmentDistance(e, s.a, s.b) - s.half;
      if (d < bestD) {
        const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((e[0] - s.a[0]) * dx + (e[1] - s.a[1]) * dy) / len2));
        bestD = d;
        best = [s.a[0] + t * dx, s.a[1] + t * dy];
      }
    }
    if (best && bestD < 90 && !blocked(e, best, new Set([b.id]))) walkways.push([localToWorld(b.x, b.y, b.angle, 0, b.d / 2 - 1), best]);
  }
  const linked = new Set<string>();
  const ids = [...doors.keys()];
  for (const id of ids) {
    const a = doors.get(id)!;
    const others = ids.filter((j) => j !== id).map((j) => ({ j, d: Math.hypot(doors.get(j)![0] - a[0], doors.get(j)![1] - a[1]) }))
      .sort((p, q) => p.d - q.d).slice(0, 2);
    for (const { j, d } of others) {
      const key = id < j ? `${id}-${j}` : `${j}-${id}`;
      if (d > 170 || linked.has(key)) continue;
      const b = doors.get(j)!;
      if (blocked(a, b, new Set([id, j]))) continue;
      if (site.reserved.slice(0, 2).some((r) => polygonSegmentDistance(r, a, b) < 0.5)) continue;
      linked.add(key);
      walkways.push([a, b]);
    }
  }

  // ── 가로등 (밤에 빛남) ──
  const lamps: Vec2[] = [];
  for (const road of site.roads) {
    if (road.kind !== "ring" && road.kind !== "campus") continue;
    const pts = road.closed ? resample([...road.pts, road.pts[0]], 34) : resample(road.pts, 34);
    for (let i = 0; i < pts.length; i++) {
      const t = tangentAt(pts, i, false);
      const side = i % 2 === 0 ? 1 : -1;
      lamps.push([pts[i][0] - t[1] * side * (road.width / 2 + 2), pts[i][1] + t[0] * side * (road.width / 2 + 2)]);
    }
  }

  // ── 나무 ──
  const trees: Tree[] = [];
  // 나무 자리 검사는 수천 번 돌므로 건물 둘레 상자는 여백별로 한 번만 만들고, 도로 선분은 격자로 찾는다.
  const solidBoxes = new Map<number, Poly[]>();
  const boxesFor = (pad: number): Poly[] => {
    let list = solidBoxes.get(pad);
    if (!list) {
      list = solids.map((s) => isPlace(s.b) ? rectCorners(s.b.x, s.b.y, s.b.w + 10, s.b.d + 10, s.b.angle)
        : rectCorners(s.b.x, s.b.y, s.b.w + pad * 2 + 8, s.b.d + pad * 2 + 8, s.b.angle));
      solidBoxes.set(pad, list);
    }
    return list;
  };
  const occupied = (p: Vec2, pad: number): boolean => {
    const boxes = boxesFor(pad);
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!near([s.b.x, s.b.y], p, s.r + pad + 8)) continue;
      if (pointInPolygon(p, boxes[i])) return true;
    }
    for (const k of segGrid.get(gridKey(Math.floor(p[0] / SEG_CELL), Math.floor(p[1] / SEG_CELL))) ?? []) {
      const s = segs[k];
      if (segmentDistance(p, s.a, s.b) < s.half + pad) return true;
    }
    for (const poly of parkPolys) if (pointInPolygon(p, poly)) return true;
    for (const l of layout.landmarks) {
      const r = l.kind === "pond" ? 34 : l.kind === "garden" ? 16 : 9;
      if (near([l.x, l.y], p, r + pad)) return true;
    }
    return false;
  };
  // 이미 심은 나무 가까이에 또 심지 않도록 (8m 칸 색인)
  const treeCells = new Map<number, Tree[]>();
  const TREE_CELL = 8;
  const addTree = (t: Tree): void => {
    trees.push(t);
    const key = gridKey(Math.floor(t.x / TREE_CELL), Math.floor(t.y / TREE_CELL));
    const list = treeCells.get(key);
    if (list) list.push(t); else treeCells.set(key, [t]);
  };
  const treeNear = (x: number, y: number, d: number): boolean => {
    const i0 = Math.floor((x - d) / TREE_CELL), i1 = Math.floor((x + d) / TREE_CELL);
    const j0 = Math.floor((y - d) / TREE_CELL), j1 = Math.floor((y + d) / TREE_CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        for (const t of treeCells.get(gridKey(i, j)) ?? []) if (Math.abs(t.x - x) < d && Math.abs(t.y - y) < d) return true;
      }
    }
    return false;
  };
  const walkBoxes = walkways.map(([a, b]) => [Math.min(a[0], b[0]) - 3.5, Math.min(a[1], b[1]) - 3.5, Math.max(a[0], b[0]) + 3.5, Math.max(a[1], b[1]) + 3.5]);
  const onWalk = (p: Vec2): boolean => walkways.some(([a, b], i) => {
    const w = walkBoxes[i];
    return p[0] >= w[0] && p[0] <= w[2] && p[1] >= w[1] && p[1] <= w[3] && segmentDistance(p, a, b) < 3.5;
  });

  const hashA = cellHash(seed, "tree-a"), hashB = cellHash(seed, "tree-b"), hashC = cellHash(seed, "tree-c");
  const groveNoise = createNoise2D(subRng(seed, "grove"));
  const step = 8;
  const bb = bounds(site.boundary);
  const cols = Math.ceil((bb.x1 - bb.x0) / step);
  const plazaRect = rectCorners(site.plaza.x, site.plaza.y + 0, site.plaza.w + 20, site.plaza.d + 100, 0);
  const axisSouth = site.reserved[0], axisNorth = site.reserved[1], monument = site.reserved[2];
  for (let j = 0; (bb.y0 + j * step) < bb.y1; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * 4096 + i;
      const p: Vec2 = [bb.x0 + (i + hashA(k)) * step, bb.y0 + (j + hashB(k)) * step];
      if (!insideAroundOrigin(site.boundary, p[0], p[1])) continue;
      const dEdge = Math.hypot(p[0] / site.rx, p[1] / site.ry);
      const g = fbm(groveNoise, p[0] / 140, p[1] / 140, 3);
      let density = 0.16 + 0.75 * Math.max(0, g + 0.15);
      if (dEdge > 0.9) density += 0.35; // 가장자리 숲 띠
      if (hashC(k) > density) continue;
      if (pointInPolygon(p, plazaRect) || pointInPolygon(p, axisSouth) || pointInPolygon(p, axisNorth) || pointInPolygon(p, monument)) continue;
      if (occupied(p, 3.5) || onWalk(p)) continue;
      const kindRoll = hashA(k + 777777);
      const kind: TreeKind = kindRoll < 0.22 ? 1 : kindRoll < 0.36 ? 2 : 0;
      addTree({ x: p[0], y: p[1], z: 0, r: 3 + hashB(k + 999) * 2.4, kind, c: hashC(k + 4242) });
    }
  }
  // 가로수: 중심축 산책로 양쪽 두 줄, 캠퍼스 도로변
  const plazaS = site.plaza.y + site.plaza.d / 2;
  for (let y = plazaS + 8; y < site.gateS[1] - 10; y += 10) {
    for (const x of [-AXIS_HALF + 2, -9.5, 9.5, AXIS_HALF - 2]) {
      const p: Vec2 = [x, y];
      if (occupied(p, 1)) continue;
      addTree({ x, y, z: 0, r: 3.6, kind: 3, c: hashA(Math.round(y * 10 + x)) });
    }
  }
  for (const road of site.roads) {
    if (road.kind !== "campus" && road.kind !== "ring" && road.kind !== "connector") continue;
    const pts = road.closed ? resample([...road.pts, road.pts[0]], 13) : resample(road.pts, 13);
    for (let i = 1; i < pts.length - 1; i++) {
      const t = tangentAt(pts, i, false);
      for (const side of [1, -1]) {
        const off = road.width / 2 + 4;
        const p: Vec2 = [pts[i][0] - t[1] * side * off, pts[i][1] + t[0] * side * off];
        if (road.kind !== "connector" && !insideAroundOrigin(site.boundary, p[0], p[1])) continue;
        if (occupied(p, 1.5) || onWalk(p)) continue;
        if (Math.abs(p[0]) < AXIS_HALF + 4 && p[1] > site.plaza.y) continue;
        if (treeNear(p[0], p[1], 5)) continue;
        const roll = hashB(i * 31 + (side > 0 ? 1 : 0));
        addTree({ x: p[0], y: p[1], z: 0, r: 3.2, kind: roll < 0.2 ? 2 : 0, c: hashC(i * 17 + (side > 0 ? 7 : 9)) });
      }
    }
  }

  // 나무 심기·베기
  for (const g of layout.groves ?? []) {
    const hash = cellHash(seed, `grove:${Math.round(g.x)}:${Math.round(g.y)}`);
    const step = 7;
    let k = 0;
    for (let gy = -g.r; gy <= g.r; gy += step) {
      for (let gx = -g.r; gx <= g.r; gx += step, k++) {
        const p: Vec2 = [g.x + gx + (hash(k) - 0.5) * step * 0.8, g.y + gy + (hash(k + 5000) - 0.5) * step * 0.8];
        if (Math.hypot(p[0] - g.x, p[1] - g.y) > g.r) continue;
        if (occupied(p, 3) || onWalk(p)) continue;
        if (treeNear(p[0], p[1], 4)) continue;
        const roll = hash(k + 9000);
        addTree({ x: p[0], y: p[1], z: 0, r: 3.2 + hash(k + 7000) * 2.2, kind: roll < 0.25 ? 1 : roll < 0.4 ? 2 : 0, c: hash(k + 11000) });
      }
    }
  }
  const cuts = layout.clearings ?? [];
  const cut = (t: Tree): boolean => cuts.some((c) => Math.abs(c.x - t.x) < c.r && Math.abs(c.y - t.y) < c.r && Math.hypot(c.x - t.x, c.y - t.y) < c.r);
  if (cuts.length) {
    for (let i = trees.length - 1; i >= 0; i--) if (cut(trees[i])) trees.splice(i, 1);
  }
  const sur = surroundings ?? makeSurroundings(site, seed, surround, cam);
  return {
    site, layout, surround, models, walkways, aprons, parkings, trees: trees.concat(cuts.length ? sur.trees.filter((t) => !cut(t)) : sur.trees),
    campusTrees: trees.length, streets: sur.streets, city: sur.city,
    cityGround: sur.cityGround, lamps, height,
  };
}

/** 배치와 무관한 주변(도시 블록·거리·가로수). 시드·주변·시점이 같으면 다시 쓰도록 따로 만든다. */
export interface Surroundings { streets: Road[]; city: CityBox[]; cityGround: Poly[]; trees: Tree[] }

export function makeSurroundings(site: Site, seed: string, surround: Surround, cam: Camera): Surroundings {
  const segs = roadSegments(site);
  const { streets, city, cityGround } = makeCity(site, seed, surround, cam, segs);
  const trees: Tree[] = [];
  const hashA = cellHash(seed, "street-a"), hashB = cellHash(seed, "street-b");
  const vis = visibleGround(cam, surround === "city" ? 2600 : 2000);
  for (const s of streets) {
    const pts = resample(s.pts, 22);
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i];
      if (q[0] < vis.x0 - 50 || q[0] > vis.x1 + 50 || q[1] < vis.y0 - 50 || q[1] > vis.y1 + 50) continue;
      // 먼 거리의 가로수는 점처럼 작아 보이지 않으므로 심지 않는다.
      if (Math.hypot(q[0], q[1] - site.ry * 0.3) > site.rx * 2.6) continue;
      const t = tangentAt(pts, i, false);
      for (const side of [1, -1]) {
        const p: Vec2 = [pts[i][0] - t[1] * side * (s.width / 2 + 2.5), pts[i][1] + t[0] * side * (s.width / 2 + 2.5)];
        if (Math.hypot(p[0] / (site.rx + 70), p[1] / (site.ry + 70)) < 1.04) continue;
        trees.push({ x: p[0], y: p[1], z: 0, r: 2.6, kind: 3, c: hashA(i * 7 + (side > 0 ? 3 : 5)) });
      }
    }
  }
  // 간선도로 가로수
  for (let x = Math.max(-2400, vis.x0 - 40); x <= Math.min(2400, vis.x1 + 40); x += 14) {
    for (const side of [-1, 1]) {
      const p: Vec2 = [x, site.arterialY + side * 18.5];
      if (Math.abs(x) < 40) continue;
      if (site.roads.some((r) => r.kind === "connector" && Math.abs(r.pts[0][0] - x) < 10)) continue;
      trees.push({ x: p[0], y: p[1], z: 0, r: 3, kind: 3, c: hashB(Math.round(x) + 100000) });
    }
  }
  return { streets, city, cityGround, trees };
}

/** 카메라에 보이는 지면 범위 (월드) */
export function visibleGround(cam: Camera, maxDist = 3200): { x0: number; x1: number; y0: number; y1: number } {
  const pts: Vec2[] = [];
  for (let k = 0; k <= 10; k++) {
    for (const [sx, sy] of [[(k / 10) * cam.width, 0], [(k / 10) * cam.width, cam.height], [0, (k / 10) * cam.height], [cam.width, (k / 10) * cam.height]]) {
      const g = unproject(cam, sx, sy);
      if (g && Math.hypot(g[0] - cam.cx, g[1] - cam.cy) < maxDist * 1.5) pts.push(g);
    }
  }
  // 수평선이 보이면 위쪽 가장자리는 최대 거리로 자른다.
  pts.push([cam.cx - maxDist, cam.cy - maxDist], [cam.cx + maxDist, cam.cy - maxDist]);
  const b = bounds(pts);
  return { x0: Math.max(b.x0, cam.cx - maxDist), x1: Math.min(b.x1, cam.cx + maxDist), y0: Math.max(b.y0, cam.cy - maxDist * 1.2), y1: b.y1 };
}

function makeCity(
  site: Site, seed: string, surround: Surround, cam: Camera, segs: ReturnType<typeof roadSegments>,
): { streets: Road[]; city: CityBox[]; cityGround: Poly[] } {
  const rng = subRng(seed, "city");
  const vis = visibleGround(cam, surround === "city" ? 2600 : 2000);
  const streets: Road[] = [];
  const city: CityBox[] = [];
  const cityGround: Poly[] = [];
  const top = surround === "city" ? vis.y0 : site.arterialY + site.roads[0].width / 2;
  const bottom = Math.min(vis.y1 + 60, cam.cy - 60);
  if (!(bottom > top)) return { streets, city, cityGround };
  const x0 = vis.x0 - 100, x1 = vis.x1 + 100;
  cityGround.push([[x0, top], [x1, top], [x1, bottom], [x0, bottom]]);
  const bx = 96 + rng() * 20, by = 78 + rng() * 14;
  const offX = rng() * bx, offY = site.arterialY + 15;
  const keepOut = (x: number, y: number, pad: number): boolean => {
    const e = Math.hypot(x / (site.rx + pad), y / (site.ry + pad));
    return e < 1.04;
  };
  // 남북 거리
  for (let x = Math.floor((x0 - offX) / bx) * bx + offX; x < x1; x += bx) {
    if (Math.abs(x) < 60) continue;
    const line: Vec2[] = [[x, Math.max(top, offY - 4000)], [x, bottom]];
    streets.push({ kind: "street", pts: line, width: 12 });
  }
  // 동서 거리
  const firstY = surround === "city" ? Math.floor((top - offY) / by) * by + offY : offY + by;
  for (let y = firstY; y < bottom; y += by) {
    if (Math.abs(y - site.arterialY) < 30) continue;
    streets.push({ kind: "street", pts: [[x0, y], [x1, y]], width: 12 });
  }
  // 블록 → 필지 → 건물
  const hashH = cellHash(seed, "city-h");
  let k = 0;
  for (let gx = Math.floor((x0 - offX) / bx) * bx + offX; gx < x1; gx += bx) {
    for (let gy = surround === "city" ? Math.floor((top - offY) / by) * by + offY : offY; gy < bottom; gy += by) {
      const bx0 = gx + 10, bx1 = gx + bx - 10, by0 = gy + 10, by1 = gy + by - 10;
      if (by0 < top + 4) continue;
      const nu = 2 + Math.floor(hashH(k++) * 3), nv = 2;
      for (let iu = 0; iu < nu; iu++) {
        for (let iv = 0; iv < nv; iv++) {
          const lw = (bx1 - bx0) / nu, ld = (by1 - by0) / nv;
          const cx = bx0 + lw * (iu + 0.5), cy = by0 + ld * (iv + 0.5);
          const roll = hashH(k++);
          if (roll < 0.08) continue; // 빈 필지 (공터·주차장)
          if (keepOut(cx, cy, 70)) continue;
          if (surround === "forest" && cy < site.arterialY + 20) continue;
          const w = lw - 6 - hashH(k++) * 6, d = ld - 6 - hashH(k++) * 6;
          const poly = rectCorners(cx, cy, w, d, 0);
          const reach = Math.max(w, d) / 2 + 3;
          if (segs.some((s) => s.maxX + reach > cx && s.minX - reach < cx && s.maxY + reach > cy && s.minY - reach < cy
            && polygonSegmentDistance(poly, s.a, s.b) < s.half + 2)) continue;
          const distC = Math.hypot(cx, cy - site.arterialY);
          const tall = Math.max(0, 1 - distC / 1800);
          const floors = 3 + Math.floor(Math.pow(hashH(k++), 2.2) * (6 + 16 * tall));
          city.push({ x: cx, y: cy, w, d, angle: 0, h: floors * 3.3, tone: hashH(k++) });
        }
      }
    }
  }
  return { streets, city, cityGround };
}
