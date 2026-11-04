// 부지: 캠퍼스 경계, 순환도로, 중심축(정문~광장~본관~후문), 간선도로. 시드와 건물 수로만 정해진다.

import {
  chaikinClosed, chaikinOpen, polygonArea, rayPolygon, resample, tangentAt, type Poly, type Vec2,
} from "./geom.ts";
import { createNoise2D, subRng, type Rng } from "./rng.ts";

export type RoadKind = "arterial" | "ring" | "campus" | "connector" | "street" | "forest" | "path";

export interface Road {
  kind: RoadKind;
  pts: Vec2[];
  /** 전체 폭 (m) */
  width: number;
  closed?: boolean;
}

export interface Rect { x: number; y: number; w: number; d: number }

/** 캠퍼스 유형: 전원형(타원 경계·순환도로·방사형 도로), 도심 격자형(둥근 사각형·바둑판 길), 강변형(동서로 긴 경계·북쪽 강·동서 간선) */
export type CampusType = "classic" | "grid" | "river";
export const CAMPUS_TYPES: CampusType[] = ["classic", "grid", "river"];
export const CAMPUS_KO: Record<CampusType, string> = { classic: "전원형", grid: "도심 격자형", river: "강변형" };
/** 밀도: 같은 건물 수에서 캠퍼스 크기를 줄이거나 넓힌다 */
export type Density = "loose" | "normal" | "dense";
export const DENSITIES: Density[] = ["loose", "normal", "dense"];
export const DENSITY_KO: Record<Density, string> = { loose: "여유", normal: "보통", dense: "촘촘" };
export const DENSITY_SCALE: Record<Density, number> = { loose: 1.12, normal: 1, dense: 0.94 };

export interface Site {
  /** 캠퍼스 반지름 (동서, 남북) */
  rx: number;
  ry: number;
  /** 캠퍼스 경계 (반시계, 닫힌 다각형) */
  boundary: Poly;
  /** 순환도로 중심선 (닫힌 선) */
  ring: Vec2[];
  /** 중심 구역을 감싸는 도로 (닫힌 선) */
  coreLoop: Vec2[];
  /** 중심 구역 안쪽 (일반 건물을 두지 않는 곳) */
  coreRect: Rect;
  roads: Road[];
  gateS: Vec2;
  gateN: Vec2;
  plaza: Rect;
  adminY: number;
  monumentY: number;
  arterialY: number;
  /** 동서 반전 (구역 배치를 좌우로 뒤집는다) */
  mirror: boolean;
  /** 건물을 둘 수 없는 곳 (중심축 산책로, 정문·후문 앞, 기념비 둘레) */
  reserved: Poly[];
  /** 캠퍼스 유형 (없으면 전원형) */
  type?: CampusType;
  /** 강 (중심선과 폭) */
  water?: { pts: Vec2[]; width: number };
}

export const RING_WIDTH = 11;
export const CAMPUS_ROAD_WIDTH = 9;
export const ARTERIAL_WIDTH = 30;
export const AXIS_HALF = 22;

/** 건물 수에 따른 캠퍼스 크기 (동서 반지름) */
export const campusRadius = (buildings: number): number => 296 + 3.7 * buildings;

const rectPoly = (x0: number, y0: number, x1: number, y1: number): Poly => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function roundedRectLoop(x0: number, y0: number, x1: number, y1: number, r: number): Vec2[] {
  const pts: Vec2[] = [];
  const corners: [number, number, number][] = [
    [x1 - r, y1 - r, 0], [x0 + r, y1 - r, Math.PI / 2], [x0 + r, y0 + r, Math.PI], [x1 - r, y0 + r, (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (k / 6) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return resample([...pts, pts[0]], 8).slice(0, -1);
}

/** 경계 다각형을 법선 방향 안쪽으로 inset만큼 줄인 닫힌 선 */
export function insetLoop(loop: Poly, inset: number): Vec2[] {
  const ccw = polygonArea(loop) > 0;
  return loop.map((p, i) => {
    const t = tangentAt(loop, i, true);
    // 면적이 양수(수학 좌표계 기준 반시계)면 왼쪽 법선 (-t.y, t.x)이 안쪽
    const s = ccw ? 1 : -1;
    return [p[0] - t[1] * inset * s, p[1] + t[0] * inset * s] as Vec2;
  });
}

export interface SiteOptions {
  /** 동서 반전을 정한다 (목록 입력에서 방향을 지키려면 false) */
  mirror?: boolean;
  /** 캠퍼스 동서·남북 크기 (m). 건물 수에 비해 너무 작으면 키운다. */
  size?: [number, number];
  /** 방사형 도로를 내지 않을 방향 (도, 동쪽 0·북쪽 90) */
  avoid?: number[];
  type?: CampusType;
  /** 캠퍼스 크기 배율 (밀도) */
  scale?: number;
}

/** 닫힌 다각형과 직선 x=c(세로) 또는 y=c(가로)가 겹치는 구간들 */
function lineIntervals(poly: Poly, vertical: boolean, c: number): [number, number][] {
  const hits: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ka = vertical ? a[0] : a[1], kb = vertical ? b[0] : b[1];
    if ((ka - c) * (kb - c) > 0 || ka === kb) continue;
    const t = (c - ka) / (kb - ka);
    hits.push(vertical ? a[1] + (b[1] - a[1]) * t : a[0] + (b[0] - a[0]) * t);
  }
  hits.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < hits.length; k += 2) out.push([hits[k], hits[k + 1]]);
  return out;
}

/** 구간에서 막힌 구간들을 뺀다 */
function subtract(spans: [number, number][], cuts: [number, number][]): [number, number][] {
  let out = spans;
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = [];
    for (const [a, b] of out) {
      if (c1 <= a || c0 >= b) { next.push([a, b]); continue; }
      if (c0 > a) next.push([a, c0]);
      if (c1 < b) next.push([c1, b]);
    }
    out = next;
  }
  return out;
}

