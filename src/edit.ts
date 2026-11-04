// 배치 편집: 건물·상징물 옮기기·돌리기·이름 바꾸기·추가·삭제, 되돌리기, JSON 저장 형식.

import {
  BUILDING_TYPES, buildingType, LANDMARK_KINDS, LANDMARKS, PLACE_TYPES, type LandmarkKind, type Shape, type Style,
} from "./catalog.ts";
import { normAngle } from "./geom.ts";
import {
  checkPlacement, EDIT_RULES, findPlacement, isPlace, landmarkClear, numberMap, PROBLEM_KO, type PlacementRules, type Building, type Landmark, type Layout, type PlacementContext,
} from "./layout.ts";
import { eul, ro } from "./names.ts";

export interface EditResult { ok: boolean; message: string }
const ok = (message: string): EditResult => ({ ok: true, message });
const fail = (message: string): EditResult => ({ ok: false, message });

export const MAX_NAME = 24;
export const MIN_FLOORS = 1;
export const MAX_FLOORS = 25;
export const MAX_ITEMS = 60;
export const MAX_LANDMARKS = 30;

export const cloneLayout = (l: Layout): Layout => {
  const out: Layout = {
    name: l.name,
    buildings: l.buildings.map((b) => ({ ...b })),
    landmarks: l.landmarks.map((m) => ({ ...m })),
    nextId: l.nextId,
  };
  if (l.roads?.length) out.roads = l.roads.map((r) => ({ ...r, pts: r.pts.map((p) => [p[0], p[1]] as [number, number]) }));
  if (l.hiddenRoads?.length) out.hiddenRoads = [...l.hiddenRoads];
  if (l.clearings?.length) out.clearings = l.clearings.map((c) => ({ ...c }));
  if (l.groves?.length) out.groves = l.groves.map((c) => ({ ...c }));
  return out;
};

/** 이름 입력 정리: 앞뒤 공백·제어 문자 제거, 길이 제한. 비면 undefined. */
export function cleanName(raw: string, max = MAX_NAME): string | undefined {
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  return s || undefined;
}

export const findBuilding = (l: Layout, id: number): Building | undefined => l.buildings.find((b) => b.id === id);
export const findLandmark = (l: Layout, id: number): Landmark | undefined => l.landmarks.find((m) => m.id === id);

/** 빈자리를 찾는 반경: 기본 반경 + 건물 크기의 절반 (큰 건물을 다른 건물 위에 놓아도 바로 옆을 찾도록) */
export const snapReach = (b: Pick<Building, "w" | "d">, base: number): number => (base > 0 ? base + Math.max(b.w, b.d) / 2 : 0);

/** 손 편집 기준. free를 켜면 겹쳐도 놓는다 (자유 배치). */
export const editRules = (free = false): PlacementRules => ({ ...EDIT_RULES, free });

/** 자리를 옮겨 붙였을 때 안내 */
const snapNote = (dx: number, dy: number): string => {
  const d = Math.hypot(dx, dy);
  return d >= 1 ? ` (겹치지 않게 약 ${Math.round(d)}m 옆으로 붙였습니다)` : "";
};

/**
 * 건물을 (x, y)로 옮긴다. 그 자리가 막혔으면 반경 snapR 안의 가장 가까운 빈자리로 붙인다.
 * angle을 주면 그 방향으로 놓는다 (끌기 미리보기에서 찾은 자리를 그대로 쓸 때).
 */
export function moveBuilding(
  ctx: PlacementContext, l: Layout, id: number, x: number, y: number, rules: PlacementRules = EDIT_RULES, snapR = 45,
  angle?: number,
): EditResult {
  const b = findBuilding(l, id);
  if (!b) return fail("건물을 찾을 수 없습니다.");
  const trial = { ...b, x: round1(x), y: round1(y), angle: angle ?? b.angle };
  const problem = checkPlacement(ctx, l.buildings, trial, id, [], rules);
  let spot: Building | undefined = problem ? undefined : trial;
  if (!spot && snapR > 0) spot = findPlacement(ctx, l.buildings, trial, trial.x, trial.y, id, rules, snapReach(trial, snapR), [trial.angle, trial.angle + Math.PI / 2]);
  if (!spot) return fail(`${PROBLEM_KO[problem!]} 근처에도 빈자리가 없습니다.`);
  const note = snapNote(spot.x - trial.x, spot.y - trial.y);
  b.x = spot.x;
  b.y = spot.y;
  b.angle = spot.angle;
  b.pinned = true;
  return ok(`'${b.name}'${eul(b.name)} 옮겼습니다.${note}`);
}

