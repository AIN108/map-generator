// 걸어서 가는 길: 캠퍼스를 4m 격자로 나눠 건물은 막고, 길·포장 마당은 잔디보다 걷기 쉽게 두고 경로를 찾는다.

import { bounds, pointInPolygon, rectCorners, segmentDistance, type Poly, type Vec2 } from "./geom.ts";
import { isPlace } from "./layout.ts";
import type { Scene } from "./scene.ts";

export const WALK_SPEED = 80; // m/분 (성인 보통 걸음)
const CELL = 4;
const PAVED = 1, LAWN = 1.35;

export interface WalkGrid {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  /** 칸마다 걷는 비용 (Infinity = 못 감) */
  cost: Float32Array;
}

/** 장면에서 걷기 격자를 만든다 (배치가 바뀌면 새로 만든다). */
export function buildWalkGrid(scene: Scene): WalkGrid {
  const site = scene.site;
  const bb = bounds(site.boundary);
  const x0 = bb.x0 - 20, y0 = bb.y0 - 20;
  const cols = Math.ceil((bb.x1 - x0 + 20) / CELL), rows = Math.ceil((Math.max(bb.y1, site.arterialY) - y0 + 20) / CELL);
  const cost = new Float32Array(cols * rows).fill(Infinity);
  const blocks: Poly[] = [];
  const paved: Poly[] = [...scene.aprons, ...site.reserved.slice(0, 2)];
  for (const b of scene.layout.buildings) {
    if (b.shape === "plaza") paved.push(rectCorners(b.x, b.y, b.w, b.d, b.angle));
    else if (isPlace(b)) blocks.push(rectCorners(b.x, b.y, b.w - 6, b.d - 6, b.angle));
    else blocks.push(rectCorners(b.x, b.y, b.w + 2, b.d + 2, b.angle));
  }
  const boxes = (polys: Poly[]) => polys.map((p) => ({ p, b: bounds(p) }));
  const blockB = boxes(blocks), pavedB = boxes(paved);
  const segs: { a: Vec2; b: Vec2; half: number }[] = [];
  for (const r of site.roads) {
    if (r.kind === "forest" || r.kind === "street") continue;
    const n = r.closed ? r.pts.length : r.pts.length - 1;
    for (let i = 0; i < n; i++) segs.push({ a: r.pts[i], b: r.pts[(i + 1) % r.pts.length], half: r.width / 2 + 1.5 });
  }
  for (const w of scene.walkways) for (let i = 0; i + 1 < w.length; i++) segs.push({ a: w[i], b: w[i + 1], half: 3 });
  // 선분을 칸 격자에 미리 나눠 담아 칸마다 가까운 선분만 본다.
  const bucket = new Map<number, number[]>();
  const B = 32;
  segs.forEach((s, k) => {
    const minX = Math.min(s.a[0], s.b[0]) - s.half, maxX = Math.max(s.a[0], s.b[0]) + s.half;
    const minY = Math.min(s.a[1], s.b[1]) - s.half, maxY = Math.max(s.a[1], s.b[1]) + s.half;
    for (let i = Math.floor(minX / B); i <= Math.floor(maxX / B); i++) {
      for (let j = Math.floor(minY / B); j <= Math.floor(maxY / B); j++) {
        const key = (i + 1000) * 2000 + (j + 1000);
        let l = bucket.get(key);
        if (!l) bucket.set(key, (l = []));
        l.push(k);
      }
    }
  });
  const gate = site.gateS;
  const poly = site.boundary;
  for (let r = 0; r < rows; r++) {
    // 이 줄에서 경계 안에 드는 x 구간 (주사선)
    const yc = y0 + (r + 0.5) * CELL;
    const xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > yc) !== (yj > yc)) xs.push(xi + ((yc - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    const inside = (x: number): boolean => {
      let k = 0;
      while (k < xs.length && xs[k] < x) k++;
      return k % 2 === 1;
    };
    for (let c = 0; c < cols; c++) {
      const p: Vec2 = [x0 + (c + 0.5) * CELL, yc];
      const inGate = Math.abs(p[0]) < 56 && p[1] > gate[1] - 34 && p[1] < site.arterialY - 14;
      if (!inGate && !inside(p[0])) continue;
      if (blockB.some(({ p: poly, b }) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1 && pointInPolygon(p, poly))) continue;
      let k = inGate ? PAVED : LAWN;
      if (k !== PAVED) {
        const list = bucket.get((Math.floor(p[0] / B) + 1000) * 2000 + (Math.floor(p[1] / B) + 1000)) ?? [];
        if (list.some((i) => segmentDistance(p, segs[i].a, segs[i].b) < segs[i].half)) k = PAVED;
        else if (pavedB.some(({ p: poly, b }) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1 && pointInPolygon(p, poly))) k = PAVED;
      }
      cost[r * cols + c] = k;
    }
  }
  return { x0, y0, cols, rows, cost };
}

const cellOf = (g: WalkGrid, p: Vec2): number => {
  const c = Math.floor((p[0] - g.x0) / CELL), r = Math.floor((p[1] - g.y0) / CELL);
  return c < 0 || r < 0 || c >= g.cols || r >= g.rows ? -1 : r * g.cols + c;
};
const centerOf = (g: WalkGrid, i: number): Vec2 => [g.x0 + ((i % g.cols) + 0.5) * CELL, g.y0 + (Math.floor(i / g.cols) + 0.5) * CELL];

/** p에서 가장 가까운 걸을 수 있는 칸 */
function nearestOpen(g: WalkGrid, p: Vec2): number {
  const c0 = Math.floor((p[0] - g.x0) / CELL), r0 = Math.floor((p[1] - g.y0) / CELL);
  for (let rad = 0; rad < 12; rad++) {
    let best = -1, bestD = Infinity;
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const r = r0 + dr, c = c0 + dc;
        if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) continue;
        const i = r * g.cols + c;
        if (!Number.isFinite(g.cost[i])) continue;
        const d = dr * dr + dc * dc;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** 작은 이진 힙 (우선순위가 낮은 것부터) */
class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number { return this.ids.length; }
  push(id: number, key: number): void {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p];
      i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!, lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lastKey;
        if (l < n && keys[l] < mk) { m = l; mk = keys[l]; }
        if (r < n && keys[r] < mk) { m = r; mk = keys[r]; }
        if (m === i) break;
        ids[i] = ids[m]; keys[i] = keys[m];
        i = m;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return top;
  }
}