export function generateSite(seed: string, buildings: number, opts: SiteOptions = {}): Site {
  const rng: Rng = subRng(seed, "site");
  const noise = createNoise2D(subRng(seed, "site-noise"));
  const type = opts.type ?? "classic";
  const scale = opts.scale ?? 1;
  let rx = campusRadius(buildings) * scale;
  let ry = rx * 0.8;
  if (opts.size) {
    // 적힌 크기를 따르되, 건물 수에 비해 너무 좁으면 자동 배치와 같은 크기까지 넓힌다.
    rx = Math.max(opts.size[0] / 2, campusRadius(buildings) * scale);
    ry = Math.max(opts.size[1] / 2, rx * 0.62);
    ry = Math.min(ry, rx * 1.05);
  } else if (type === "river") {
    // 강을 따라 동서로 길게 (넓이는 비슷하게)
    rx *= 1.16;
    ry *= 0.8;
  } else if (type === "grid") {
    // 둥근 사각형은 같은 반지름의 타원보다 넓으므로 조금 줄인다
    rx *= 0.94;
    ry *= 0.94;
  }
  const mirrorRoll = rng() < 0.5;
  const mirror = opts.mirror ?? mirrorRoll;

  // 경계: 타원 + 방향별 노이즈. 남쪽(정문)은 덜 흔들어 정면을 반듯하게 둔다.
  const N = 180;
  const raw: Vec2[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const nx = Math.cos(a) * 1.3, ny = Math.sin(a) * 1.3;
    const southness = Math.max(0, Math.sin(a)); // 화면 아래(남쪽)가 y 양수
    const northness = Math.max(0, -Math.sin(a));
    let amp = 1 - 0.75 * Math.pow(southness, 3);
    // 격자형은 반듯하게, 강변형은 강 쪽(북쪽)을 강을 따라 완만하게
    if (type === "grid") amp *= 0.25;
    if (type === "river") amp *= 1 - 0.6 * Math.pow(northness, 2);
    const r = 1 + amp * (0.075 * noise(nx, ny) + 0.035 * noise(nx * 2.7 + 5, ny * 2.7 - 3));
    // 격자형: 초타원 (|x|^4 + |y|^4 = 1)으로 둥근 사각형
    const sq = type === "grid" ? 1 / Math.pow(Math.pow(Math.abs(Math.cos(a)), 4) + Math.pow(Math.abs(Math.sin(a)), 4), 0.25) : 1;
    raw.push([Math.cos(a) * rx * r * sq, Math.sin(a) * ry * r * sq]);
  }
  const boundary = chaikinClosed(raw, 1);
  const ring = insetLoop(boundary, 24);

  const south = rayPolygon([0, 0], Math.PI / 2, boundary);
  const north = rayPolygon([0, 0], -Math.PI / 2, boundary);
  const gateS: Vec2 = [0, south];
  const gateN: Vec2 = [0, -north];
  const ringSouth = rayPolygon([0, 0], Math.PI / 2, ring);
  const ringNorth = rayPolygon([0, 0], -Math.PI / 2, ring);

  // 중심 구역: 광장 → 북쪽에 대학본부, 양옆에 도서관·학생회관
  const py = ry * 0.1;
  const plaza: Rect = { x: 0, y: py, w: 126, d: 84 };
  const adminY = py - plaza.d / 2 - 34 - 16;
  const adminNorth = adminY - 17;
  const coreX = 196;
  const coreTop = adminNorth - 20;
  const coreBottom = py + plaza.d / 2 + 22;
  const coreLoop = roundedRectLoop(-coreX, coreTop, coreX, coreBottom, 46);
  const coreRect: Rect = {
    x: 0, y: (coreTop + coreBottom) / 2, w: coreX * 2 - CAMPUS_ROAD_WIDTH - 8, d: coreBottom - coreTop - CAMPUS_ROAD_WIDTH - 8,
  };
  // 기념비는 본관 뒤와 후문 사이 가운데 (좁은 부지에서도 본관과 겹치지 않게)
  const monumentY = Math.min((adminNorth + -ringNorth) / 2, adminNorth - 48);

  // 간선도로: 정문 앞을 지나는 동서 방향 큰길
  let southMost = 0;
  for (const p of boundary) southMost = Math.max(southMost, p[1]);
  const arterialY = southMost + 40;

  const roads: Road[] = [];
  roads.push({ kind: "arterial", pts: [[-4000, arterialY], [4000, arterialY]], width: ARTERIAL_WIDTH });
  roads.push({ kind: "ring", pts: ring, width: RING_WIDTH, closed: true });
  roads.push({ kind: "campus", pts: coreLoop, width: CAMPUS_ROAD_WIDTH, closed: true });

  // 방사형 도로: 중심 구역 도로에서 순환도로까지. 운동장·병원 쪽과 중심축 근처는 피한다.
  // (격자형·강변형도 난수열을 같은 순서로 쓰도록 계산은 하고, 길만 다르게 낸다)
  const avoid = opts.avoid ?? [212, 312].map((a) => (mirror ? 180 - a : a));
  const candidates = [0, 28, 55, 125, 152, 180, 235, 290, 330].map((a) => (mirror ? 180 - a : a));
  const chosen: number[] = [];
  const shuffled = candidates.map((a) => ({ a, k: rng() })).sort((p, q) => p.k - q.k).map((p) => p.a);
  const target = 4 + Math.floor(rng() * 2) + (buildings > 24 ? 1 : 0);
  const angDiff = (a: number, b: number): number => {
    const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
    return d;
  };
  for (const a of shuffled) {
    if (chosen.length >= target) break;
    if (avoid.some((v) => angDiff(a, v) < 24)) continue;
    if (angDiff(a, 90) < 26 || angDiff(a, 270) < 30) continue;
    if (chosen.some((c) => angDiff(a, c) < 38)) continue;
    chosen.push(a);
  }
  const coreCenter: Vec2 = [0, (coreTop + coreBottom) / 2];
  for (const deg of chosen) {
    const ang = (-deg * Math.PI) / 180; // y가 아래로 커지므로 북쪽은 음수 각
    const r0 = rayPolygon(coreCenter, ang, coreLoop);
    const r1 = rayPolygon(coreCenter, ang, ring);
    if (!(r1 > r0 + 40)) continue;
    const dir: Vec2 = [Math.cos(ang), Math.sin(ang)];
    const a: Vec2 = [coreCenter[0] + dir[0] * r0, coreCenter[1] + dir[1] * r0];
    const b: Vec2 = [coreCenter[0] + dir[0] * r1, coreCenter[1] + dir[1] * r1];
    const bend = (rng() - 0.5) * 0.35 * (r1 - r0);
    const mid: Vec2 = [(a[0] + b[0]) / 2 - dir[1] * bend, (a[1] + b[1]) / 2 + dir[0] * bend];
    const line = chaikinOpen(resample([a, mid, b], 12), 2);
    if (type === "classic") roads.push({ kind: "campus", pts: line, width: CAMPUS_ROAD_WIDTH });
  }
  const ringSouthY = ringSouth, ringNorthY = -ringNorth;
  const axisCuts = (c: number): [number, number][] => {
    const cuts: [number, number][] = [];
    if (c > coreTop - 8 && c < coreBottom + 8) cuts.push([-coreX - 8, coreX + 8]);
    if (c >= coreBottom + 8) cuts.push([-AXIS_HALF - 8, AXIS_HALF + 8]);
    if (c <= coreTop - 8) cuts.push(Math.abs(c - monumentY) < 52 ? [-56, 56] : [-24, 24]);
    return cuts;
  };
  const pushSpans = (vertical: boolean, c: number, spans: [number, number][]): void => {
    for (const [a, b] of spans) {
      if (b - a < 60) continue;
      const pts: Vec2[] = vertical ? [[c, a], [c, b]] : [[a, c], [b, c]];
      roads.push({ kind: "campus", pts: resample(pts, 20), width: CAMPUS_ROAD_WIDTH });
    }
  };
  if (type === "grid") {
    // 바둑판 길: 중심 구역 둘레와 중심축을 비켜 세로·가로로
    const step = 150;
    for (let k = 1; k * step < rx * 0.92; k++) {
      for (const sx of [-1, 1]) {
        const c = sx * k * step;
        const cuts: [number, number][] = Math.abs(c) < coreX + 8 ? [[coreTop - 8, coreBottom + 8]] : [];
        pushSpans(true, c, subtract(lineIntervals(ring, true, c), cuts));
      }
    }
    const cy = (coreTop + coreBottom) / 2;
    for (let k = 1; ; k++) {
      let any = false;
      for (const sy of [-1, 1]) {
        const c = cy + sy * (k * step - step * 0.15);
        if (c < ringNorthY + 40 || c > ringSouthY - 40) continue;
        any = true;
        pushSpans(false, c, subtract(lineIntervals(ring, false, c), axisCuts(c)));
      }
      if (!any) break;
    }
  } else if (type === "river") {
    // 동서로 긴 간선 두 줄 (중심 구역 위·아래)과 남북 길 몇 줄
    for (const c of [(coreTop + ringNorthY) / 2 + 10, (coreBottom + ringSouthY) / 2 - 6]) {
      pushSpans(false, c, subtract(lineIntervals(ring, false, c), axisCuts(c)));
    }
    for (const f of [0.52, 0.8]) {
      for (const sx of [-1, 1]) {
        const c = sx * (coreX + (rx - coreX) * f * 0.9);
        pushSpans(true, c, lineIntervals(ring, true, c));
      }
    }
  }

  // 순환도로에서 간선도로로 내려가는 연결로 (양쪽)
  for (const sx of [-1, 1]) {
    const x = sx * rx * (0.44 + rng() * 0.08);
    let ringY = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if ((a[0] - x) * (b[0] - x) <= 0 && a[1] > 0) {
        const t = (x - a[0]) / (b[0] - a[0] || 1);
        ringY = Math.max(ringY, a[1] + (b[1] - a[1]) * t);
      }
    }
    if (ringY > 0) roads.push({ kind: "connector", pts: [[x, ringY], [x, arterialY]], width: CAMPUS_ROAD_WIDTH });
  }

  // 후문에서 숲으로 이어지는 구불구불한 길
  const forestRoad: Vec2[] = [[0, -ringNorth]];
  let fx = 0;
  for (let y = -north - 30; y > -north - 1400; y -= 60) {
    fx += (rng() - 0.5) * 70;
    forestRoad.push([fx, y]);
  }
  roads.push({ kind: "forest", pts: chaikinOpen(forestRoad, 3), width: 8 });

  const reserved: Poly[] = [
    rectPoly(-AXIS_HALF, plaza.y + plaza.d / 2 - 4, AXIS_HALF, ringSouth + 30), // 정문~광장 산책로
    rectPoly(-16, -ringNorth - 30, 16, adminNorth - 6), // 본관 뒤~후문
    rectPoly(-44, monumentY - 40, 44, monumentY + 40), // 기념비 둘레
    rectPoly(-60, gateS[1] - 50, 60, arterialY), // 정문 앞
  ];

  const site: Site = {
    rx, ry, boundary, ring, coreLoop, coreRect, roads, gateS, gateN, plaza, adminY, monumentY, arterialY, mirror,
    reserved,
  };
  if (type !== "classic") site.type = type;
  if (type === "river") {
    // 북쪽 강: 경계 북쪽 끝에서 조금 떨어져 동서로 굽이친다
    let northMost = 0;
    for (const p of boundary) northMost = Math.min(northMost, p[1]);
    const wrng = subRng(seed, "river");
    const pts: Vec2[] = [];
    let wy = northMost - 95;
    for (let x = -3600; x <= 3600; x += 120) {
      wy += (wrng() - 0.5) * 18;
      const near = Math.abs(x) < rx * 1.3;
      pts.push([x, near ? Math.min(wy, northMost - 80) : wy]);
    }
    site.water = { pts: chaikinOpen(pts, 3), width: 90 };
  }
  return site;
}

/** 강 중심선의 y (x에서). 강이 없으면 undefined. 강은 동서로 흐르므로 x로 찾는다. */
export function riverY(site: Pick<Site, "water">, x: number): number | undefined {
  const pts = site.water?.pts;
  if (!pts?.length) return undefined;
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] <= x) lo = mid; else hi = mid;
  }
  const a = pts[lo], b = pts[hi];
  const t = (x - a[0]) / (b[0] - a[0] || 1);
  return a[1] + (b[1] - a[1]) * t;
}

/** 구역 방향(도)을 이 부지의 동서 반전에 맞춘다. */
export const siteAngle = (site: Site, deg: number): number => (site.mirror ? 180 - deg : deg);

/** 구역의 목표 지점 (월드 좌표) */
export function districtPoint(site: Site, deg: number, r: number): Vec2 {
  const a = (siteAngle(site, deg) * Math.PI) / 180;
  return [Math.cos(a) * site.rx * r, -Math.sin(a) * site.ry * r];
}