export function rotateBuilding(ctx: PlacementContext, l: Layout, id: number, delta: number, rules: PlacementRules = EDIT_RULES): EditResult {
  const b = findBuilding(l, id);
  if (!b) return fail("건물을 찾을 수 없습니다.");
  const trial = { ...b, angle: Math.round(normAngle(b.angle + delta) * 1000) / 1000 || 0 };
  const problem = checkPlacement(ctx, l.buildings, trial, id, [], rules);
  const spot = problem ? findPlacement(ctx, l.buildings, trial, b.x, b.y, id, rules, 24) : trial;
  if (!spot) return fail(`돌릴 수 없습니다: ${PROBLEM_KO[problem!]}`);
  const note = snapNote(spot.x - b.x, spot.y - b.y);
  b.x = spot.x;
  b.y = spot.y;
  b.angle = spot.angle;
  b.pinned = true;
  return ok(`'${b.name}'${eul(b.name)} 돌렸습니다.${note}`);
}

export function renameBuilding(l: Layout, id: number, raw: string): EditResult {
  const b = findBuilding(l, id);
  if (!b) return fail("건물을 찾을 수 없습니다.");
  const name = cleanName(raw);
  if (!name) return fail("이름이 비어 있습니다.");
  b.name = name;
  return ok(`이름을 '${name}'${ro(name)} 바꿨습니다.`);
}

export function setFloors(l: Layout, id: number, floors: number): EditResult {
  const b = findBuilding(l, id);
  if (!b) return fail("건물을 찾을 수 없습니다.");
  if (isPlace(b)) return fail("광장·운동장은 층수가 없습니다.");
  if (!Number.isFinite(floors)) return fail("층수가 올바르지 않습니다.");
  const f = Math.max(MIN_FLOORS, Math.min(MAX_FLOORS, Math.round(floors)));
  b.floors = f;
  return ok(`'${b.name}'${eul(b.name)} ${f}층으로 바꿨습니다.`);
}

export function deleteBuilding(l: Layout, id: number): EditResult {
  const i = l.buildings.findIndex((b) => b.id === id);
  if (i < 0) return fail("건물을 찾을 수 없습니다.");
  const [b] = l.buildings.splice(i, 1);
  return ok(`'${b.name}'${eul(b.name)} 지웠습니다. 뒤 번호가 하나씩 당겨집니다.`);
}

/** 새로 놓을 건물 (자리는 아직 검사하지 않음). 끌기 미리보기에도 쓴다. */
export function newBuilding(l: Layout, typeId: string, x: number, y: number): Building | undefined {
  const t = buildingType(typeId);
  if (!t) return undefined;
  const mid = (r: [number, number]): number => Math.round(((r[0] + r[1]) / 2) * 10) / 10;
  return {
    id: l.nextId, type: t.id, name: t.name.replace("{U}", l.name), x: round1(x), y: round1(y), angle: 0,
    w: mid(t.w), d: mid(t.d), floors: Math.round(mid(t.floors)), style: t.styles[0], shape: t.shapes[0], variant: 0.3,
  };
}

/** 새 건물이 실제로 놓일 자리: 누른 곳이 막혔으면 가까운 빈자리 (정면이 남쪽, 안 되면 90°씩 돌려 본다) */
export function addSpot(ctx: PlacementContext, l: Layout, b: Building, rules: PlacementRules, snapR = 60): Building | undefined {
  const angles = [0, Math.PI / 2, -Math.PI / 2, Math.PI];
  for (const a of angles) {
    const t = { ...b, angle: Math.round(a * 1000) / 1000 };
    if (!checkPlacement(ctx, l.buildings, t, -1, [], rules)) return t;
  }
  return findPlacement(ctx, l.buildings, b, b.x, b.y, -1, rules, snapReach(b, snapR), [0, Math.PI / 2]);
}

/** 고른 종류의 건물을 (x, y)에 새로 놓는다. 막혔으면 가까운 빈자리에 놓는다. */
export function addBuilding(
  ctx: PlacementContext, l: Layout, typeId: string, x: number, y: number, rules: PlacementRules = EDIT_RULES, snapR = 60,
): EditResult & { id?: number } {
  if (l.buildings.length >= MAX_ITEMS) return fail(`건물은 ${MAX_ITEMS}개까지 둘 수 있습니다.`);
  const b = newBuilding(l, typeId, x, y);
  if (!b) return fail("알 수 없는 건물 종류입니다.");
  const spot = addSpot(ctx, l, b, rules, snapR);
  if (!spot) {
    const problem = checkPlacement(ctx, l.buildings, b, -1, [], rules) ?? "overlap";
    return fail(`${PROBLEM_KO[problem]} 근처에도 빈자리가 없습니다.`);
  }
  const note = snapNote(spot.x - b.x, spot.y - b.y);
  l.nextId++;
  spot.pinned = true;
  l.buildings.push(spot);
  return { ...ok(`${numberMap(l.buildings).get(spot.id)}번 '${spot.name}'${eul(spot.name)} 놓았습니다.${note}`), id: spot.id };
}

