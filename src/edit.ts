// 배치 편집: 건물·상징물 옮기기·돌리기·이름 바꾸기·추가·삭제, 되돌리기, JSON 저장 형식.

import {
  BUILDING_TYPES, buildingType, LANDMARK_KINDS, LANDMARKS, PLACE_TYPES, type LandmarkKind, type Shape, type Style,
} from "./catalog.ts";
import { normAngle } from "./geom.ts";
import {
  checkPlacement, isPlace, landmarkClear, PROBLEM_KO, type Building, type Landmark, type Layout, type PlacementContext,
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

export function moveBuilding(ctx: PlacementContext, l: Layout, id: number, x: number, y: number): EditResult {
  const b = findBuilding(l, id);
  if (!b) return fail("건물을 찾을 수 없습니다.");
  const trial = { ...b, x: round1(x), y: round1(y) };
  const problem = checkPlacement(ctx, l.buildings, trial, id);
  if (problem) return fail(PROBLEM_KO[problem]);
  b.x = trial.x;
  b.y = trial.y;
  return ok(`'${b.name}'${eul(b.name)} 옮겼습니다.`);
}

export function rotateBuilding(ctx: PlacementContext, l: Layout, id: number, delta: number): EditResult {
  const b = findBuilding(l, id);
  if (!b) return fail("건물을 찾을 수 없습니다.");
  const trial = { ...b, angle: Math.round(normAngle(b.angle + delta) * 1000) / 1000 || 0 };
  const problem = checkPlacement(ctx, l.buildings, trial, id);
  if (problem) return fail(`돌릴 수 없습니다: ${PROBLEM_KO[problem]}`);
  b.angle = trial.angle;
  return ok(`'${b.name}'${eul(b.name)} 돌렸습니다.`);
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

/** 고른 종류의 건물을 (x, y)에 새로 놓는다. 정면이 남쪽을 보게 두고, 안 되면 90°씩 돌려 본다. */
export function addBuilding(ctx: PlacementContext, l: Layout, typeId: string, x: number, y: number): EditResult & { id?: number } {
  const t = buildingType(typeId);
  if (!t) return fail("알 수 없는 건물 종류입니다.");
  if (l.buildings.length >= MAX_ITEMS) return fail(`건물은 ${MAX_ITEMS}개까지 둘 수 있습니다.`);
  const mid = (r: [number, number]): number => Math.round(((r[0] + r[1]) / 2) * 10) / 10;
  const b: Building = {
    id: l.nextId, type: t.id, name: t.name.replace("{U}", l.name), x: round1(x), y: round1(y), angle: 0,
    w: mid(t.w), d: mid(t.d), floors: Math.round(mid(t.floors)), style: t.styles[0], shape: t.shapes[0], variant: 0.3,
  };
  let problem = checkPlacement(ctx, l.buildings, b);
  for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
    if (!problem) break;
    const trial = { ...b, angle: Math.round(a * 1000) / 1000 };
    const p2 = checkPlacement(ctx, l.buildings, trial);
    if (!p2) { b.angle = trial.angle; problem = undefined; }
  }
  if (problem) return fail(PROBLEM_KO[problem]);
  l.nextId++;
  l.buildings.push(b);
  return { ...ok(`${l.buildings.length}번 '${b.name}'${eul(b.name)} 놓았습니다.`), id: b.id };
}

const LANDMARK_RADIUS: Record<LandmarkKind, number> = {
  fountain: 8, obelisk: 10, loop: 5, globe: 5, book: 5, curve: 10, garden: 12, emblem: 6, statue: 4, bell: 6, pond: 28,
};

export function moveLandmark(ctx: PlacementContext, l: Layout, id: number, x: number, y: number): EditResult {
  const m = findLandmark(l, id);
  if (!m) return fail("상징물을 찾을 수 없습니다.");
  if (m.kind !== "emblem" && !landmarkClear(ctx, l.buildings, [x, y], LANDMARK_RADIUS[m.kind] * 0.5)) {
    return fail("건물·도로와 겹치거나 캠퍼스 밖입니다.");
  }
  m.x = round1(x);
  m.y = round1(y);
  return ok(`'${m.name}'${eul(m.name)} 옮겼습니다.`);
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

export function addLandmark(ctx: PlacementContext, l: Layout, kind: LandmarkKind, x: number, y: number): EditResult & { id?: number } {
  if (!LANDMARKS[kind]) return fail("알 수 없는 상징물입니다.");
  if (l.landmarks.length >= MAX_LANDMARKS) return fail(`상징물은 ${MAX_LANDMARKS}개까지 둘 수 있습니다.`);
  if (!landmarkClear(ctx, l.buildings, [x, y], LANDMARK_RADIUS[kind] * 0.5)) return fail("건물·도로와 겹치거나 캠퍼스 밖입니다.");
  const m: Landmark = { id: l.nextId++, kind, name: LANDMARKS[kind].names[0], x: round1(x), y: round1(y) };
  l.landmarks.push(m);
  return { ...ok(`'${m.name}'${eul(m.name)} 놓았습니다.`), id: m.id };
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
    return { id: takeId(b.id), type, name: bname, x, y, angle, w, d, floors: Math.round(floors), style, shape, variant };
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

