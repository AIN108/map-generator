// 배치: 어떤 건물을 어디에 둘지 정한다. 결과(Layout)는 편집·저장의 단위다.

import {
  BUILDING_TYPES, buildingType, DISTRICTS, LANDMARKS, PLACE_TYPES, type BuildingType, type LandmarkKind, type Shape, type Style,
} from "./catalog.ts";
import {
  convexOverlap, localToWorld, pointInPolygon, polygonSegmentDistance, rectCorners, resample, tangentAt, type Poly, type Vec2,
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
}

export interface Landmark {
  id: number;
  kind: LandmarkKind;
  name: string;
  x: number;
  y: number;
}

export interface Layout {
  /** 대학 이름 ('○○대학교') */
  name: string;
  /** 번호 순서대로 (1번부터). 광장·운동장도 번호를 받는다. */
  buildings: Building[];
  landmarks: Landmark[];
  nextId: number;
}

export const isPlace = (b: Pick<Building, "shape">): boolean => b.shape === "plaza" || b.shape === "field";

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
}

export const placementContext = (site: Site): PlacementContext => ({ site, segments: roadSegments(site) });

/**
 * 건물을 그 자리에 둘 수 있는지 검사한다. 문제가 없으면 undefined.
 * ignoreId: 옮기는 중인 건물 자신은 겹침 검사에서 뺀다.
 */
export function checkPlacement(
  ctx: PlacementContext, buildings: readonly Building[], b: Building, ignoreId = -1, extra: Poly[] = [],
): PlaceProblem | undefined {
  const poly = footprint(b);
  for (const p of poly) if (!pointInPolygon(p, ctx.site.ring)) return "outside";
  const place = isPlace(b);
  if (!place) {
    for (const r of ctx.site.reserved) if (convexOverlap(poly, r, 2)) return "reserved";
  }
  for (const r of extra) if (convexOverlap(poly, r, 0)) return "reserved";
  const minX = Math.min(...poly.map((p) => p[0])), maxX = Math.max(...poly.map((p) => p[0]));
  const minY = Math.min(...poly.map((p) => p[1])), maxY = Math.max(...poly.map((p) => p[1]));
  for (const s of ctx.segments) {
    const clear = s.half + ROAD_CLEARANCE;
    if (s.maxX + clear < minX || s.minX - clear > maxX || s.maxY + clear < minY || s.minY - clear > maxY) continue;
    if (polygonSegmentDistance(poly, s.a, s.b) < clear) return "road";
  }
  for (const o of buildings) {
    if (o.id === ignoreId) continue;
    const reach = (Math.hypot(o.w, o.d) + Math.hypot(b.w, b.d)) / 2 + BUILDING_GAP;
    if (Math.abs(o.x - b.x) > reach || Math.abs(o.y - b.y) > reach) continue;
    if (convexOverlap(poly, footprint(o), BUILDING_GAP)) return "overlap";
  }
  return undefined;
}

/** 도로를 따라 건물이 앉을 수 있는 자리 (도로 위의 점, 접선, 도로 반폭) */
interface Frontage { p: Vec2; t: Vec2; half: number }

function frontages(site: Site): Frontage[] {
  const out: Frontage[] = [];
  for (const road of site.roads) {
    if (road.kind !== "ring" && road.kind !== "campus") continue;
    const pts = road.closed ? resample([...road.pts, road.pts[0]], 7).slice(0, -1) : resample(road.pts, 7);
    for (let i = 0; i < pts.length; i++) out.push({ p: pts[i], t: tangentAt(pts, i, !!road.closed), half: road.width / 2 });
  }
  return out;
}

const randIn = (rng: Rng, [lo, hi]: [number, number]): number => lo + rng() * (hi - lo);
const round1 = (v: number): number => Math.round(v * 10) / 10;

function makeBuilding(rng: Rng, t: BuildingType, id: number, univ: string): Building {
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
function placeAlongRoads(
  rng: Rng, ctx: PlacementContext, fronts: Frontage[], placed: Building[], b: Building, target: Vec2,
  extra: Poly[], setback: number,
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
      const off = f.half + setback + b.d / 2;
      const x = f.p[0] + nx * off, y = f.p[1] + ny * off;
      const dist = Math.hypot(x - target[0], y - target[1]) / ctx.site.rx;
      const noise = rng() * 0.12;
      cands.push({ x, y, angle, score: dist + noise });
      const snapped = Math.round(angle / quarter) * quarter;
      if (Math.abs(snapped - angle) < 0.42 && Math.abs(snapped - angle) > 0.01) {
        cands.push({ x, y, angle: snapped, score: dist + noise - 0.03 });
      }
    }
  }
  cands.sort((p, q) => p.score - q.score);
  const limit = Math.min(cands.length, 2500);
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
  const pool = BUILDING_TYPES.filter((t) => !required.includes(t.id) && (o.hospital || !t.medical));
  const ranked = pool
    .map((t) => ({ t, k: t.weight * (0.75 + rng() * 0.5) + (o.hospital && t.id === "hospital" ? 100 : 0) }))
    .sort((a, b) => b.k - a.k)
    .map((p) => p.t);
  const count = Math.max(3, Math.min(o.buildings, required.length + ranked.length));
  const program = [...required.map((id) => buildingType(id)!), ...ranked.slice(0, count - required.length)];
  const hasGym = program.some((t) => t.id === "gym");

  // ── 중심 구역 ──
  const plazaType = PLACE_TYPES[0];
  const plaza: Building = {
    ...makeBuilding(rng, plazaType, nextId++, name), x: site.plaza.x, y: site.plaza.y, w: site.plaza.w, d: site.plaza.d,
  };
  const admin = { ...makeBuilding(rng, buildingType("admin")!, nextId++, name), x: 0, y: site.adminY };
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
  if (!pointInPolygon(p, ctx.site.boundary)) return false;
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