const NB: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** 한 곳에서 모든 칸까지 걷는 비용과 되짚을 부모 칸 (다익스트라) */
export function walkField(g: WalkGrid, from: Vec2): { dist: Float64Array; parent: Int32Array; start: number } {
  const n = g.cols * g.rows;
  const dist = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const start = nearestOpen(g, from);
  if (start < 0) return { dist, parent, start };
  dist[start] = 0;
  const heap = new MinHeap();
  heap.push(start, 0);
  const done = new Uint8Array(n);
  while (heap.size) {
    const i = heap.pop();
    if (done[i]) continue; // 더 짧은 길로 이미 꺼낸 칸
    done[i] = 1;
    const d = dist[i];
    const c = i % g.cols, r = (i - c) / g.cols;
    for (const [dc, dr, len] of NB) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) continue;
      const j = rr * g.cols + cc;
      const cj = g.cost[j];
      if (!Number.isFinite(cj)) continue;
      // 대각선은 양옆 칸이 막혀 있으면 지나가지 않는다 (건물 모서리 뚫기 방지)
      if (dc && dr && (!Number.isFinite(g.cost[r * g.cols + cc]) || !Number.isFinite(g.cost[rr * g.cols + c]))) continue;
      const nd = d + len * CELL * (g.cost[i] + cj) / 2;
      if (nd < dist[j]) {
        dist[j] = nd;
        parent[j] = i;
        heap.push(j, nd);
      }
    }
  }
  return { dist, parent, start };
}

export interface WalkPath { path: Vec2[]; meters: number; minutes: number }

/** walkField 결과에서 to까지의 길 (못 가면 undefined) */
export function pathTo(g: WalkGrid, field: ReturnType<typeof walkField>, to: Vec2, from: Vec2): WalkPath | undefined {
  const end = nearestOpen(g, to);
  if (end < 0 || !Number.isFinite(field.dist[end])) return undefined;
  const cells: number[] = [];
  for (let i = end; i >= 0; i = field.parent[i]) {
    cells.push(i);
    if (i === field.start) break;
  }
  cells.reverse();
  const raw: Vec2[] = [from, ...cells.map((i) => centerOf(g, i)), to];
  const path = simplify(g, raw);
  let meters = 0;
  for (let i = 1; i < path.length; i++) meters += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return { path, meters, minutes: meters / WALK_SPEED };
}

/** 두 곳 사이 걷는 길 */
export function walkRoute(g: WalkGrid, from: Vec2, to: Vec2): WalkPath | undefined {
  return pathTo(g, walkField(g, from), to, from);
}

/** 곧은 줄로 이어도 막힌 칸을 지나지 않고 걷기 비용이 크게 늘지 않으면 사이 점을 뺀다. */
function simplify(g: WalkGrid, pts: Vec2[]): Vec2[] {
  if (pts.length <= 2) return pts;
  const out: Vec2[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = Math.min(pts.length - 1, i + 40);
    while (j > i + 1 && !clearLine(g, pts[i], pts[j], costAlong(g, pts, i, j))) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

function costAlong(g: WalkGrid, pts: Vec2[], i: number, j: number): number {
  let worst = 0;
  for (let k = i; k <= j; k++) {
    const c = cellOf(g, pts[k]);
    if (c >= 0 && Number.isFinite(g.cost[c])) worst = Math.max(worst, g.cost[c]);
  }
  return worst;
}

function clearLine(g: WalkGrid, a: Vec2, b: Vec2, maxCost: number): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len / (CELL / 2)));
  for (let k = 1; k < n; k++) {
    const p: Vec2 = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
    const c = cellOf(g, p);
    if (c < 0) return false;
    const v = g.cost[c];
    if (!Number.isFinite(v) || v > maxCost + 1e-6) return false;
  }
  return true;
}

/** 'n분' 표시 (1분보다 짧으면 1분) */
export const minutesText = (min: number): string => (min < 1.5 ? "1분 남짓" : `약 ${Math.round(min)}분`);
