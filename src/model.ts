// 건물 하나를 3차원 면(벽·지붕) 목록으로 만든다. 렌더러가 이 면들을 카메라로 투영해 그린다.

import type { Style } from "./catalog.ts";
import { gridRings, resolveForm, type FormGrid } from "./form.ts";
import { localToWorld, polygonArea, type Vec2 } from "./geom.ts";
import type { Building } from "./layout.ts";
import { STYLE_COLORS, type RGB } from "./palette.ts";

export type P3 = [number, number, number];

export type WindowType = "punched" | "ribbon" | "curtain" | "arched" | "none";

export interface WindowSpec {
  type: WindowType;
  /** 창 줄의 시작 높이와 층고 */
  z0: number;
  floorH: number;
  floors: number;
  /** 창 간격 (m) */
  bay: number;
  color: RGB;
  frame: RGB;
  /** 정면 1층 가운데에 출입구를 그린다 */
  door?: boolean;
}

export interface Face {
  pts: P3[];
  holes?: P3[][];
  normal: P3;
  color: RGB;
  win?: WindowSpec;
  /** 지붕 위 장식처럼 그림자·선을 생략해도 되는 작은 면 */
  minor?: boolean;
  /** 헬리패드 표시 (지붕 위 H) */
  helipad?: { c: P3; r: number };
}

export interface Part {
  faces: Face[];
  /** 그리는 순서: 아래에 있는 덩어리부터 (z0), 같으면 먼 것부터 */
  z0: number;
  /** 덩어리 중심 (월드) */
  cx: number;
  cy: number;
}

export interface Model {
  parts: Part[];
  /** 가장 높은 곳 (라벨 위치용) */
  top: P3;
  height: number;
}

export const FLOOR_H = 3.8;

interface Mass {
  outer: Vec2[];
  holes?: Vec2[][];
  z0: number;
  z1: number;
  style: Style;
  win: WindowType;
  floors: number;
  roof: "flat" | "hip" | "none" | "vault" | "parapet";
  /** hip 지붕을 얹을 직사각형들 (국소 좌표 [u0, v0, u1, v1]) */
  hipRects?: [number, number, number, number][];
  /** 유리 덩어리 등 색을 바꿀 때 */
  wallColor?: RGB;
  door?: boolean;
}

const rect = (u0: number, v0: number, u1: number, v1: number): Vec2[] => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

function newell(pts: readonly P3[]): P3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/** 해시 기반 작은 난수 (건물 variant와 번호로 세부를 고른다) */
const hash = (seed: number, k: number): number => {
  const x = Math.sin(seed * 9301.13 + k * 49297.7) * 233280.31;
  return x - Math.floor(x);
};

