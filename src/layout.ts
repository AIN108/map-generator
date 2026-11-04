// 배치: 어떤 건물을 어디에 둘지 정한다. 결과(Layout)는 편집·저장의 단위다.

import {
  BUILDING_TYPES, buildingType, DISTRICTS, LANDMARKS, PLACE_TYPES, type BuildingType, type LandmarkKind, type Shape, type Style,
} from "./catalog.ts";
import type { BuildingForm } from "./form.ts";
import {
  convexOverlap, insideAroundOrigin, localToWorld, pointInPolygon, tidyAngle, polygonSegmentDistance, rectCorners, resample, tangentAt, type Poly, type Vec2,
} from "./geom.ts";
import { universityName } from "./names.ts";
import { pick, subRng, type Rng } from "./rng.ts";
import { districtPoint, type Site } from "./site.ts";

export interface Building {
  id: number;
  type: string;
  name: string;
  /** 바닥 중심 (m) */
  x: number;
  y: number;
  /** 회전 (라디안). 0이면 정면(+v)이 남쪽을 본다. */
  angle: number;
  /** 폭(국소 u축), 깊이(국소 v축) */
  w: number;
  d: number;
  floors: number;
  style: Style;
  shape: Shape;
  /** 세부 모양을 고르는 난수 (0~1) */
  variant: number;
  /** 모양 세부 조절 (날개 폭·저층부·지붕, 자유형 평면). 없으면 모양별 기본값 */
  form?: BuildingForm;
  /** 호실 이름 (호실 번호 → 이름, 예: "312" → "수학과 사무실") */
  rooms?: Record<string, string>;
  /** 그리되 번호·범례에서 뺀다 (공식 시설이 아닌 운동장 등) */
  unlisted?: boolean;
  /** 손으로 옮기거나 모양을 바꿈 (목록을 다시 적용해도 이 자리를 지킨다) */
  pinned?: boolean;
  /** 목록으로 만들었으면 원래 목록의 이름 (이름을 바꿔도 목록의 줄과 이어 준다) */
  src?: string;
  /** 이름표를 손으로 옮긴 만큼 (화면 픽셀, 기본 크기 기준) */
  labelDx?: number;
  labelDy?: number;
  labelHidden?: boolean;
}

export interface Landmark {
  id: number;
  kind: LandmarkKind;
  name: string;
  x: number;
  y: number;
  pinned?: boolean;
  src?: string;
  labelDx?: number;
  labelDy?: number;
  labelHidden?: boolean;
}

/** 손으로 그린 길 */
export interface CustomRoad { id: number; kind: "road" | "path"; pts: Vec2[] }
/** 나무를 지우거나 심은 동그라미 */
export interface Circle { x: number; y: number; r: number }
/** 장소 메모 핀 (사건 장소·동아리방·NPC 위치 등) */
export type NoteColor = "red" | "blue" | "green" | "amber" | "purple";
export interface Note { id: number; x: number; y: number; title: string; text?: string; color: NoteColor }
export const NOTE_COLORS: Record<NoteColor, { fill: string; ko: string }> = {
  red: { fill: "#d64541", ko: "빨강" }, blue: { fill: "#2f6fb5", ko: "파랑" }, green: { fill: "#2f8f5b", ko: "초록" },
  amber: { fill: "#e09a1a", ko: "주황" }, purple: { fill: "#7a4fb3", ko: "보라" },
};

export interface Layout {
  /** 대학 이름 ('○○대학교') */
  name: string;
  /** 번호 순서대로 (1번부터). 광장·운동장도 번호를 받는다. */
  buildings: Building[];
  landmarks: Landmark[];
  nextId: number;
  /** 손으로 그린 도로·산책로 */
  roads?: CustomRoad[];
  /** 숨긴 부지 도로 (site.roads 번호) */
  hiddenRoads?: number[];
  /** 나무를 지운 곳·심은 곳 */
  clearings?: Circle[];
  groves?: Circle[];
  /** 장소 메모 핀 */
  notes?: Note[];
}

export const isPlace = (b: Pick<Building, "shape">): boolean => b.shape === "plaza" || b.shape === "field" || b.shape === "courts";

/** 번호 (번호 없는 시설은 빼고 목록 순서대로 1부터). id → 번호 */
export function numberMap(buildings: readonly Building[]): Map<number, number> {
  const m = new Map<number, number>();
  let n = 0;
  for (const b of buildings) if (!b.unlisted) m.set(b.id, ++n);
  return m;
}