const LANDMARK_RADIUS: Record<LandmarkKind, number> = {
  fountain: 8, obelisk: 10, loop: 5, globe: 5, book: 5, curve: 10, garden: 12, emblem: 6, statue: 4, bell: 6, pond: 28,
};

/** 상징물을 그 자리에 그대로 둘 수 있는가 */
export function landmarkFits(ctx: PlacementContext, l: Layout, kind: LandmarkKind, x: number, y: number, rules: PlacementRules = EDIT_RULES): boolean {
  return rules.free || kind === "emblem" || landmarkClear(ctx, l.buildings, [x, y], LANDMARK_RADIUS[kind] * 0.5);
}

/** 상징물이 실제로 놓일 자리 (막혔으면 가까운 빈자리). 자유 배치·정문 문장은 그대로 둔다. */
export function landmarkSpot(
  ctx: PlacementContext, l: Layout, kind: LandmarkKind, x: number, y: number, rules: PlacementRules = EDIT_RULES, ignoreId = -1,
): [number, number] | undefined {
  if (rules.free || kind === "emblem") return [round1(x), round1(y)];
  const r = LANDMARK_RADIUS[kind] * 0.5;
  for (let rad = 0; rad <= 36; rad += 3) {
    const n = rad === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * rad) / 3));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const p: [number, number] = [x + Math.cos(a) * rad, y + Math.sin(a) * rad];
      if (!landmarkClear(ctx, l.buildings, p, r)) continue;
      if (l.landmarks.some((o) => o.id !== ignoreId && Math.hypot(o.x - p[0], o.y - p[1]) < 6)) continue;
      return [round1(p[0]), round1(p[1])];
    }
  }
  return undefined;
}

export function moveLandmark(
  ctx: PlacementContext, l: Layout, id: number, x: number, y: number, rules: PlacementRules = EDIT_RULES,
): EditResult {
  const m = findLandmark(l, id);
  if (!m) return fail("상징물을 찾을 수 없습니다.");
  const spot = landmarkSpot(ctx, l, m.kind, x, y, rules, id);
  if (!spot) return fail("건물·도로와 겹치거나 캠퍼스 밖이고, 근처에도 빈자리가 없습니다.");
  const note = snapNote(spot[0] - x, spot[1] - y);
  m.x = spot[0];
  m.y = spot[1];
  m.pinned = true;
  return ok(`'${m.name}'${eul(m.name)} 옮겼습니다.${note}`);
}

// ── 정보 창에서 바꾸는 속성 ──────────────────────────────────────────
export const SHAPE_KO: Record<Shape, string> = {
  bar: "일자형", L: "ㄱ자형", U: "ㄷ자형", court: "ㅁ자(중정)", wings: "고전 본관(시계탑)", atrium: "아트리움", stepped: "계단식",
  twin: "쌍둥이 고층", tower: "탑상형", gym: "볼트 지붕", round: "원형", hospital: "병원형(헬리패드)", hall: "공연장",
  plaza: "광장", field: "운동장",
};
/** 건물에 쓸 수 있는 모양 (광장·운동장은 바꿀 수 없다) */
export const BUILDING_SHAPES: Shape[] = ["bar", "L", "U", "court", "wings", "atrium", "stepped", "twin", "tower", "gym", "round", "hospital", "hall"];

export function setStyle(l: Layout, id: number, style: Style): EditResult {
  const b = findBuilding(l, id);
  if (!b) return fail("건물을 찾을 수 없습니다.");
  if (isPlace(b)) return fail("광장·운동장은 외관이 없습니다.");
  if (!STYLES.includes(style)) return fail("알 수 없는 외관입니다.");
  b.style = style;
  return ok(`'${b.name}'의 외관을 바꿨습니다.`);
}

export function setShape(l: Layout, id: number, shape: Shape): EditResult {
  const b = findBuilding(l, id);
  if (!b) return fail("건물을 찾을 수 없습니다.");
  if (isPlace(b)) return fail("광장·운동장은 모양을 바꿀 수 없습니다.");
  if (!BUILDING_SHAPES.includes(shape)) return fail("알 수 없는 모양입니다.");
  b.shape = shape;
  b.pinned = true;
  return ok(`'${b.name}'${eul(b.name)} ${SHAPE_KO[shape]}${ro(SHAPE_KO[shape])} 바꿨습니다.`);
}

