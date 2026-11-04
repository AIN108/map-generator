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

export const cloneLayout = (l: Layout): Layout => ({
  name: l.name,
  buildings: l.buildings.map((b) => ({ ...b })),
  landmarks: l.landmarks.map((m) => ({ ...m })),
  nextId: l.nextId,
});

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
  l.buildings.push(spot);
  return { ...ok(`${numberMap(l.buildings).get(spot.id)}번 '${spot.name}'${eul(spot.name)} 놓았습니다.${note}`), id: spot.id };
}

const LANDMARK_RADIUS: Record<LandmarkKind, number> = {
  fountain: 8, obelisk: 10, loop: 5, globe: 5, book: 5, curve: 10, garden: 12, emblem: 6, statue: 4, bell: 6, pond: 28,
};

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
  return ok(`'${m.name}'${eul(m.name)} 옮겼습니다.${note}`);
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
  const m: Landmark = { id: l.nextId++, kind, name: LANDMARKS[kind].names[0], x: spot[0], y: spot[1] };
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
    return out;
  });
  const landmarks: Landmark[] = o.landmarks.map((r, i) => {
    const m = r as Record<string, unknown>;
    const kind = LANDMARK_KINDS.find((k) => k === m.kind);
    const mname = typeof m.name === "string" ? cleanName(m.name) : undefined;
    const x = num(m.x, -limit, limit), y = num(m.y, -limit, limit);
    if (!kind || !mname || x === undefined || y === undefined) throw new Error(`${i + 1}번 상징물의 값이 올바르지 않습니다.`);
    return { id: takeId(m.id), kind, name: mname, x, y };
  });
  const maxId = Math.max(0, ...ids);
  const nextId = Math.max(maxId + 1, num(o.nextId, 1, 1e6) ?? 0);
  return { name, buildings, landmarks, nextId: Math.floor(nextId) };
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