export const footprint = (b: Pick<Building, "x" | "y" | "w" | "d" | "angle">): Poly => rectCorners(b.x, b.y, b.w, b.d, b.angle);

/** 건물 사이 최소 간격 (m) */
export const BUILDING_GAP = 10;
/** 건물과 도로 가장자리 사이 최소 간격 (m) */
export const ROAD_CLEARANCE = 4;

export type PlaceProblem = "outside" | "overlap" | "road" | "reserved";
export const PROBLEM_KO: Record<PlaceProblem, string> = {
  outside: "캠퍼스 순환도로 안쪽에만 둘 수 있습니다.",
  overlap: "다른 건물과 너무 가깝습니다.",
  road: "도로와 겹칩니다.",
  reserved: "중심축 산책로·정문·기념비 자리에는 둘 수 없습니다.",
};

interface Segment { a: Vec2; b: Vec2; half: number; minX: number; minY: number; maxX: number; maxY: number }

/** 도로 선분 목록 (충돌 검사용, 경계 상자로 빨리 거른다) */
export function roadSegments(site: Site): Segment[] {
  const segs: Segment[] = [];
  for (const road of site.roads) {
    if (road.kind === "forest" || road.kind === "street") continue;
    const pts = road.pts;
    const n = road.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const half = road.width / 2;
      segs.push({
        a, b, half,
        minX: Math.min(a[0], b[0]) - half, minY: Math.min(a[1], b[1]) - half,
        maxX: Math.max(a[0], b[0]) + half, maxY: Math.max(a[1], b[1]) + half,
      });
    }
  }
  return segs;
}

/** 건물 배치를 검사하는 데 필요한 부지 정보 (매번 다시 만들지 않도록 묶어 둔다) */
export interface PlacementContext {
  site: Site;
  segments: Segment[];
  /** 도로 선분 격자 색인 (칸 → 선분 번호) */
  segGrid: Map<number, number[]>;
}

const SEG_CELL = 32;
const cellKey = (i: number, j: number): number => (i + 2048) * 4096 + (j + 2048);

export function placementContext(site: Site): PlacementContext {
  const segments = roadSegments(site);
  const segGrid = new Map<number, number[]>();
  segments.forEach((s, k) => {
    for (let i = Math.floor(s.minX / SEG_CELL); i <= Math.floor(s.maxX / SEG_CELL); i++) {
      for (let j = Math.floor(s.minY / SEG_CELL); j <= Math.floor(s.maxY / SEG_CELL); j++) {
        const key = cellKey(i, j);
        let list = segGrid.get(key);
        if (!list) segGrid.set(key, (list = []));
        list.push(k);
      }
    }
  });
  return { site, segments, segGrid };
}

/** 점이 순환도로 안쪽인가 */
const insideRing = (ctx: PlacementContext, p: Vec2): boolean => insideAroundOrigin(ctx.site.ring, p[0], p[1]);

let segStamp = 0;
const segSeen = new Map<PlacementContext, Uint32Array>();

/** 경계 상자 (x0..x1, y0..y1)에 걸칠 수 있는 도로 선분 */
function segmentsNear(ctx: PlacementContext, x0: number, y0: number, x1: number, y1: number, out: number[]): number[] {
  out.length = 0;
  let seen = segSeen.get(ctx);
  if (!seen) { seen = new Uint32Array(ctx.segments.length); segSeen.set(ctx, seen); }
  segStamp = (segStamp + 1) >>> 0;
  if (segStamp === 0) { seen.fill(0); segStamp = 1; }
  for (let i = Math.floor(x0 / SEG_CELL); i <= Math.floor(x1 / SEG_CELL); i++) {
    for (let j = Math.floor(y0 / SEG_CELL); j <= Math.floor(y1 / SEG_CELL); j++) {
      const list = ctx.segGrid.get(cellKey(i, j));
      if (!list) continue;
      for (const k of list) {
        if (seen[k] === segStamp) continue;
        seen[k] = segStamp;
        out.push(k);
      }
    }
  }
  return out;
}
const nearBuf: number[] = [];

