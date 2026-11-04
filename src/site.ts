// 부지: 캠퍼스 경계, 순환도로, 중심축(정문~광장~본관~후문), 간선도로. 시드와 건물 수로만 정해진다.

import {
  chaikinClosed, chaikinOpen, polygonArea, rayPolygon, resample, tangentAt, type Poly, type Vec2,
} from "./geom.ts";
import { createNoise2D, subRng, type Rng } from "./rng.ts";

export type RoadKind = "arterial" | "ring" | "campus" | "connector" | "street" | "forest";

export interface Road {
  kind: RoadKind;
  pts: Vec2[];
  /** 전체 폭 (m) */
  width: number;
  closed?: boolean;
}

export interface Rect { x: number; y: number; w: number; d: number }

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

export function generateSite(seed: string, buildings: number): Site {
  const rng: Rng = subRng(seed, "site");
  const noise = createNoise2D(subRng(seed, "site-noise"));
  const rx = campusRadius(buildings);
  const ry = rx * 0.8;
  const mirror = rng() < 0.5;

  // 경계: 타원 + 방향별 노이즈. 남쪽(정문)은 덜 흔들어 정면을 반듯하게 둔다.
  const N = 180;
  const raw: Vec2[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const nx = Math.cos(a) * 1.3, ny = Math.sin(a) * 1.3;
    const southness = Math.max(0, Math.sin(a)); // 화면 아래(남쪽)가 y 양수
    const amp = 1 - 0.75 * Math.pow(southness, 3);
    const r = 1 + amp * (0.075 * noise(nx, ny) + 0.035 * noise(nx * 2.7 + 5, ny * 2.7 - 3));
    raw.push([Math.cos(a) * rx * r, Math.sin(a) * ry * r]);
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
  const monumentY = (adminNorth + -ringNorth) / 2;

  // 간선도로: 정문 앞을 지나는 동서 방향 큰길
  let southMost = 0;
  for (const p of boundary) southMost = Math.max(southMost, p[1]);
  const arterialY = southMost + 40;

  const roads: Road[] = [];
  roads.push({ kind: "arterial", pts: [[-4000, arterialY], [4000, arterialY]], width: ARTERIAL_WIDTH });
  roads.push({ kind: "ring", pts: ring, width: RING_WIDTH, closed: true });
  roads.push({ kind: "campus", pts: coreLoop, width: CAMPUS_ROAD_WIDTH, closed: true });

  // 방사형 도로: 중심 구역 도로에서 순환도로까지. 운동장·병원 쪽과 중심축 근처는 피한다.
  const avoid = [212, 312].map((a) => (mirror ? 180 - a : a));
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
    roads.push({ kind: "campus", pts: line, width: CAMPUS_ROAD_WIDTH });
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

  return {
    rx, ry, boundary, ring, coreLoop, coreRect, roads, gateS, gateN, plaza, adminY, monumentY, arterialY, mirror,
    reserved,
  };
}

/** 구역 방향(도)을 이 부지의 동서 반전에 맞춘다. */
export const siteAngle = (site: Site, deg: number): number => (site.mirror ? 180 - deg : deg);

/** 구역의 목표 지점 (월드 좌표) */
export function districtPoint(site: Site, deg: number, r: number): Vec2 {
  const a = (siteAngle(site, deg) * Math.PI) / 180;
  return [Math.cos(a) * site.rx * r, -Math.sin(a) * site.ry * r];
}