/** 종류를 바꾼다. 이름이 그 종류의 기본 이름이었으면 새 종류의 기본 이름으로 바꾼다. */
export function setType(l: Layout, id: number, typeId: string): EditResult {
  const b = findBuilding(l, id);
  if (!b) return fail("건물을 찾을 수 없습니다.");
  const t = buildingType(typeId), old = buildingType(b.type);
  if (!t) return fail("알 수 없는 종류입니다.");
  if (isPlace(b) !== (t.shapes[0] === "plaza" || t.shapes[0] === "field")) return fail("건물과 광장·운동장 사이로는 바꿀 수 없습니다.");
  if (old && b.name === old.name.replace("{U}", l.name)) b.name = t.name.replace("{U}", l.name);
  b.type = t.id;
  return ok(`'${b.name}'의 종류를 '${t.use}'${ro(t.use)} 바꿨습니다.`);
}

/** 폭·깊이를 바꾼다. 막히면 가까운 자리로 조금 옮긴다. */
export function resizeBuilding(
  ctx: PlacementContext, l: Layout, id: number, w: number, d: number, rules: PlacementRules = EDIT_RULES,
): EditResult {
  const b = findBuilding(l, id);
  if (!b) return fail("건물을 찾을 수 없습니다.");
  if (!Number.isFinite(w) || !Number.isFinite(d)) return fail("크기가 올바르지 않습니다.");
  const trial = { ...b, w: round1(Math.max(8, Math.min(220, w))), d: round1(Math.max(8, Math.min(160, d))) };
  const spot = checkPlacement(ctx, l.buildings, trial, id, [], rules)
    ? findPlacement(ctx, l.buildings, trial, b.x, b.y, id, rules, snapReach(trial, 20)) : trial;
  if (!spot) return fail("그 크기로는 근처에 놓을 자리가 없습니다.");
  const note = snapNote(spot.x - b.x, spot.y - b.y);
  Object.assign(b, { x: spot.x, y: spot.y, w: spot.w, d: spot.d, pinned: true });
  return ok(`'${b.name}'${eul(b.name)} ${Math.round(spot.w)}×${Math.round(spot.d)}m로 바꿨습니다.${note}`);
}

/** 방향을 직접 정한다 (도, 0이면 정면이 남쪽). */
export function setAngle(ctx: PlacementContext, l: Layout, id: number, deg: number, rules: PlacementRules = EDIT_RULES): EditResult {
  const b = findBuilding(l, id);
  if (!b) return fail("건물을 찾을 수 없습니다.");
  if (!Number.isFinite(deg)) return fail("각도가 올바르지 않습니다.");
  return rotateBuilding(ctx, l, id, (deg * Math.PI) / 180 - b.angle, rules);
}

/** 조금씩 옮기기 (방향키). 막히면 옮기지 않는다. */
export function nudge(
  ctx: PlacementContext, l: Layout, kind: "building" | "landmark", id: number, dx: number, dy: number, rules: PlacementRules = EDIT_RULES,
): EditResult {
  if (kind === "landmark") {
    const m = findLandmark(l, id);
    if (!m) return fail("상징물을 찾을 수 없습니다.");
    const x = m.x + dx, y = m.y + dy;
    if (!landmarkFits(ctx, l, m.kind, x, y, rules)) return fail("그쪽은 막혀 있습니다.");
    Object.assign(m, { x: round1(x), y: round1(y), pinned: true });
    return ok(`'${m.name}'${eul(m.name)} 옮겼습니다.`);
  }
  const b = findBuilding(l, id);
  if (!b) return fail("건물을 찾을 수 없습니다.");
  const trial = { ...b, x: round1(b.x + dx), y: round1(b.y + dy) };
  const problem = checkPlacement(ctx, l.buildings, trial, id, [], rules);
  if (problem) return fail(`그쪽은 막혀 있습니다: ${PROBLEM_KO[problem]}`);
  Object.assign(b, { x: trial.x, y: trial.y, pinned: true });
  return ok(`'${b.name}'${eul(b.name)} 옮겼습니다.`);
}