export function buildModel(b: Building): Model {
  const masses = massesFor(b);
  const parts: Part[] = [];
  const toW = (u: number, v: number): Vec2 => localToWorld(b.x, b.y, b.angle, u, v);
  let top: P3 = [b.x, b.y, 0];
  for (const m of masses) {
    const faces: Face[] = [];
    const colors = STYLE_COLORS[m.style];
    const wallColor = m.wallColor ?? colors.wall;
    const floorH = m.floors > 0 ? (m.z1 - m.z0) / m.floors : FLOOR_H;
    const rings: { ring: Vec2[]; hole: boolean }[] = [{ ring: orient(m.outer, true), hole: false }];
    for (const h of m.holes ?? []) rings.push({ ring: orient(h, false), hole: true });
    // 벽
    for (const { ring } of rings) {
      for (let i = 0; i < ring.length; i++) {
        const p = toW(...ring[i]), q = toW(...ring[(i + 1) % ring.length]);
        const tx = q[0] - p[0], ty = q[1] - p[1];
        const len = Math.hypot(tx, ty);
        if (len < 0.5) continue;
        const normal: P3 = [ty / len, -tx / len, 0];
        // 출입구: 국소 +v(정면)를 보는 가장 긴 바깥 벽
        const facesFront = m.door && Math.abs(ring[i][1] - ring[(i + 1) % ring.length][1]) < 0.01 && ring[i][1] > 0;
        faces.push({
          pts: [[p[0], p[1], m.z0], [q[0], q[1], m.z0], [q[0], q[1], m.z1], [p[0], p[1], m.z1]],
          normal, color: wallColor,
          win: m.win === "none" ? undefined : {
            type: m.win, z0: m.z0, floorH, floors: m.floors, bay: m.win === "curtain" ? 3.2 : 3.6,
            color: colors.window, frame: colors.trim, door: facesFront && m.z0 === 0,
          },
        });
      }
    }
    // 지붕
    const zTop = m.z1;
    if (m.roof === "flat" || m.roof === "parapet") {
      const outer = rings[0].ring.map((p) => { const w = toW(...p); return [w[0], w[1], zTop] as P3; });
      const holes = rings.slice(1).map((r) => r.ring.map((p) => { const w = toW(...p); return [w[0], w[1], zTop] as P3; }));
      faces.push({ pts: outer, holes: holes.length ? holes : undefined, normal: [0, 0, 1], color: colors.roof });
    } else if (m.roof === "hip") {
      for (const r of m.hipRects ?? []) faces.push(...hipRoof(toW, r, zTop, colors.pitched));
    }
    parts.push({ faces, z0: m.z0, cx: 0, cy: 0 });
    const c = centerOf(m.outer);
    const w = toW(c[0], c[1]);
    parts[parts.length - 1].cx = w[0];
    parts[parts.length - 1].cy = w[1];
    if (zTop > top[2]) top = [w[0], w[1], zTop];
  }
  for (const extra of extrasFor(b, toW)) {
    parts.push(extra);
    for (const f of extra.faces) for (const p of f.pts) if (p[2] > top[2]) top = [b.x, b.y, p[2]];
  }
  // 가장 높은 곳이 건물 중심과 멀면 라벨이 엉뚱한 데 붙으므로 x·y는 건물 중심 근처로 둔다.
  top = [b.x * 0.5 + top[0] * 0.5, b.y * 0.5 + top[1] * 0.5, top[2]];
  return { parts, top, height: top[2] };
}

const centerOf = (pts: Vec2[]): Vec2 => {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
};

/** 바깥 고리는 면적 양수(반시계), 구멍은 음수(시계)로 맞춘다. */
function orient(ring: Vec2[], ccw: boolean): Vec2[] {
  const a = polygonArea(ring);
  return (a > 0) === ccw ? ring : [...ring].reverse();
}

function hipRoof(toW: (u: number, v: number) => Vec2, r: [number, number, number, number], z: number, color: RGB): Face[] {
  const [u0, v0, u1, v1] = r;
  const du = u1 - u0, dv = v1 - v0;
  const rise = Math.max(3, Math.min(8, Math.min(du, dv) * 0.32));
  const P = (u: number, v: number, zz: number): P3 => { const w = toW(u, v); return [w[0], w[1], zz]; };
  const a = P(u0, v0, z), b = P(u1, v0, z), c = P(u1, v1, z), d = P(u0, v1, z);
  let faces: P3[][];
  if (du >= dv) {
    const r1 = P(u0 + dv / 2, (v0 + v1) / 2, z + rise), r2 = P(u1 - dv / 2, (v0 + v1) / 2, z + rise);
    faces = [[d, c, r2, r1], [b, a, r1, r2], [a, d, r1], [c, b, r2]];
  } else {
    const r1 = P((u0 + u1) / 2, v0 + du / 2, z + rise), r2 = P((u0 + u1) / 2, v1 - du / 2, z + rise);
    faces = [[a, d, r2, r1], [c, b, r1, r2], [b, a, r1], [d, c, r2]];
  }
  return faces.map((pts) => {
    let n = newell(pts);
    if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
    return { pts, normal: n, color };
  });
}

/** 평면도에 그릴 덩어리 (국소 좌표: u 오른쪽, v 정면 쪽) */
export interface PlanMass { outer: Vec2[]; holes: Vec2[][]; z0: number; z1: number; floors: number; glass: boolean }