/** 다른 건물 외곽은 같은 자리·크기면 다시 계산하지 않는다 (나선 탐색에서 수천 번 쓰인다). */
const footCache = new WeakMap<Building, { key: string; poly: Poly }>();
function cachedFootprint(b: Building): Poly {
  const key = `${b.x},${b.y},${b.w},${b.d},${b.angle}`;
  const hit = footCache.get(b);
  if (hit && hit.key === key) return hit.poly;
  const poly = footprint(b);
  footCache.set(b, { key, poly });
  return poly;
}

/** 배치 검사 기준. 자동 생성은 넉넉한 간격을, 손 편집은 좁은 간격을 쓴다. */
export interface PlacementRules {
  /** 건물 사이 최소 간격 (m) */
  gap: number;
  /** 도로 가장자리와의 최소 간격 (m) */
  clearance: number;
  /** 켜면 캠퍼스 경계 안이기만 하면 겹쳐도 놓는다 */
  free: boolean;
}
export const GENERATE_RULES: PlacementRules = { gap: BUILDING_GAP, clearance: ROAD_CLEARANCE, free: false };
export const EDIT_RULES: PlacementRules = { gap: 4, clearance: 1.5, free: false };

/**
 * 건물을 그 자리에 둘 수 있는지 검사한다. 문제가 없으면 undefined.
 * ignoreId: 옮기는 중인 건물 자신은 겹침 검사에서 뺀다.
 */
export function checkPlacement(
  ctx: PlacementContext, buildings: readonly Building[], b: Building, ignoreId = -1, extra: Poly[] = [],
  rules: PlacementRules = GENERATE_RULES,
): PlaceProblem | undefined {
  const poly = footprint(b);
  if (rules.free) {
    for (const p of poly) if (!insideAroundOrigin(ctx.site.boundary, p[0], p[1])) return "outside";
    return undefined;
  }
  for (const p of poly) if (!insideRing(ctx, p)) return "outside";
  const place = isPlace(b);
  if (!place) {
    for (const r of ctx.site.reserved) if (convexOverlap(poly, r, 2)) return "reserved";
  }
  for (const r of extra) if (convexOverlap(poly, r, 0)) return "reserved";
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const pad = 20 + rules.clearance;
  for (const k of segmentsNear(ctx, minX - pad, minY - pad, maxX + pad, maxY + pad, nearBuf)) {
    const s = ctx.segments[k];
    const clear = s.half + rules.clearance;
    if (s.maxX + clear < minX || s.minX - clear > maxX || s.maxY + clear < minY || s.minY - clear > maxY) continue;
    if (polygonSegmentDistance(poly, s.a, s.b) < clear) return "road";
  }
  for (const o of buildings) {
    if (o.id === ignoreId) continue;
    const reach = (Math.hypot(o.w, o.d) + Math.hypot(b.w, b.d)) / 2 + rules.gap;
    if (Math.abs(o.x - b.x) > reach || Math.abs(o.y - b.y) > reach) continue;
    if (convexOverlap(poly, cachedFootprint(o), rules.gap)) return "overlap";
  }
  return undefined;
}

/**
 * (x, y) 둘레를 나선형으로 돌며 그 건물을 놓을 수 있는 가장 가까운 자리를 찾는다.
 * angles: 시도할 방향들 (앞의 것을 먼저 쓴다). 찾으면 옮긴 사본, 못 찾으면 undefined.
 */
export function findPlacement(
  ctx: PlacementContext, buildings: readonly Building[], b: Building, x: number, y: number, ignoreId: number,
  rules: PlacementRules, maxR = 50, angles: number[] = [b.angle],
): Building | undefined {
  const step = 3;
  for (let r = 0; r <= maxR; r += step) {
    const n = r === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * r) / step));
    for (const angle of angles) {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const trial: Building = {
          // 각도는 늘 (-π, π]로 (90°씩 돌려 보다 한 바퀴를 넘지 않게)
          ...b, x: round1(x + Math.cos(a) * r), y: round1(y + Math.sin(a) * r), angle: tidyAngle(angle),
        };
        if (!checkPlacement(ctx, buildings, trial, ignoreId, [], rules)) return trial;
      }
    }
  }
  return undefined;
}

/** 도로를 따라 건물이 앉을 수 있는 자리 (도로 위의 점, 접선, 도로 반폭) */
export interface Frontage { p: Vec2; t: Vec2; half: number }