/** 같은 건물을 하나 더 만들어 바로 옆 빈자리에 놓는다. */
export function duplicateBuilding(ctx: PlacementContext, l: Layout, id: number, rules: PlacementRules = EDIT_RULES): EditResult & { id?: number } {
  const b = findBuilding(l, id);
  if (!b) return fail("건물을 찾을 수 없습니다.");
  if (l.buildings.length >= MAX_ITEMS) return fail(`건물은 ${MAX_ITEMS}개까지 둘 수 있습니다.`);
  const names = new Set(l.buildings.map((o) => o.name));
  const base = b.name.replace(/\s\d+$/, "");
  let k = 2;
  while (names.has(`${base} ${k}`)) k++;
  const copy: Building = { ...b, id: l.nextId, name: cleanName(`${base} ${k}`)! };
  delete copy.labelDx;
  delete copy.labelDy;
  delete copy.src;
  const off = Math.max(b.w, b.d) / 2 + 14;
  const c = Math.cos(b.angle), s2 = Math.sin(b.angle);
  const start = { ...copy, x: b.x + c * (b.w + 12), y: b.y + s2 * (b.w + 12) };
  const spot = checkPlacement(ctx, l.buildings, start, -1, [], rules)
    ? findPlacement(ctx, l.buildings, start, start.x, start.y, -1, rules, snapReach(start, 60 + off), [b.angle, b.angle + Math.PI / 2])
    : start;
  if (!spot) return fail("옆에 놓을 빈자리가 없습니다.");
  spot.pinned = true;
  l.nextId++;
  l.buildings.push(spot);
  return { ...ok(`'${spot.name}'${eul(spot.name)} 만들었습니다.`), id: spot.id };
}

/** 번호를 바꾼다 (목록에서 그 자리로 옮긴다). 번호 없는 시설은 대상이 아니다. */
export function reorderBuilding(l: Layout, id: number, to: number): EditResult {
  const b = findBuilding(l, id);
  if (!b) return fail("건물을 찾을 수 없습니다.");
  if (b.unlisted) return fail("번호 없는 시설입니다.");
  const listed = l.buildings.filter((o) => !o.unlisted);
  const target = Math.max(1, Math.min(listed.length, Math.round(to)));
  const from = listed.indexOf(b) + 1;
  if (target === from) return ok(`${from}번 그대로입니다.`);
  const others = listed.filter((o) => o !== b);
  others.splice(target - 1, 0, b);
  l.buildings = [...others, ...l.buildings.filter((o) => o.unlisted)];
  return ok(`'${b.name}'${eul(b.name)} ${from}번 → ${target}번으로 옮겼습니다.`);
}

/** 이름표 숨기기·자리 (dx, dy가 undefined면 원래 자리로) */
export function setLabel(
  l: Layout, kind: "building" | "landmark", id: number, patch: { hidden?: boolean; dx?: number; dy?: number; reset?: boolean },
): EditResult {
  const o = kind === "building" ? findBuilding(l, id) : findLandmark(l, id);
  if (!o) return fail("찾을 수 없습니다.");
  if (patch.hidden !== undefined) {
    if (patch.hidden) o.labelHidden = true; else delete o.labelHidden;
  }
  if (patch.reset) { delete o.labelDx; delete o.labelDy; }
  else if (patch.dx !== undefined && patch.dy !== undefined && Number.isFinite(patch.dx) && Number.isFinite(patch.dy)) {
    o.labelDx = Math.round(Math.max(-2000, Math.min(2000, patch.dx)));
    o.labelDy = Math.round(Math.max(-2000, Math.min(2000, patch.dy)));
  }
  const what = patch.hidden === true ? "숨겼습니다" : patch.hidden === false ? "다시 보이게 했습니다" : patch.reset ? "원래 자리로 되돌렸습니다" : "옮겼습니다";
  return ok(`'${o.name}' 이름표를 ${what}.`);
}

// ── 여러 개 한꺼번에 ────────────────────────────────────────────────
export interface ItemRef { kind: "building" | "landmark"; id: number }

/**
 * 고른 건물·상징물을 같은 만큼 옮긴다. 막히면 snapR 안에서 모두가 들어가는 가장 가까운 자리를 찾는다.
 * 건물끼리는 묶음 밖 건물과만 겹침을 검사한다.
 */