export function planMasses(b: Building): PlanMass[] {
  return massesFor(b).map((m) => ({
    outer: m.outer, holes: m.holes ?? [], z0: m.z0, z1: m.z1, floors: Math.round(m.z1 / FLOOR_H), glass: m.wallColor !== undefined,
  }));
}

/** 연면적 (m²): 덩어리마다 바닥 넓이 × 층수 */
export function grossArea(b: Building): number {
  let sum = 0;
  for (const m of massesFor(b)) {
    const a = Math.abs(polygonArea(m.outer)) - (m.holes ?? []).reduce((t, h) => t + Math.abs(polygonArea(h)), 0);
    sum += a * Math.max(1, m.floors);
  }
  return sum;
}

/** 자유형: 층수가 같은 높이 띠마다, 그 높이 이상인 칸들의 합집합을 쌓는다. */
function gridMasses(b: Building, g: FormGrid, base: Omit<Mass, "outer" | "z0" | "z1" | "roof" | "floors">): Mass[] {
  const cw = b.w / g.cols, ch = b.d / g.rows;
  const toLocal = (p: Vec2): Vec2 => [-b.w / 2 + p[0] * cw, -b.d / 2 + p[1] * ch];
  const levels = [...new Set(g.cells.filter((v) => v > 0))].sort((x, y) => x - y);
  const out: Mass[] = [];
  let prev = 0;
  for (const f of levels) {
    for (const ring of gridRings(g, (v) => v >= f)) {
      out.push({
        ...base, door: prev === 0, outer: ring.outer.map(toLocal), holes: ring.holes.length ? ring.holes.map((h) => h.map(toLocal)) : undefined,
        z0: prev * FLOOR_H, z1: f * FLOOR_H, floors: f - prev, roof: "flat",
      });
    }
    prev = f;
  }
  return out;
}