export function frontages(site: Site): Frontage[] {
  const out: Frontage[] = [];
  for (const road of site.roads) {
    if (road.kind !== "ring" && road.kind !== "campus") continue;
    const pts = road.closed ? resample([...road.pts, road.pts[0]], 7).slice(0, -1) : resample(road.pts, 7);
    for (let i = 0; i < pts.length; i++) out.push({ p: pts[i], t: tangentAt(pts, i, !!road.closed), half: road.width / 2 });
  }
  return out;
}

export const randIn = (rng: Rng, [lo, hi]: [number, number]): number => lo + rng() * (hi - lo);
export const round1 = (v: number): number => Math.round(v * 10) / 10;

export function makeBuilding(rng: Rng, t: BuildingType, id: number, univ: string): Building {
  return {
    id, type: t.id, name: t.name.replace("{U}", univ),
    x: 0, y: 0, angle: 0,
    w: round1(randIn(rng, t.w)), d: round1(randIn(rng, t.d)),
    floors: Math.round(randIn(rng, t.floors)),
    style: pick(rng, t.styles), shape: pick(rng, t.shapes), variant: Math.round(rng() * 1000) / 1000,
  };
}

/**
 * 건물 하나를 도로변 후보 자리 중 구역 목표에 가까운 곳부터 시도해 놓는다. 놓았으면 true.
 * 직각에 가까운 방향은 반듯하게 맞춘 후보를 함께 넣는다 (반듯한 건물이 더 많아 보이게).
 */
export function placeAlongRoads(
  rng: Rng, ctx: PlacementContext, fronts: Frontage[], placed: Building[], b: Building, target: Vec2,
  extra: Poly[], setback: number, noiseScale = 0.12, maxDist = Infinity, rows = 1,
): boolean {
  interface Cand { x: number; y: number; angle: number; score: number }
  const cands: Cand[] = [];
  const quarter = Math.PI / 2;
  for (const f of fronts) {
    const base = Math.atan2(f.t[1], f.t[0]);
    for (const side of [1, -1]) {
      // 정면(+v)이 도로를 보도록: side=+1(왼쪽)이면 반 바퀴 돌린다.
      const angle = base + (side > 0 ? Math.PI : 0);
      const nx = -f.t[1] * side, ny = f.t[0] * side;
      // rows > 1이면 도로에서 한 줄·두 줄 안쪽(앞 건물 뒤) 자리도 후보로 넣는다 (산책로로 이어진다).
      for (let row = 0; row < rows; row++) {
        const off = f.half + setback + b.d / 2 + row * 48;
        const x = f.p[0] + nx * off, y = f.p[1] + ny * off;
        const meters = Math.hypot(x - target[0], y - target[1]);
        if (meters > maxDist) continue;
        const dist = meters / ctx.site.rx + row * 0.05;
        const noise = rng() * noiseScale;
        cands.push({ x, y, angle, score: dist + noise });
        const snapped = Math.round(angle / quarter) * quarter;
        if (Math.abs(snapped - angle) < 0.42 && Math.abs(snapped - angle) > 0.01) {
          cands.push({ x, y, angle: snapped, score: dist + noise - 0.03 });
        }
      }
    }
  }
  cands.sort((p, q) => p.score - q.score);
  const limit = Math.min(cands.length, 2500 * rows);
  for (let i = 0; i < limit; i++) {
    const c = cands[i];
    const trial: Building = { ...b, x: round1(c.x), y: round1(c.y), angle: Math.round(c.angle * 1000) / 1000 || 0 };
    if (!checkPlacement(ctx, placed, trial, -1, extra)) {
      Object.assign(b, trial);
      return true;
    }
  }
  return false;
}

export interface LayoutOptions {
  seed: string;
  /** 번호를 받는 건물 수 (광장·운동장 제외) */
  buildings: number;
  hospital: boolean;
  /** 비어 있으면 시드로 짓는다 */
  name: string;
}

/** 이름 칸이 비었을 때 쓰는 자동 이름 */
export const autoName = (seed: string): string => universityName(subRng(seed, "name"));