export function moveGroup(
  ctx: PlacementContext, l: Layout, items: readonly ItemRef[], dx: number, dy: number, rules: PlacementRules = EDIT_RULES, snapR = 0,
): EditResult {
  const bs = items.filter((i) => i.kind === "building").map((i) => findBuilding(l, i.id)).filter((b): b is Building => !!b);
  const ms = items.filter((i) => i.kind === "landmark").map((i) => findLandmark(l, i.id)).filter((m): m is Landmark => !!m);
  if (!bs.length && !ms.length) return fail("고른 것이 없습니다.");
  const groupIds = new Set(bs.map((b) => b.id));
  const others = l.buildings.filter((b) => !groupIds.has(b.id));
  const fits = (ox: number, oy: number): boolean => {
    const moved = bs.map((b) => ({ ...b, x: round1(b.x + ox), y: round1(b.y + oy) }));
    for (const b of moved) if (checkPlacement(ctx, others, b, -1, [], rules)) return false;
    const trialLayout: Layout = { ...l, buildings: [...others, ...moved] };
    for (const m of ms) if (!landmarkFits(ctx, trialLayout, m.kind, m.x + ox, m.y + oy, rules)) return false;
    return true;
  };
  let off: [number, number] | undefined = fits(dx, dy) ? [dx, dy] : undefined;
  for (let r = 3; !off && r <= snapR; r += 3) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 3));
    for (let k = 0; k < n && !off; k++) {
      const a = (k / n) * Math.PI * 2;
      if (fits(dx + Math.cos(a) * r, dy + Math.sin(a) * r)) off = [dx + Math.cos(a) * r, dy + Math.sin(a) * r];
    }
  }
  if (!off) return fail("묶음 전체가 들어갈 빈자리가 없습니다.");
  for (const b of bs) Object.assign(b, { x: round1(b.x + off[0]), y: round1(b.y + off[1]), pinned: true });
  for (const m of ms) Object.assign(m, { x: round1(m.x + off[0]), y: round1(m.y + off[1]), pinned: true });
  return ok(`${bs.length + ms.length}개를 함께 옮겼습니다.${snapNote(off[0] - dx, off[1] - dy)}`);
}

export function deleteGroup(l: Layout, items: readonly ItemRef[]): EditResult {
  const ids = new Set(items.map((i) => `${i.kind}:${i.id}`));
  const before = l.buildings.length + l.landmarks.length;
  l.buildings = l.buildings.filter((b) => !ids.has(`building:${b.id}`));
  l.landmarks = l.landmarks.filter((m) => !ids.has(`landmark:${m.id}`));
  const n = before - l.buildings.length - l.landmarks.length;
  return n ? ok(`${n}개를 지웠습니다.`) : fail("지울 것이 없습니다.");
}

/** 고른 건물을 각자 제자리에서 돌린다. 하나라도 돌렸으면 성공. */
export function rotateEach(ctx: PlacementContext, l: Layout, ids: readonly number[], delta: number, rules: PlacementRules = EDIT_RULES): EditResult {
  let done = 0;
  for (const id of ids) if (rotateBuilding(ctx, l, id, delta, rules).ok) done++;
  if (!done) return fail("돌릴 수 있는 건물이 없습니다.");
  return ok(`${done}개를 돌렸습니다${done < ids.length ? ` (${ids.length - done}개는 막혀서 그대로)` : ""}.`);
}

export function renameLandmark(l: Layout, id: number, raw: string): EditResult {
  const m = findLandmark(l, id);
  if (!m) return fail("상징물을 찾을 수 없습니다.");
  const name = cleanName(raw);
  if (!name) return fail("이름이 비어 있습니다.");
  m.name = name;
  return ok(`이름을 '${name}'${ro(name)} 바꿨습니다.`);
}

export function deleteLandmark(l: Layout, id: number): EditResult {
  const i = l.landmarks.findIndex((m) => m.id === id);
  if (i < 0) return fail("상징물을 찾을 수 없습니다.");
  const [m] = l.landmarks.splice(i, 1);
  return ok(`'${m.name}'${eul(m.name)} 지웠습니다.`);
}

export function addLandmark(
  ctx: PlacementContext, l: Layout, kind: LandmarkKind, x: number, y: number, rules: PlacementRules = EDIT_RULES,
): EditResult & { id?: number } {
  if (!LANDMARKS[kind]) return fail("알 수 없는 상징물입니다.");
  if (l.landmarks.length >= MAX_LANDMARKS) return fail(`상징물은 ${MAX_LANDMARKS}개까지 둘 수 있습니다.`);
  const spot = landmarkSpot(ctx, l, kind, x, y, rules);
  if (!spot) return fail("건물·도로와 겹치거나 캠퍼스 밖이고, 근처에도 빈자리가 없습니다.");
  const m: Landmark = { id: l.nextId++, kind, name: LANDMARKS[kind].names[0], x: spot[0], y: spot[1], pinned: true };
  l.landmarks.push(m);
  return { ...ok(`'${m.name}'${eul(m.name)} 놓았습니다.${snapNote(spot[0] - x, spot[1] - y)}`), id: m.id };
}