/** 모양별 덩어리 구성 */
function massesFor(b: Building): Mass[] {
  const { w, d, floors, style } = b;
  const hw = w / 2, hd = d / 2;
  const H = floors * FLOOR_H;
  const win: WindowType = style === "glass" ? "curtain" : style === "modern" || style === "white" ? "ribbon"
    : style === "classic" ? "arched" : "punched";
  const f = resolveForm(b);
  const pitched = f.roof ? f.roof === "hip" : style === "brick" || style === "classic";
  const base = { style, win, floors, door: true } as const;
  const flip = f.flip ? -1 : 1;
  switch (b.shape) {
    case "custom": {
      if (b.form?.grid) return gridMasses(b, b.form.grid, base);
      return [{ ...base, outer: rect(-hw, -hd, hw, hd), z0: 0, z1: H, roof: "flat" }];
    }
    case "L": {
      const ww = w * f.wing;
      const mainD = d * f.depth;
      // 뒤쪽 긴 동 + 한쪽 끝에서 앞으로 나온 동. 한 덩어리 L자 다각형으로 만든다.
      const outer: Vec2[] = flip > 0
        ? [[-hw, -hd], [hw, -hd], [hw, hd], [hw - ww, hd], [hw - ww, -hd + mainD], [-hw, -hd + mainD]]
        : [[-hw, -hd], [hw, -hd], [hw, -hd + mainD], [-hw + ww, -hd + mainD], [-hw + ww, hd], [-hw, hd]];
      const hips: [number, number, number, number][] = flip > 0
        ? [[-hw, -hd, hw - ww, -hd + mainD], [hw - ww, -hd, hw, hd]]
        : [[-hw + ww, -hd, hw, -hd + mainD], [-hw, -hd, -hw + ww, hd]];
      return [{ ...base, outer, z0: 0, z1: H, roof: pitched ? "hip" : "flat", hipRects: hips }];
    }
    case "U": {
      const ww = w * f.wing, backD = d * f.depth;
      const outer: Vec2[] = [
        [-hw, -hd], [hw, -hd], [hw, hd], [hw - ww, hd], [hw - ww, -hd + backD], [-hw + ww, -hd + backD], [-hw + ww, hd], [-hw, hd],
      ];
      const hips: [number, number, number, number][] = [
        [-hw + ww, -hd, hw - ww, -hd + backD], [-hw, -hd, -hw + ww, hd], [hw - ww, -hd, hw, hd],
      ];
      return [{ ...base, outer, z0: 0, z1: H, roof: pitched ? "hip" : "flat", hipRects: hips }];
    }
    case "court": {
      const t = Math.min(w, d) * f.wing;
      const hips: [number, number, number, number][] = [
        [-hw, -hd, hw, -hd + t], [-hw, hd - t, hw, hd], [-hw, -hd + t, -hw + t, hd - t], [hw - t, -hd + t, hw, hd - t],
      ];
      return [{
        ...base, outer: rect(-hw, -hd, hw, hd), holes: [rect(-hw + t, -hd + t, hw - t, hd - t)], z0: 0, z1: H,
        roof: pitched ? "hip" : "flat", hipRects: hips,
      }];
    }
    case "wings": {
      // 고전식 본관: 가운데 동이 한 층 높고 앞으로 나와 있으며, 양쪽 날개는 조금 뒤로 물러나 있다.
      const cw = (w * f.wing) / 2;
      const center: Mass = {
        ...base, style: "classic", outer: rect(-cw, -hd, cw, hd), z0: 0, z1: H + FLOOR_H, floors: floors + 1,
        roof: "hip", hipRects: [[-cw, -hd, cw, hd]],
      };
      const wingL: Mass = {
        ...base, door: false, style: "classic", outer: rect(-hw, -hd + 2, -cw, hd - 5), z0: 0, z1: H,
        roof: "hip", hipRects: [[-hw, -hd + 2, -cw, hd - 5]],
      };
      const wingR: Mass = { ...wingL, outer: rect(cw, -hd + 2, hw, hd - 5), hipRects: [[cw, -hd + 2, hw, hd - 5]] };
      return [wingL, wingR, center];
    }
    case "atrium": {
      const aw = (w * f.wing) / 2;
      const main: Mass = { ...base, door: false, outer: rect(-hw, -hd, hw, hd - 9), z0: 0, z1: H, roof: "flat" };
      const atrium: Mass = {
        ...base, style: "glass", win: "curtain", outer: rect(-aw, hd - 9, aw, hd), z0: 0,
        z1: Math.max(FLOOR_H * 2, H - FLOOR_H), floors: Math.max(2, floors - 1), roof: "flat",
        wallColor: STYLE_COLORS.glass.wall,
      };
      return [main, atrium];
    }
    case "stepped": {
      const podiumF = f.podium;
      const podium: Mass = { ...base, outer: rect(-hw, -hd, hw, hd), z0: 0, z1: podiumF * FLOOR_H, floors: podiumF, roof: "flat" };
      const upper: Mass = {
        ...base, door: false, outer: rect(-hw * f.wing, -hd, hw * f.wing, hd * 0.35), z0: podiumF * FLOOR_H, z1: H + 2,
        floors: floors - podiumF, roof: "flat",
      };
      return [podium, upper];
    }
    case "twin": {
      const pf = f.podium;
      const podium: Mass = { ...base, style: "concrete", win: "ribbon", outer: rect(-hw, -hd, hw, hd), z0: 0, z1: pf * FLOOR_H, floors: pf, roof: "flat" };
      const tw = w * f.wing;
      const t1: Mass = {
        ...base, door: false, outer: rect(-hw, -hd + 1, -hw + tw, hd - 1), z0: pf * FLOOR_H, z1: H, floors: floors - pf, roof: "flat",
      };
      const t2: Mass = { ...t1, outer: rect(hw - tw, -hd + 1, hw, hd - 1) };
      return [podium, t1, t2];
    }
    case "tower": {
      const pf = f.podium, tu = hw * f.wing, tv = hd * f.depth;
      const podium: Mass = { ...base, outer: rect(-hw, -hd, hw, hd), z0: 0, z1: pf * FLOOR_H, floors: pf, roof: "flat" };
      const tower: Mass = {
        ...base, door: false, outer: rect(-tu, -tv, tu, tv), z0: pf * FLOOR_H, z1: H, floors: floors - pf,
        roof: pitched ? "hip" : "flat", hipRects: [[-tu, -tv, tu, tv]],
      };
      return [podium, tower];
    }
    case "gym": {
      // 낮은 벽 위에 반원형(볼트) 지붕. 지붕은 extras에서 만든다.
      return [{ ...base, win: "ribbon", floors: 2, outer: rect(-hw, -hd, hw, hd), z0: 0, z1: 9, roof: "none" }];
    }
    case "round": {
      const r = Math.min(w, d) / 2;
      const ring: Vec2[] = [];
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        ring.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      const drum = ring.map(([x, y]) => [x * 0.62, y * 0.62] as Vec2);
      return [
        { ...base, win: "punched", outer: ring, z0: 0, z1: H, roof: "flat" },
        { ...base, door: false, win: "ribbon", style: "modern", outer: drum, z0: H, z1: H + 4, floors: 1, roof: "flat" },
      ];
    }
    case "hospital": {
      const pf = f.podium;
      const podium: Mass = { ...base, outer: rect(-hw, -hd, hw, hd), z0: 0, z1: pf * FLOOR_H, floors: pf, roof: "flat" };
      const main: Mass = {
        ...base, door: false, outer: rect(-hw * 0.3, -hd * 0.85, hw * 0.62, hd * 0.25), z0: pf * FLOOR_H, z1: H, floors: floors - pf,
        roof: "flat",
      };
      const sideF = Math.max(pf + 1, Math.max(5, Math.round(floors * 0.6)));
      const side: Mass = {
        ...base, door: false, outer: rect(-hw * 0.94, -hd * 0.8, -hw * 0.42, hd * 0.1), z0: pf * FLOOR_H, z1: sideF * FLOOR_H,
        floors: sideF - pf, roof: "flat",
      };
      return flip > 0 ? [podium, side, main] : [podium, mirrorMass(side), mirrorMass(main)];
    }
    case "hall": {
      const lobby: Mass = { ...base, style: "glass", win: "curtain", outer: rect(-hw * 0.8, hd - 10, hw * 0.8, hd), z0: 0, z1: 8, floors: 2, roof: "flat", wallColor: STYLE_COLORS.glass.wall };
      const hall: Mass = { ...base, door: false, win: "none", outer: rect(-hw, -hd, hw, hd - 10), z0: 0, z1: 15, floors: 1, roof: "flat" };
      const fly: Mass = { ...base, door: false, win: "none", outer: rect(-hw * 0.45, -hd, hw * 0.45, -hd + 14), z0: 15, z1: 24, floors: 1, roof: "flat" };
      return [hall, lobby, fly];
    }
    case "bar":
    default: {
      return [{ ...base, outer: rect(-hw, -hd, hw, hd), z0: 0, z1: H, roof: pitched ? "hip" : "flat", hipRects: [[-hw, -hd, hw, hd]] }];
    }
  }
}