export function generateLayout(site: Site, o: LayoutOptions): Layout {
  const rng = subRng(o.seed, "layout");
  const name = o.name.trim() || autoName(o.seed);
  const ctx = placementContext(site);
  let nextId = 1;
  const placed: Building[] = [];

  // ── 건물 목록 고르기 ──
  const required = ["admin", "library", "union"];
  // 격자형·강변형에서만 뽑는 종류 (전원형은 예전 시드와 같은 배치를 지킨다)
  const modern = !!site.type && site.type !== "classic";
  const extra = new Set(modern ? ["cafeteria", "parking"] : []);
  const pool = BUILDING_TYPES.filter((t) => !required.includes(t.id) && (!t.manual || extra.has(t.id)) && (o.hospital || !t.medical));
  const ranked = pool
    .map((t) => ({ t, k: t.weight * (0.75 + rng() * 0.5) + (o.hospital && t.id === "hospital" ? 100 : 0) + (extra.has(t.id) ? 32 : 0) }))
    .sort((a, b) => b.k - a.k)
    .map((p) => p.t);
  const count = Math.max(3, Math.min(o.buildings, required.length + ranked.length));
  const program = [...required.map((id) => buildingType(id)!), ...ranked.slice(0, count - required.length)];
  const hasGym = program.some((t) => t.id === "gym");

  // ── 중심 구역 ──
  const plazaType = PLACE_TYPES[0];
  const plaza: Building = {
    ...makeBuilding(rng, plazaType, nextId++, name), x: round1(site.plaza.x), y: round1(site.plaza.y), w: site.plaza.w, d: site.plaza.d,
  };
  const admin = { ...makeBuilding(rng, buildingType("admin")!, nextId++, name), x: 0, y: round1(site.adminY) };
  admin.d = 32;
  const lib = makeBuilding(rng, buildingType("library")!, nextId++, name);
  const union = makeBuilding(rng, buildingType("union")!, nextId++, name);
  const sideX = site.plaza.w / 2 + 26;
  const libSide = site.mirror ? 1 : -1;
  lib.x = round1(libSide * (sideX + lib.w / 2));
  lib.y = round1(site.plaza.y - 2 + lib.d / 2 - 26);
  union.x = round1(-libSide * (sideX + union.w / 2));
  union.y = round1(site.plaza.y - 2 + union.d / 2 - 26);
  placed.push(admin, plaza, lib, union);

  const core = site.coreRect;
  const coreBlock: Poly = rectCorners(core.x, core.y, core.w, core.d, 0);

  // ── 큰 시설부터 도로변에 놓기 ──
  const fronts = frontages(site);
  const rest = program.filter((t) => !required.includes(t.id));
  const items: { t: BuildingType; b: Building }[] = rest.map((t) => ({ t, b: makeBuilding(rng, t, 0, name) }));
  if (hasGym) {
    const fieldType = PLACE_TYPES[1];
    items.push({ t: fieldType, b: makeBuilding(rng, fieldType, 0, name) });
    if (modern) {
      const courts = buildingType("courts")!;
      items.push({ t: courts, b: makeBuilding(rng, courts, 0, name) });
    }
  }
  items.sort((p, q) => q.b.w * q.b.d - p.b.w * p.b.d);
  for (const { t, b } of items) {
    const dist = DISTRICTS[t.district];
    const target = districtPoint(site, dist.angle, dist.r);
    const setback = t.id === "field" ? 18 : t.id === "hospital" ? 20 : 8 + rng() * 6;
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      ok = placeAlongRoads(rng, ctx, fronts, placed, b, target, [coreBlock], setback);
      if (!ok && t.id !== "field") {
        b.w = round1(b.w * 0.88);
        b.d = round1(b.d * 0.9);
      } else if (!ok) {
        b.w = round1(b.w * 0.92);
        b.d = round1(b.d * 0.92);
      }
    }
    if (ok) {
      b.id = nextId++;
      placed.push(b);
    }
  }

  // ── 번호: 본부·광장·도서관·학생회관 다음은 광장에서 가까운 순 ──
  const head = placed.slice(0, 4);
  const others = placed.slice(4).sort((p, q) =>
    Math.hypot(p.x - plaza.x, p.y - plaza.y) - Math.hypot(q.x - plaza.x, q.y - plaza.y));
  const buildings = [...head, ...others];

  const layout: Layout = { name, buildings, landmarks: [], nextId };
  layout.landmarks = placeLandmarks(subRng(o.seed, "landmarks"), ctx, layout);
  return layout;
}