/** 대학 이름을 바꾼다. 건물 이름에 들어 있던 옛 이름(예: ○○대학교병원)도 함께 바꾼다. */
export function renameUniversity(l: Layout, raw: string): EditResult {
  const name = cleanName(raw, 20);
  if (!name) return fail("대학 이름이 비어 있습니다.");
  const full = /(대학교|대학|university)$/iu.test(name) ? name : `${name}대학교`;
  const old = l.name;
  if (old && old !== full) {
    for (const b of l.buildings) if (b.name.includes(old)) b.name = b.name.split(old).join(full);
  }
  l.name = full;
  return ok(`대학 이름을 '${full}'${ro(full)} 바꿨습니다.`);
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

// ── 저장 형식 ────────────────────────────────────────────────────────
export const FORMAT = "campus-map/v1";

export interface SavedOptions {
  seed: string;
  buildings: number;
  hospital: boolean;
  season: string;
  time: string;
  view: string;
  surround: string;
  /** 건물 목록 (있으면 그 목록으로 만든 배치) */
  program?: string;
}

export interface SavedFile {
  format: typeof FORMAT;
  options: SavedOptions;
  layout: Layout;
}

const SHAPES: Shape[] = ["bar", "L", "U", "court", "wings", "atrium", "stepped", "twin", "tower", "gym", "round", "hospital", "hall", "plaza", "field"];
const STYLES: Style[] = ["brick", "modern", "glass", "classic", "concrete", "stone", "white"];
const KNOWN_TYPES = new Set([...BUILDING_TYPES, ...PLACE_TYPES].map((t) => t.id));

const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;

/** 저장 파일·브라우저 저장본의 배치를 검사한다. 하나라도 이상하면 오류를 던진다. */
export function layoutFromJSON(raw: unknown, limit = 5000): Layout {
  if (!raw || typeof raw !== "object") throw new Error("배치 정보가 없습니다.");
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? cleanName(o.name, 30) : undefined;
  if (!name) throw new Error("대학 이름이 없습니다.");
  if (!Array.isArray(o.buildings) || !Array.isArray(o.landmarks)) throw new Error("건물·상징물 목록이 없습니다.");
  if (o.buildings.length > MAX_ITEMS || o.landmarks.length > MAX_LANDMARKS * 2) throw new Error("항목이 너무 많습니다.");
  const ids = new Set<number>();
  const takeId = (v: unknown): number => {
    const id = num(v, 1, 1e6);
    if (id === undefined || !Number.isInteger(id) || ids.has(id)) throw new Error("항목 번호(id)가 올바르지 않습니다.");
    ids.add(id);
    return id;
  };
  const buildings: Building[] = o.buildings.map((r, i) => {
    const b = r as Record<string, unknown>;
    const where = `${i + 1}번 건물`;
    const type = typeof b.type === "string" && KNOWN_TYPES.has(b.type) ? b.type : undefined;
    const shape = SHAPES.find((s) => s === b.shape);
    const style = STYLES.find((s) => s === b.style);
    const bname = typeof b.name === "string" ? cleanName(b.name) : undefined;
    const x = num(b.x, -limit, limit), y = num(b.y, -limit, limit), angle = num(b.angle, -7, 7);
    const w = num(b.w, 4, 400), d = num(b.d, 4, 400), floors = num(b.floors, 0, MAX_FLOORS), variant = num(b.variant, 0, 1);
    if (!type || !shape || !style || !bname || x === undefined || y === undefined || angle === undefined || w === undefined
      || d === undefined || floors === undefined || variant === undefined) {
      throw new Error(`${where}의 값이 올바르지 않습니다.`);
    }
    const out: Building = { id: takeId(b.id), type, name: bname, x, y, angle, w, d, floors: Math.round(floors), style, shape, variant };
    if (b.unlisted === true) out.unlisted = true;
    readExtras(b, out);
    return out;
  });
  const landmarks: Landmark[] = o.landmarks.map((r, i) => {
    const m = r as Record<string, unknown>;
    const kind = LANDMARK_KINDS.find((k) => k === m.kind);
    const mname = typeof m.name === "string" ? cleanName(m.name) : undefined;
    const x = num(m.x, -limit, limit), y = num(m.y, -limit, limit);
    if (!kind || !mname || x === undefined || y === undefined) throw new Error(`${i + 1}번 상징물의 값이 올바르지 않습니다.`);
    const out: Landmark = { id: takeId(m.id), kind, name: mname, x, y };
    readExtras(m, out);
    return out;
  });
  const out: Layout = { name, buildings, landmarks, nextId: 1 };
  // 손으로 그린 길·숨긴 도로·나무
  if (o.roads !== undefined) {
    if (!Array.isArray(o.roads) || o.roads.length > MAX_ROADS) throw new Error("길 목록이 올바르지 않습니다.");
    out.roads = o.roads.map((r, i) => {
      const rr = r as Record<string, unknown>;
      const kind = rr.kind === "road" || rr.kind === "path" ? rr.kind : undefined;
      const pts = Array.isArray(rr.pts) && rr.pts.length >= 2 && rr.pts.length <= MAX_ROAD_POINTS
        ? rr.pts.map((p) => (Array.isArray(p) ? [num(p[0], -limit, limit), num(p[1], -limit, limit)] : [undefined, undefined]))
        : undefined;
      if (!kind || !pts || pts.some((p) => p[0] === undefined || p[1] === undefined)) throw new Error(`${i + 1}번 길의 값이 올바르지 않습니다.`);
      return { id: takeId(rr.id), kind, pts: pts as [number, number][] };
    });
  }
  if (o.hiddenRoads !== undefined) {
    if (!Array.isArray(o.hiddenRoads) || o.hiddenRoads.length > 200 || !o.hiddenRoads.every((v) => Number.isInteger(v) && v >= 0 && v < 1000)) {
      throw new Error("숨긴 도로 목록이 올바르지 않습니다.");
    }
    out.hiddenRoads = [...new Set(o.hiddenRoads as number[])];
  }
  for (const key of ["clearings", "groves"] as const) {
    const v = o[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.length > MAX_CIRCLES) throw new Error("나무 편집 정보가 올바르지 않습니다.");
    out[key] = v.map((c) => {
      const cc = c as Record<string, unknown>;
      const x = num(cc.x, -limit, limit), y = num(cc.y, -limit, limit), r = num(cc.r, 2, 120);
      if (x === undefined || y === undefined || r === undefined) throw new Error("나무 편집 정보가 올바르지 않습니다.");
      return { x, y, r };
    });
  }
  const maxId = Math.max(0, ...ids);
  out.nextId = Math.floor(Math.max(maxId + 1, num(o.nextId, 1, 1e6) ?? 0));
  return out;
}

export const MAX_ROADS = 80;
export const MAX_ROAD_POINTS = 200;
export const MAX_CIRCLES = 400;

/** 건물·상징물의 선택 항목 (고정, 이름표 위치·숨김) */
function readExtras(src: Record<string, unknown>, out: Building | Landmark): void {
  if (src.pinned === true) out.pinned = true;
  if (typeof src.src === "string" && src.src.length <= 40) out.src = src.src;
  if (src.labelHidden === true) out.labelHidden = true;
  const dx = num(src.labelDx, -2000, 2000), dy = num(src.labelDy, -2000, 2000);
  if (dx !== undefined && dy !== undefined) { out.labelDx = dx; out.labelDy = dy; }
}

export function parseSavedFile(raw: unknown): SavedFile {
  if (!raw || typeof raw !== "object") throw new Error("JSON 파일이 아닙니다.");
  const o = raw as Record<string, unknown>;
  if (o.format !== FORMAT) throw new Error(`지원하지 않는 형식입니다 (${FORMAT} 파일만 불러올 수 있습니다).`);
  const opt = (o.options ?? {}) as Record<string, unknown>;
  const seed = typeof opt.seed === "string" ? opt.seed.slice(0, 40) : "";
  if (!seed) throw new Error("시드가 없습니다.");
  const options: SavedOptions = {
    seed,
    buildings: Math.round(num(opt.buildings, 6, 40) ?? 24),
    hospital: opt.hospital !== false,
    season: typeof opt.season === "string" ? opt.season : "spring",
    time: typeof opt.time === "string" ? opt.time : "day",
    view: typeof opt.view === "string" ? opt.view : "mid",
    surround: typeof opt.surround === "string" ? opt.surround : "forest",
  };
  if (typeof opt.program === "string" && opt.program.trim()) {
    if (opt.program.length > 20000) throw new Error("건물 목록이 너무 깁니다.");
    options.program = opt.program;
  }
  return { format: FORMAT, options, layout: layoutFromJSON(o.layout) };
}

export function toSavedFile(options: SavedOptions, layout: Layout): SavedFile {
  return { format: FORMAT, options, layout: cloneLayout(layout) };
}

/** 되돌리기 기록 (최근 limit단계) */
export class EditHistory<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private readonly limit: number;
  private readonly copy: (s: T) => T;
  constructor(limit: number, copy: (s: T) => T) {
    this.limit = limit;
    this.copy = copy;
  }

  record(state: T): void {
    this.undoStack.push(this.copy(state));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: T): T | undefined {
    const prev = this.undoStack.pop();
    if (prev) this.redoStack.push(this.copy(current));
    return prev;
  }

  redo(current: T): T | undefined {
    const next = this.redoStack.pop();
    if (next) this.undoStack.push(this.copy(current));
    return next;
  }

  /** 마지막 기록을 되돌리기 목록에 남기지 않고 꺼낸다 (시작했다가 취소한 편집용). */
  discardLast(): T | undefined {
    return this.undoStack.pop();
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
}