function mirrorMass(m: Mass): Mass {
  return { ...m, outer: m.outer.map(([u, v]) => [-u, v] as Vec2) };
}

/** 지붕 위 설비, 체육관 볼트 지붕, 본관 시계탑, 헬리패드, 출입구 캐노피 같은 장식 */
function extrasFor(b: Building, toW: (u: number, v: number) => Vec2): Part[] {
  const out: Part[] = [];
  const hw = b.w / 2, hd = b.d / 2;
  const H = b.floors * FLOOR_H;
  const P = (u: number, v: number, z: number): P3 => { const w = toW(u, v); return [w[0], w[1], z]; };
  const box = (u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, color: RGB, roof?: RGB, minor = true): Part => {
    const faces: Face[] = [];
    const corners: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    // 국소 좌표의 회전 방향을 보존하므로 (u0,v0)->(u1,v0)->... 순서가 반시계(면적 양수)다.
    for (let i = 0; i < 4; i++) {
      const p = P(corners[i][0], corners[i][1], z0), q = P(corners[(i + 1) % 4][0], corners[(i + 1) % 4][1], z0);
      const tx = q[0] - p[0], ty = q[1] - p[1];
      const len = Math.hypot(tx, ty) || 1;
      faces.push({ pts: [p, q, [q[0], q[1], z1], [p[0], p[1], z1]], normal: [ty / len, -tx / len, 0], color, minor });
    }
    faces.push({ pts: corners.map(([u, v]) => P(u, v, z1)), normal: [0, 0, 1], color: roof ?? color, minor });
    const c = toW((u0 + u1) / 2, (v0 + v1) / 2);
    return { faces, z0, cx: c[0], cy: c[1] };
  };
  const colors = STYLE_COLORS[b.style];
  const f = resolveForm(b);
  if (b.shape === "custom") return out;

  if (b.shape === "gym") {
    // 볼트 지붕: 짧은 변(v) 방향으로 휘어진 띠를 이어 붙인다.
    const z0 = 9, rise = 9, K = 10;
    const faces: Face[] = [];
    const prof = (k: number): [number, number] => {
      const t = k / K;
      return [-hd + t * b.d, z0 + rise * Math.sin(Math.PI * t)];
    };
    for (let k = 0; k < K; k++) {
      const [va, za] = prof(k), [vb, zb] = prof(k + 1);
      const pts: P3[] = [P(-hw, va, za), P(-hw, vb, zb), P(hw, vb, zb), P(hw, va, za)];
      let n = newell(pts);
      if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
      faces.push({ pts, normal: n, color: [200, 206, 212] });
    }
    // 양 끝 박공벽
    for (const side of [-1, 1]) {
      const pts: P3[] = [];
      for (let k = 0; k <= K; k++) { const [v, z] = prof(k); pts.push(P(side * hw, v, z)); }
      pts.push(P(side * hw, hd, z0), P(side * hw, -hd, z0));
      const ordered = side > 0 ? pts : pts.reverse();
      faces.push({ pts: ordered, normal: normalOf(toW, side, 0), color: colors.wall });
    }
    out.push({ faces, z0: 9, cx: b.x, cy: b.y });
    // 정면 유리 입구
    out.push(box(-hw * 0.4, hd, hw * 0.4, hd + 6, 0, 7, STYLE_COLORS.glass.wall, colors.trim, false));
    return out;
  }

  if (b.shape === "wings") {
    // 시계탑: 가운데 동 위로 솟은 탑 + 뾰족 지붕
    const s = 5.5;
    const z0 = H + FLOOR_H;
    const tower = box(-s, -s - 2, s, s - 2, z0 - 2, z0 + 16, STYLE_COLORS.classic.wall, STYLE_COLORS.classic.trim, false);
    out.push(tower);
    const apex = P(0, -2, z0 + 30);
    const corners = [P(-s - 0.8, -s - 2.8, z0 + 16), P(s + 0.8, -s - 2.8, z0 + 16), P(s + 0.8, s - 1.2, z0 + 16), P(-s - 0.8, s - 1.2, z0 + 16)];
    const faces: Face[] = [];
    for (let i = 0; i < 4; i++) {
      const pts: P3[] = [corners[i], corners[(i + 1) % 4], apex];
      let n = newell(pts);
      if (n[2] < 0) { pts.reverse(); n = [-n[0], -n[1], -n[2]]; }
      faces.push({ pts, normal: n, color: STYLE_COLORS.classic.pitched });
    }
    out.push({ faces, z0: z0 + 16, cx: apex[0], cy: apex[1] });
    // 현관 (기둥이 있는 포치)
    out.push(box(-b.w * 0.12, hd, b.w * 0.12, hd + 7, 0, FLOOR_H * 2.2, STYLE_COLORS.classic.trim, STYLE_COLORS.classic.trim, false));
    return out;
  }

  if (b.shape === "hospital") {
    // 헬리패드 (주 탑 지붕 가운데). 뒤집으면 주 탑이 반대쪽에 선다.
    const flip = f.flip ? -1 : 1;
    const u0 = -hw * 0.3, u1 = hw * 0.62;
    const uc = flip > 0 ? (u0 + u1) / 2 : -(u0 + u1) / 2;
    const vc = (-hd * 0.85 + hd * 0.25) / 2;
    const c = P(uc, vc, H + 0.05);
    out.push({ faces: [{ pts: [c, c, c], normal: [0, 0, 1], color: [90, 160, 110], helipad: { c, r: Math.min(b.w * 0.18, b.d * 0.3) } }], z0: H, cx: c[0], cy: c[1] });
    // 응급실 입구 캐노피
    out.push(box(hw * 0.2 * flip - 9, hd, hw * 0.2 * flip + 9, hd + 8, 4, 5, [236, 236, 238], [236, 236, 238], false));
    return out;
  }

  // 지붕 위 설비: 평지붕 건물에 1~3개
  const flatRoof = !(b.style === "brick" || b.style === "classic") && b.shape !== "round" && b.shape !== "hall";
  if (flatRoof && H > 0) {
    const n = 1 + Math.floor(hash(b.variant, 1) * 3);
    const topH = b.shape === "stepped" ? H + 2 : b.shape === "twin" ? H : H;
    for (let k = 0; k < n; k++) {
      let su = (hash(b.variant, 2 + k) - 0.5) * (b.shape === "twin" ? 0 : hw * 0.9);
      let sv = (hash(b.variant, 7 + k) - 0.5) * hd * 0.6 - (b.shape === "stepped" ? hd * 0.3 : 0);
      const sw = 4 + hash(b.variant, 11 + k) * 5, sd = 3 + hash(b.variant, 13 + k) * 3;
      if (b.shape === "tower" || b.shape === "stepped") {
        // 윗부분 지붕 안에 들어가게
        const lu = Math.max(0, hw * f.wing - sw / 2 - 0.5);
        su = Math.max(-lu, Math.min(lu, su));
        if (b.shape === "tower") { const lv = Math.max(0, hd * f.depth - sd / 2 - 0.5); sv = Math.max(-lv, Math.min(lv, sv)); }
      }
      if (b.shape === "twin") {
        const tw = b.w * f.wing;
        const cu = (k % 2 === 0 ? -1 : 1) * (hw - tw / 2);
        out.push(box(cu - sw / 2, sv - sd / 2, cu + sw / 2, sv + sd / 2, topH, topH + 2.6, [214, 214, 210], [196, 196, 192]));
      } else if (b.shape === "atrium" || b.shape === "bar" || b.shape === "L" || b.shape === "U" || b.shape === "stepped" || b.shape === "tower") {
        // ㄱ·ㄷ자는 뒤 동 지붕 위 (뒤 동 깊이를 바꿨으면 그 안에 들어가게)
        const backV = b.form?.depth === undefined ? b.d * 0.2 : Math.max(sd / 2 + 0.5, Math.min(b.d * 0.2, b.d * f.depth - sd / 2 - 1));
        const vv = b.shape === "atrium" ? Math.min(sv, hd - 14) : b.shape === "L" || b.shape === "U" ? -hd + backV : sv;
        out.push(box(su - sw / 2, vv - sd / 2, su + sw / 2, vv + sd / 2, topH, topH + 2.6, [214, 214, 210], [196, 196, 192]));
      }
    }
  }
  // 출입구 캐노피
  if (b.shape === "bar" || b.shape === "L" || b.shape === "court" || b.shape === "tower" || b.shape === "U") {
    const cu = b.shape === "L" ? (f.flip ? -1 : 1) * (hw - b.w * f.wing) * 0.75 : 0;
    const v = b.shape === "L" || b.shape === "U" ? -hd + b.d * f.depth : hd;
    out.push(box(cu - 5, v, cu + 5, v + 4, 3.4, 4, colors.trim, colors.trim));
  }
  return out;
}

function normalOf(toW: (u: number, v: number) => Vec2, su: number, sv: number): P3 {
  const o = toW(0, 0), p = toW(su, sv);
  const dx = p[0] - o[0], dy = p[1] - o[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l, 0];
}