/** 상징물 자리가 건물·도로와 겹치지 않는지 */
export function landmarkClear(ctx: PlacementContext, buildings: readonly Building[], p: Vec2, radius: number): boolean {
  if (!insideAroundOrigin(ctx.site.boundary, p[0], p[1])) return false;
  for (const b of buildings) {
    if (isPlace(b)) continue;
    if (Math.abs(b.x - p[0]) > b.w + b.d + radius || Math.abs(b.y - p[1]) > b.w + b.d + radius) continue;
    const box = rectCorners(b.x, b.y, b.w + radius * 2 + 4, b.d + radius * 2 + 4, b.angle);
    if (pointInPolygon(p, box)) return false;
  }
  for (const s of ctx.segments) {
    if (s.maxX + radius < p[0] || s.minX - radius > p[0] || s.maxY + radius < p[1] || s.minY - radius > p[1]) continue;
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / len2));
    if (Math.hypot(p[0] - s.a[0] - t * dx, p[1] - s.a[1] - t * dy) < s.half + radius) return false;
  }
  return true;
}

function placeLandmarks(rng: Rng, ctx: PlacementContext, layout: Layout): Landmark[] {
  const site = ctx.site;
  const out: Landmark[] = [];
  const add = (kind: LandmarkKind, p: Vec2): void => {
    out.push({ id: layout.nextId++, kind, name: pick(rng, LANDMARKS[kind].names), x: round1(p[0]), y: round1(p[1]) });
  };
  const byType = (id: string): Building | undefined => layout.buildings.find((b) => b.type === id);
  /** 건물 정면 앞(도로 반대쪽이 아닌 쪽) 빈자리 */
  const nearFront = (b: Building | undefined, radius: number): Vec2 | undefined => {
    if (!b) return undefined;
    const tries: [number, number][] = [
      [0, b.d / 2 + 12], [b.w / 2 + 14, 0], [-b.w / 2 - 14, 0], [b.w / 3, b.d / 2 + 14], [-b.w / 3, b.d / 2 + 14],
      [0, -b.d / 2 - 14], [b.w / 2 + 16, b.d / 2], [-b.w / 2 - 16, b.d / 2],
    ];
    for (const [u, v] of tries) {
      const p = localToWorld(b.x, b.y, b.angle, u, v);
      if (landmarkClear(ctx, layout.buildings, p, radius) && out.every((l) => Math.hypot(l.x - p[0], l.y - p[1]) > 24)) return p;
    }
    return undefined;
  };

  const px = site.plaza.x, py = site.plaza.y;
  const swap = rng() < 0.5 ? 1 : -1;
  add("fountain", [px + swap * 36, py + 14]);
  add("loop", [px - swap * 36, py + 14]);
  add("obelisk", [0, site.monumentY]);
  add("emblem", [0, site.gateS[1] + 16]);

  const optional: [LandmarkKind, string[]][] = [
    ["globe", ["intl", "intlCenter"]],
    ["book", ["library", "union"]],
    ["curve", ["sci1", "sci2", "lifesci"]],
    ["garden", ["artsLab", "artsLec", "music", "design"]],
    ["bell", ["museum", "auditorium", "humanities"]],
  ];
  for (const [kind, near] of optional) {
    const b = near.map(byType).find(Boolean);
    const p = nearFront(b, 8);
    if (p) add(kind, p);
  }
  if (layout.buildings.length >= 16) {
    const gateY = site.gateS[1], plazaS = py + site.plaza.d / 2;
    add("statue", [0, plazaS + (gateY - plazaS) * 0.42]);
  }
  // 연못: 넓은 빈 잔디밭을 찾는다.
  if (rng() < 0.75) {
    for (let k = 0; k < 400; k++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 0.85;
      const p: Vec2 = [Math.cos(a) * site.rx * r, Math.sin(a) * site.ry * r];
      if (!landmarkClear(ctx, layout.buildings, p, 26)) continue;
      if (layout.buildings.some((b) => isPlace(b) && Math.hypot(b.x - p[0], b.y - p[1]) < Math.hypot(b.w, b.d) / 2 + 30)) continue;
      if (Math.abs(p[0]) < 60 && p[1] > py) continue;
      if (out.some((l) => Math.hypot(l.x - p[0], l.y - p[1]) < 60)) continue;
      add("pond", p);
      break;
    }
  }
  return out;
}


