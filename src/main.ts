import { type Camera, fitCamera, project, unproject, type ViewAngle, VIEW_KO } from "./camera.ts";
import { BUILDING_TYPES, buildingType, LANDMARK_KINDS, LANDMARKS, PLACE_TYPES, STYLE_KO, type LandmarkKind } from "./catalog.ts";
import { buildDrawList, computeForest, type DrawList, type Forest } from "./drawlist.ts";
import {
  addBuilding, addLandmark, addSpot, cloneLayout, deleteBuilding, deleteLandmark, EditHistory, editRules, type EditResult, snapReach,
  findBuilding, findLandmark, landmarkFits, landmarkSpot, newBuilding, nudge, duplicateBuilding, reorderBuilding, setStyle, setShape, setType,
  resizeBuilding, setAngle, setLabel, SHAPE_KO, BUILDING_SHAPES,
  layoutFromJSON, moveBuilding, moveLandmark, parseSavedFile, renameBuilding, renameLandmark, renameUniversity, rotateBuilding,
  setFloors, toSavedFile,
} from "./edit.ts";
import { pointInPolygon, rectCorners, type Vec2 } from "./geom.ts";
import {
  autoName, checkPlacement, findPlacement, generateLayout, isPlace, numberMap, placementContext, type Building, type Layout, type PlacementContext,
  type PlacementRules,
} from "./layout.ts";
import { FLOOR_H } from "./model.ts";
import { englishName, eul } from "./names.ts";
import { makePalette, SEASON_KO, TIME_KO, type Season, type TimeOfDay } from "./palette.ts";
import { DEFAULT_LAYERS, LANDMARK_DESC, labelHits, type Layers, paint, type PaintView } from "./paint.ts";
import { deriveScene, makeSurroundings, type Scene, type Surround, type Surroundings, SURROUND_KO } from "./scene.ts";
import { generateSite, type Site } from "./site.ts";
import {
  extractFromProse, looksLikeProgram, MAX_PROGRAM_TEXT, parseProgram, programToText, type Program,
} from "./program.ts";
import { generateFromProgram } from "./programLayout.ts";
import { programFromLayout } from "./sync.ts";
import { clampView, identityView, MAX_SCALE, MIN_SCALE, anchoredView, sameView, toMap, zoomAt, type View } from "./view.ts";

// ── 기본값 ───────────────────────────────────────────────────────────
const W = 1600, H = 1200;

interface Options {
  seed: string;
  /** 사용자가 정한 대학 이름 (비면 시드로 자동) */
  name: string;
  buildings: number;
  hospital: boolean;
  season: Season;
  time: TimeOfDay;
  view: ViewAngle;
  surround: Surround;
}

const DEFAULTS: Options = {
  seed: "campus", name: "", buildings: 24, hospital: true, season: "spring", time: "day", view: "mid", surround: "forest",
};
const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];
const TIMES: TimeOfDay[] = ["day", "dusk", "night"];
const VIEWS: ViewAngle[] = ["low", "mid", "high"];
const SURROUNDS: Surround[] = ["forest", "city"];
const MIN_BUILDINGS = 10, MAX_BUILDINGS = 32;
const STORAGE_KEY = "cmg:layout:v1";
const PROGRAM_KEY = "cmg:program:v1";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 요소가 없습니다.`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>("map");
const overlay = $<HTMLCanvasElement>("overlay");
const ctx = canvas.getContext("2d");
const octx = overlay.getContext("2d");
if (!ctx || !octx) throw new Error("Canvas 2D를 사용할 수 없습니다.");
const mapWrap = $("mapWrap");
const statusEl = $("status");
const infoEl = $("info");

// ── 상태 ─────────────────────────────────────────────────────────────
let options: Options = { ...DEFAULTS };
let site: Site | undefined;
let siteKey = "";
let pctx: PlacementContext | undefined;
let cam: Camera | undefined;
let camKey = "";
let surroundings: Surroundings | undefined;
let forest: Forest | undefined;
let surroundKey = "";
let layout: Layout | undefined;
/** 적용 중인 건물 목록 (비어 있으면 자동 배치) */
let programText = "";
let program: Program | undefined;
/** 목록으로 만든 시드 배치 (부지와 함께 만들어지므로 따로 들고 있는다) */
let programLayout: Layout | undefined;
let programWarnings: string[] = [];
/** 시드 배치에서 바뀌었는지 (저장·초기화 버튼에 쓴다) */
let edited = false;
let scene: Scene | undefined;
let dl: DrawList | undefined;
let layers: Layers = { ...DEFAULT_LAYERS };
let view: View = identityView();
let selected: { kind: "building" | "landmark"; id: number } | undefined;
let hovered: { kind: "building" | "landmark"; id: number } | undefined;
const history = new EditHistory<Layout>(60, cloneLayout);

type Tool = "select" | "addBuilding" | "addLandmark" | "erase";
const TOOL_HINTS: Record<Tool, string> = {
  select: "건물·상징물을 끌어서 옮깁니다. 막힌 자리에 놓으면 가장 가까운 빈자리에 붙고, 초록 상자가 놓일 자리입니다. 빈 곳을 끌면 지도가 움직입니다. R로 돌리고 Delete로 지웁니다.",
  addBuilding: "누른 자리에 고른 건물을 놓습니다. 마우스를 올리면 놓일 자리가 초록 상자로 보입니다 (막혔으면 가까운 빈자리). 끌면 지도가 움직입니다.",
  addLandmark: "누른 자리에 고른 상징물을 놓습니다. 막혔으면 가까운 빈자리에 놓습니다.",
  erase: "누른 건물·상징물을 지웁니다. 건물을 지우면 뒤 번호가 하나씩 당겨집니다.",
};
let editMode = false;
let tool: Tool = "select";
/** 자유 배치: 켜면 겹쳐도 놓는다 */
let freePlace = false;
const rules = (): PlacementRules => editRules(freePlace);

// ── URL 해시 ↔ 옵션 ─────────────────────────────────────────────────
function readHash(): Partial<Options> {
  const p = new URLSearchParams(location.hash.slice(1));
  const out: Partial<Options> = {};
  const seed = p.get("seed");
  if (seed) out.seed = seed.slice(0, 40);
  const name = p.get("name");
  if (name) out.name = name.slice(0, 20);
  const n = Number(p.get("n"));
  if (p.has("n") && Number.isFinite(n)) out.buildings = Math.max(MIN_BUILDINGS, Math.min(MAX_BUILDINGS, Math.round(n)));
  if (p.has("hospital")) out.hospital = p.get("hospital") !== "0";
  const pickOf = <T extends string>(key: string, list: readonly T[]): T | undefined => list.find((v) => v === p.get(key));
  out.season = pickOf("season", SEASONS);
  out.time = pickOf("time", TIMES);
  out.view = pickOf("view", VIEWS);
  out.surround = pickOf("surround", SURROUNDS);
  for (const k of Object.keys(out) as (keyof Options)[]) if (out[k] === undefined) delete out[k];
  return out;
}

function writeHash(o: Options): void {
  const p = new URLSearchParams({
    seed: o.seed, n: String(o.buildings), hospital: o.hospital ? "1" : "0", season: o.season, time: o.time, view: o.view, surround: o.surround,
  });
  if (o.name) p.set("name", o.name);
  history_replace(`#${p}`);
}
function history_replace(hash: string): void {
  window.history.replaceState(null, "", hash);
}

// ── 폼 ↔ 옵션 ────────────────────────────────────────────────────────
function fillForm(o: Options): void {
  $<HTMLInputElement>("seed").value = o.seed;
  $<HTMLInputElement>("univName").value = o.name;
  $<HTMLInputElement>("buildings").value = String(o.buildings);
  $("buildingsOut").textContent = `${o.buildings}동`;
  $<HTMLInputElement>("hospital").checked = o.hospital;
  $<HTMLSelectElement>("season").value = o.season;
  $<HTMLSelectElement>("time").value = o.time;
  $<HTMLSelectElement>("view").value = o.view;
  $<HTMLSelectElement>("surround").value = o.surround;
}

function readForm(): Options {
  const sel = <T extends string>(id: string, list: readonly T[], fallback: T): T =>
    list.find((v) => v === $<HTMLSelectElement>(id).value) ?? fallback;
  return {
    seed: $<HTMLInputElement>("seed").value.trim() || DEFAULTS.seed,
    name: $<HTMLInputElement>("univName").value.trim().slice(0, 20),
    buildings: Math.max(MIN_BUILDINGS, Math.min(MAX_BUILDINGS, Math.round(Number($<HTMLInputElement>("buildings").value) || DEFAULTS.buildings))),
    hospital: $<HTMLInputElement>("hospital").checked,
    season: sel("season", SEASONS, "spring"),
    time: sel("time", TIMES, "day"),
    view: sel("view", VIEWS, "mid"),
    surround: sel("surround", SURROUNDS, "forest"),
  };
}

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

// ── 그리기 ───────────────────────────────────────────────────────────
const pixelRatio = (): number => canvas.width / W;
const MIN_TEXT_RATIO = 0.85;
function textScale(): number {
  const cssWidth = canvas.getBoundingClientRect().width;
  if (!(cssWidth > 0)) return 1;
  return Math.min(3, Math.max(1, MIN_TEXT_RATIO / (cssWidth / W)));
}

const frame = (): { name: string; nameEn: string } => ({ name: layout?.name ?? "", nameEn: englishName(layout?.name ?? "") });
const paintView = (): PaintView => ({ scale: view.scale, x: view.x, y: view.y, ratio: pixelRatio(), textScale: textScale() });

/** 라벨을 뺀 바탕 사본 (확대·이동 중 늘려 쓴다) */
const baseCanvas = document.createElement("canvas");
let baseFresh = false;

function syncBacking(): boolean {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  const cssWidth = rect.width > 0 ? rect.width : W;
  const w = Math.max(1, Math.min(4096, Math.round(cssWidth * dpr)));
  const h = Math.max(1, Math.round((w * H) / W));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = overlay.width = w;
  canvas.height = overlay.height = h;
  baseFresh = false;
  return true;
}

function renderBase(): void {
  if (!dl) return;
  baseCanvas.width = canvas.width;
  baseCanvas.height = canvas.height;
  const b = baseCanvas.getContext("2d")!;
  paint(b, dl, { ...paintView(), scale: 1, x: 0, y: 0 }, layers, frame(), "base");
  baseFresh = true;
}

function draw(): void {
  if (!dl) return;
  clearTimeout(sharpTimer);
  ctx!.setTransform(1, 0, 0, 1, 0, 0);
  if (view.scale === 1) {
    if (!baseFresh) renderBase();
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    ctx!.drawImage(baseCanvas, 0, 0);
    paint(ctx!, dl, paintView(), layers, frame(), "labels");
  } else {
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    paint(ctx!, dl, paintView(), layers, frame(), "all");
  }
  ctx!.setTransform(1, 0, 0, 1, 0, 0);
  drawOverlay();
}

let sharpTimer = 0;
let fastQueued = false;

function drawFast(): void {
  if (!dl) return;
  if (!baseFresh) renderBase();
  const s = view.scale, r = pixelRatio();
  ctx!.setTransform(1, 0, 0, 1, 0, 0);
  ctx!.clearRect(0, 0, canvas.width, canvas.height);
  ctx!.drawImage(baseCanvas, view.x * r, view.y * r, canvas.width / s, canvas.height / s, 0, 0, canvas.width, canvas.height);
  paint(ctx!, dl, paintView(), layers, frame(), "labels");
  drawOverlay();
}

function setView(next: View): void {
  const clamped = clampView(next, W, H);
  if (sameView(clamped, view)) return;
  view = clamped;
  syncZoomUi();
  if (!fastQueued) {
    fastQueued = true;
    requestAnimationFrame(() => {
      fastQueued = false;
      drawFast();
    });
  }
  clearTimeout(sharpTimer);
  sharpTimer = window.setTimeout(draw, 160);
}

function zoomBy(factor: number): void {
  setView(zoomAt(view, factor, W / 2, H / 2, W, H));
}

function syncZoomUi(): void {
  mapWrap.classList.toggle("zoomed", view.scale > MIN_SCALE + 1e-6);
  $("zoomLevel").textContent = `${Math.round(view.scale * 100)}%`;
  $<HTMLButtonElement>("zoomIn").disabled = view.scale >= MAX_SCALE - 1e-6;
  $<HTMLButtonElement>("zoomOut").disabled = view.scale <= MIN_SCALE + 1e-6;
  $<HTMLButtonElement>("zoomReset").disabled = view.scale <= MIN_SCALE + 1e-6;
}

// ── 생성·재계산 ──────────────────────────────────────────────────────
/** 짧은 문자열 해시 (목록이 바뀌었는지 알아보는 용도) */
function textHash(t: string): string {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
const programKey = (): string => (programText ? `p${textHash(programText)}` : "auto");
const layoutKey = (o: Options): string =>
  programText ? `${o.seed}|${programKey()}` : `${o.seed}|${o.buildings}|${o.hospital ? 1 : 0}`;

function ensureSite(o: Options): void {
  const sk = programText ? `${o.seed}|${programKey()}|${o.name}` : `${o.seed}|${o.buildings}`;
  if (sk !== siteKey || !site) {
    if (program) {
      const r = generateFromProgram(o.seed, program, o.name);
      site = r.site;
      programLayout = r.layout;
      programWarnings = r.warnings;
    } else {
      site = generateSite(o.seed, o.buildings);
      programLayout = undefined;
      programWarnings = [];
    }
    pctx = placementContext(site);
    siteKey = sk;
    camKey = "";
  }
  const ck = `${sk}|${o.view}`;
  if (ck !== camKey || !cam) {
    cam = fitCamera(site.boundary, o.view, W, H);
    camKey = ck;
    surroundKey = "";
  }
  const rk = `${ck}|${o.surround}`;
  if (rk !== surroundKey || !surroundings) {
    surroundings = makeSurroundings(site, o.seed, o.surround, cam);
    forest = undefined;
    surroundKey = rk;
  }
}

/** 배치가 바뀌었을 때: 장면 → 그리기 목록 → 화면 */
function rebuild(): void {
  if (!site || !cam || !layout || !surroundings) return;
  const t0 = performance.now();
  scene = deriveScene(site, layout, options.seed, options.surround, cam, surroundings);
  if (!forest) forest = computeForest(scene, cam, options.seed);
  dl = buildDrawList(scene, cam, makePalette(options.season, options.time), options.seed, forest);
  baseFresh = false;
  draw();
  renderLegendList();
  syncInspector();
  updateEditButtons();
  syncProgramText();
  const ms = performance.now() - t0;
  if (ms > 0) document.documentElement.dataset.renderMs = String(Math.round(ms));
}

/** 보기만 바뀌었을 때 (계절·시간): 그리기 목록만 다시 */
function repaintPalette(): void {
  if (!scene || !cam || !forest) return rebuild();
  dl = buildDrawList(scene, cam, makePalette(options.season, options.time), options.seed, forest);
  baseFresh = false;
  draw();
}

function generate(o: Options, saved?: Layout): void {
  options = o;
  fillForm(o);
  writeHash(o);
  ensureSite(o);
  layout = saved ?? (programLayout ? cloneLayout(programLayout)
    : generateLayout(site!, { seed: o.seed, buildings: o.buildings, hospital: o.hospital, name: o.name }));
  edited = !!saved;
  if (!saved && o.name && !programLayout) layout.name = renameTo(layout, o.name);
  syncProgramUi();
  history.clear();
  selected = hovered = undefined;
  view = identityView();
  syncZoomUi();
  syncBacking();
  canvas.style.aspectRatio = overlay.style.aspectRatio = `${W} / ${H}`;
  rebuild();
  saveLayout();
  setStatus(`${layout.name} · 건물 ${layout.buildings.filter((b) => !isPlace(b)).length}동${program ? " (목록)" : ""} · ${SEASON_KO[o.season]} ${TIME_KO[o.time]} · 시점 ${VIEW_KO[o.view]} · 주변 ${SURROUND_KO[o.surround]}`);
}

function renameTo(l: Layout, name: string): string {
  renameUniversity(l, name);
  return l.name;
}

// ── 편집 공통 ────────────────────────────────────────────────────────
/** 같은 종류의 편집을 잇달아 하면(방향키 이동 등) 되돌리기 기록을 하나로 묶는다. */
let lastMerge: { key: string; at: number } | undefined;

function applyEdit(edit: (l: Layout) => EditResult, mergeKey?: string): boolean {
  if (!layout) return false;
  const before = cloneLayout(layout);
  const res = edit(layout);
  if (!res.ok) {
    setStatus(res.message, true);
    return false;
  }
  const now = performance.now();
  if (!(mergeKey && lastMerge && lastMerge.key === mergeKey && now - lastMerge.at < 1500)) history.record(before);
  lastMerge = mergeKey ? { key: mergeKey, at: now } : undefined;
  edited = true;
  rebuild();
  saveLayout();
  setStatus(res.message);
  return true;
}

function updateEditButtons(): void {
  $<HTMLButtonElement>("undo").disabled = !history.canUndo;
  $<HTMLButtonElement>("redo").disabled = !history.canRedo;
  $<HTMLButtonElement>("resetLayout").disabled = !edited;
}

function undo(): void {
  if (!layout) return;
  const prev = history.undo(layout);
  if (!prev) return;
  layout = prev;
  edited = true;
  fixSelection();
  rebuild();
  saveLayout();
  setStatus("되돌렸습니다.");
}

function redo(): void {
  if (!layout) return;
  const next = history.redo(layout);
  if (!next) return;
  layout = next;
  edited = true;
  fixSelection();
  rebuild();
  saveLayout();
  setStatus("다시 했습니다.");
}

function fixSelection(): void {
  if (!layout || !selected) return;
  const exists = selected.kind === "building" ? findBuilding(layout, selected.id) : findLandmark(layout, selected.id);
  if (!exists) selected = undefined;
}

// ── 브라우저 저장 (이 브라우저에만 남는 편의 기능) ───────────────────
function saveLayout(): void {
  try {
    if (programText) localStorage.setItem(PROGRAM_KEY, programText);
    else localStorage.removeItem(PROGRAM_KEY);
    if (edited && layout) localStorage.setItem(STORAGE_KEY, JSON.stringify({ key: layoutKey(options), layout }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 사생활 보호 모드 등에서는 저장하지 않는다.
  }
}

function loadLayout(o: Options): Layout | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as { key?: unknown; layout?: unknown };
    if (saved.key !== layoutKey(o)) return undefined;
    return layoutFromJSON(saved.layout);
  } catch {
    return undefined;
  }
}

// ── 좌표·선택 ────────────────────────────────────────────────────────
function canvasPx(e: { clientX: number; clientY: number }): [number, number] {
  const rect = canvas.getBoundingClientRect();
  return [((e.clientX - rect.left) / rect.width) * W, ((e.clientY - rect.top) / rect.height) * H];
}

/** 화면(보기 좌표) → 이미지 좌표 → 지면(월드) */
function toGround(px: number, py: number, z = 0): Vec2 | undefined {
  if (!cam) return undefined;
  const [ix, iy] = toMap(view, px, py);
  return unproject(cam, ix, iy, z);
}

type Pick = { kind: "building" | "landmark"; id: number };

function pickAt(px: number, py: number): Pick | undefined {
  if (!dl || !layout) return undefined;
  for (let i = labelHits.length - 1; i >= 0; i--) {
    const r = labelHits[i];
    if (r.id > 0 && px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1) {
      return findLandmark(layout, r.id) ? { kind: "landmark", id: r.id } : { kind: "building", id: r.id };
    }
  }
  const [ix, iy] = toMap(view, px, py);
  for (let i = dl.hits.length - 1; i >= 0; i--) {
    const h = dl.hits[i];
    const poly: Vec2[] = [];
    for (let k = 0; k < h.hull.length; k += 2) poly.push([h.hull[k], h.hull[k + 1]]);
    if (poly.length >= 3 && pointInPolygon([ix, iy], poly)) return { kind: h.landmark ? "landmark" : "building", id: h.id };
  }
  return undefined;
}

const samePick = (a?: Pick, b?: Pick): boolean => (!a && !b) || (!!a && !!b && a.kind === b.kind && a.id === b.id);

function select(p: Pick | undefined): void {
  if (nudgePending && !samePick(p, selected)) commitNudge();
  selected = p;
  syncInspector();
  renderLegendList();
  showInfo(p);
  drawOverlay();
}

// ── 오버레이 (선택·강조·끌기 미리보기) ───────────────────────────────
/** 끄는 중 미리보기: 놓일 자리(x, y, angle)와 커서 자리(rawX, rawY) */
let dragGhost: {
  kind: "building" | "landmark"; id: number; x: number; y: number; angle: number; valid: boolean; rawX: number; rawY: number;
} | undefined;
/** 건물 추가 도구 미리보기 */
let addGhost: { b: Building; valid: boolean; rawX: number; rawY: number } | undefined;

/** 바닥과 지붕 테두리로 상자를 그린다 (끌기·추가 미리보기) */
function drawGhostBox(b: { w: number; d: number; floors: number; shape: Building["shape"] }, x: number, y: number, angle: number, valid: boolean, faint = false): void {
  const lw = 1 / view.scale;
  const poly = rectCorners(x, y, b.w, b.d, angle);
  const hgt = isPlace(b) ? 0.5 : Math.max(4, b.floors * FLOOR_H);
  const P = (p: Vec2, z: number): [number, number] => { const q = project(cam!, p[0], p[1], z); return [q[0], q[1]]; };
  const color = faint ? "rgba(255,255,255,0.75)" : valid ? "rgba(60,200,120,0.95)" : "rgba(230,60,60,0.95)";
  octx!.setLineDash(faint ? [5 * lw, 4 * lw] : []);
  if (!faint) {
    octx!.fillStyle = valid ? "rgba(60,200,120,0.2)" : "rgba(230,60,60,0.2)";
    octx!.beginPath();
    poly.forEach((p, i) => { const [px, py] = P(p, 0); if (i === 0) octx!.moveTo(px, py); else octx!.lineTo(px, py); });
    octx!.fill();
  }
  octx!.beginPath();
  for (const z of faint ? [0] : [0, hgt]) {
    poly.forEach((p, i) => { const [px, py] = P(p, z); if (i === 0) octx!.moveTo(px, py); else octx!.lineTo(px, py); });
    octx!.closePath();
  }
  if (!faint) for (const p of poly) { const a = P(p, 0), c = P(p, hgt); octx!.moveTo(a[0], a[1]); octx!.lineTo(c[0], c[1]); }
  octx!.lineWidth = (faint ? 1.5 : 2) * lw;
  octx!.strokeStyle = color;
  octx!.stroke();
  octx!.setLineDash([]);
}

function drawOverlay(): void {
  const r = pixelRatio(), s = view.scale;
  octx!.setTransform(1, 0, 0, 1, 0, 0);
  octx!.clearRect(0, 0, overlay.width, overlay.height);
  if (!dl || !cam || !layout) return;
  octx!.setTransform(s * r, 0, 0, s * r, -view.x * s * r, -view.y * s * r);
  const lw = 1 / s;
  const outline = (p: Pick, color: string, width: number): void => {
    const h = dl!.hits.find((x) => x.id === p.id && !!x.landmark === (p.kind === "landmark"));
    if (!h) return;
    octx!.beginPath();
    for (let k = 0; k < h.hull.length; k += 2) {
      if (k === 0) octx!.moveTo(h.hull[k], h.hull[k + 1]); else octx!.lineTo(h.hull[k], h.hull[k + 1]);
    }
    octx!.closePath();
    octx!.lineWidth = width * lw;
    octx!.strokeStyle = color;
    octx!.stroke();
  };
  if (hovered && !samePick(hovered, selected)) outline(hovered, "rgba(255,255,255,0.85)", 2);
  if (selected) {
    outline(selected, "rgba(255,196,0,0.95)", 3);
  }
  if (dragGhost) {
    const g = dragGhost;
    const moved = Math.hypot(g.x - g.rawX, g.y - g.rawY) >= 1;
    if (g.kind === "building") {
      const b = findBuilding(layout, g.id);
      if (b) {
        if (moved || !g.valid) drawGhostBox(b, g.rawX, g.rawY, b.angle, false, g.valid);
        if (g.valid) drawGhostBox(b, g.x, g.y, g.angle, true);
      }
    } else {
      const color = g.valid ? "rgba(60,200,120,0.95)" : "rgba(230,60,60,0.95)";
      const q = project(cam, g.x, g.y, 0);
      octx!.beginPath();
      octx!.arc(q[0], q[1], 12 * lw, 0, Math.PI * 2);
      octx!.lineWidth = 2.5 * lw;
      octx!.strokeStyle = color;
      octx!.stroke();
    }
  }
  if (addGhost) {
    const a = addGhost;
    if (a.valid && Math.hypot(a.b.x - a.rawX, a.b.y - a.rawY) >= 1) drawGhostBox(a.b, a.rawX, a.rawY, 0, false, true);
    drawGhostBox(a.b, a.b.x, a.b.y, a.b.angle, a.valid);
  }
}

/** 막힌 자리에 놓을 때 빈자리를 찾는 반경 (m). 미리보기와 실제 놓기가 같은 값을 써야 보인 자리에 놓인다. */
const MOVE_SNAP = 45, ADD_SNAP = 60;

/** 미리보기 계산은 화면 한 장마다 한 번만 */
let previewTask: (() => void) | undefined;
let previewQueued = false;
function queuePreview(task: () => void): void {
  previewTask = task;
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    const t = previewTask;
    previewTask = undefined;
    t?.();
  });
}

// ── 정보 창 ──────────────────────────────────────────────────────────
function showInfo(p: Pick | undefined): void {
  const rows: [string, string][] = [];
  if (!p || !layout) {
    rows.push(["안내", "건물에 마우스를 올리거나 눌러 보세요."]);
  } else if (p.kind === "building") {
    const b = findBuilding(layout, p.id);
    if (b) {
      const no = numberMap(layout.buildings).get(b.id);
      const t = buildingType(b.type);
      rows.push(["번호", no ? `${no}번` : "번호 없음"], ["이름", b.name]);
      if (t) rows.push(["용도", t.use]);
      if (isPlace(b)) {
        rows.push(["크기", `${Math.round(b.w)} × ${Math.round(b.d)} m`]);
      } else {
        const area = Math.round((b.w * b.d * 0.82 * b.floors) / 10) * 10;
        rows.push(
          ["층수", `지상 ${b.floors}층 (높이 약 ${Math.round(b.floors * FLOOR_H)} m)`],
          ["바닥", `${Math.round(b.w)} × ${Math.round(b.d)} m`],
          ["연면적", `약 ${area.toLocaleString("ko-KR")} m²`],
          ["외관", STYLE_KO[b.style]],
        );
      }
    }
  } else {
    const m = findLandmark(layout, p.id);
    if (m) rows.push(["상징물", m.name], ["설명", LANDMARK_DESC(m.kind)]);
  }
  infoEl.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    return [dt, dd];
  }));
}

// ── 건물 목록 (지도 아래) ───────────────────────────────────────────
function renderLegendList(): void {
  const el = $("legendList");
  if (!layout) return;
  const numbers = numberMap(layout.buildings);
  el.replaceChildren(...layout.buildings.filter((b) => numbers.has(b.id)).map((b) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const no = document.createElement("b");
    no.textContent = String(numbers.get(b.id));
    const name = document.createElement("span");
    name.textContent = b.name;
    btn.append(no, name);
    btn.title = `${b.name}${eul(b.name)} 고르고 확대`;
    if (selected?.kind === "building" && selected.id === b.id) btn.setAttribute("aria-current", "true");
    btn.addEventListener("click", () => {
      select({ kind: "building", id: b.id });
      zoomTo(b.id);
    });
    return btn;
  }));
}

function zoomTo(id: number): void {
  const a = dl?.labels.find((l) => l.id === id);
  if (!a) return;
  const s = Math.max(view.scale, 2.4);
  setView(anchoredView(a.x, a.y + 40, W / 2, H / 2, s, W, H));
}

// ── 선택 정보 편집 창 ────────────────────────────────────────────────
function syncInspector(): void {
  const box = $("inspector");
  syncSelBar();
  if (!layout || !selected) { box.hidden = true; return; }
  const b = selected.kind === "building" ? findBuilding(layout, selected.id) : undefined;
  const m = selected.kind === "landmark" ? findLandmark(layout, selected.id) : undefined;
  if (!b && !m) { box.hidden = true; return; }
  box.hidden = false;
  const name = b ? b.name : m!.name;
  const no = b ? numberMap(layout.buildings).get(b.id) : undefined;
  $("inspectorTitle").textContent = b ? `${no ? `${no}번 ` : ""}${b.name}` : `상징물 · ${m!.name}`;
  const setIfIdle = (id: string, v: string): void => {
    const el = $<HTMLInputElement | HTMLSelectElement>(id);
    if (document.activeElement !== el) el.value = v;
  };
  setIfIdle("selName", name);
  const place = !!b && isPlace(b);
  $("selNoField").hidden = !b || !no;
  if (no) setIfIdle("selNo", String(no));
  $<HTMLInputElement>("selNo").max = String(numberMap(layout.buildings).size);
  $("selLooks").hidden = !b;
  if (b) {
    setIfIdle("selType", b.type);
    setIfIdle("selStyle", b.style);
    setIfIdle("selShape", b.shape);
    setIfIdle("selAngle", String(Math.round((((b.angle * 180) / Math.PI) % 360 + 360) % 360)));
    $<HTMLSelectElement>("selStyle").disabled = place;
    $<HTMLSelectElement>("selShape").disabled = place;
  }
  $("selFloorsField").hidden = !b || place;
  if (b && !place) {
    setIfIdle("selFloors", String(b.floors));
    $("selFloorsOut").textContent = `${b.floors}층`;
  }
  $("selSizeFields").hidden = !b;
  if (b) {
    setIfIdle("selW", String(Math.round(b.w)));
    setIfIdle("selD", String(Math.round(b.d)));
    $("selWOut").textContent = `${Math.round(b.w)}m`;
    $("selDOut").textContent = `${Math.round(b.d)}m`;
  }
  $("selRotateRow").hidden = !b;
  $("selZoom").hidden = !b;
  const o = b ?? m!;
  $<HTMLInputElement>("selLabelHidden").checked = !!o.labelHidden;
  $<HTMLButtonElement>("selLabelReset").disabled = o.labelDx === undefined;
  syncRouteUi();
}

function syncRouteUi(): void {
  $("selRouteField").hidden = true;
}

/** 지도 위 선택 도구 막대 */
function syncSelBar(): void {
  const bar = $("selBar");
  const b = layout && selected?.kind === "building" ? findBuilding(layout, selected.id) : undefined;
  const m = layout && selected?.kind === "landmark" ? findLandmark(layout, selected.id) : undefined;
  if (!b && !m) { bar.hidden = true; return; }
  bar.hidden = false;
  const no = b ? numberMap(layout!.buildings).get(b.id) : undefined;
  $("selBarName").textContent = b ? `${no ? `${no}번 ` : ""}${b.name}` : m!.name;
  $("barRotL").hidden = $("barRotR").hidden = $("barDup").hidden = !b;
}

// ── 편집 모드 ────────────────────────────────────────────────────────
function setEditMode(on: boolean): void {
  editMode = on;
  $<HTMLInputElement>("editMode").checked = on;
  $("editor").classList.toggle("active", on);
  mapWrap.classList.toggle("editing", on);
  syncToolUi();
}

function setTool(t: Tool): void {
  tool = t;
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="tool"]')) r.checked = r.value === t;
  syncToolUi();
}

function syncToolUi(): void {
  addGhost = undefined;
  $("addTypeField").hidden = tool !== "addBuilding";
  $("addLandmarkField").hidden = tool !== "addLandmark";
  $("toolHint").textContent = editMode ? TOOL_HINTS[tool] : "편집 모드를 켜면 지도에서 건물을 옮기거나 추가·삭제할 수 있습니다.";
  mapWrap.classList.toggle("add-tool", editMode && (tool === "addBuilding" || tool === "addLandmark"));
  mapWrap.classList.toggle("erase-tool", editMode && tool === "erase");
}

function fillInspectorSelects(): void {
  const opt = (value: string, text: string): HTMLOptionElement => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    return o;
  };
  $("selType").replaceChildren(...[...BUILDING_TYPES, ...PLACE_TYPES].map((t) => opt(t.id, t.use)));
  $("selStyle").replaceChildren(...(Object.entries(STYLE_KO) as [string, string][]).map(([k, v]) => opt(k, v)));
  $("selShape").replaceChildren(...BUILDING_SHAPES.map((k) => opt(k, SHAPE_KO[k])));
}

function fillAddSelects(): void {
  const typeSel = $<HTMLSelectElement>("addType");
  typeSel.replaceChildren(...[...BUILDING_TYPES, ...PLACE_TYPES].map((t) => {
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = `${t.name.replace("{U}", "대학")} — ${t.use}`;
    return o;
  }));
  const lmSel = $<HTMLSelectElement>("addLandmarkKind");
  lmSel.replaceChildren(...LANDMARK_KINDS.map((k) => {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = LANDMARKS[k].names[0];
    return o;
  }));
}

// ── 포인터 ───────────────────────────────────────────────────────────
const pointers = new Map<number, [number, number]>();
let pan: {
  id: number; last: [number, number]; start: [number, number]; moved: boolean; button: number;
  /** 편집 도구: 끌지 않고 떼면(누르기) 이 도구를 그 자리에 쓴다 */
  action?: Tool;
} | null = null;
let panHintShown = false;
let pinch: { mx: number; my: number; dist: number; scale: number } | null = null;
let gestureLock = false;
let spaceHeld = false;
/** 끄는 중인 건물·상징물. z는 잡은 높이 (높은 건물은 지붕 높이에서 잡아야 커서를 따라온다) */
let drag: { pick: Pick; id: number; offset: Vec2; start: [number, number]; moved: boolean; z: number } | null = null;

function capturePointer(id: number): void {
  try { canvas.setPointerCapture(id); } catch { /* 붙잡지 못해도 캔버스 안에서는 동작한다 */ }
}

function pinchPoints(): { mid: [number, number]; dist: number } {
  const [a, b] = [...pointers.values()];
  return { mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dist: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])) };
}

canvas.addEventListener("pointerdown", (e) => {
  const px = canvasPx(e);
  pointers.set(e.pointerId, px);
  if (pointers.size === 2) {
    e.preventDefault();
    drag = null;
    dragGhost = undefined;
    pan = null;
    mapWrap.classList.remove("panning", "dragging");
    const { mid, dist } = pinchPoints();
    const [mx, my] = toMap(view, ...mid);
    pinch = { mx, my, dist, scale: view.scale };
    gestureLock = true;
    capturePointer(e.pointerId);
    drawOverlay();
    return;
  }
  if (pointers.size > 2 || gestureLock) return;
  const wantsPan = e.button === 1 || e.button === 2 || (e.button === 0 && spaceHeld);
  if (!wantsPan && e.button === 0 && editMode && tool === "select" && startDrag(e, px)) return;
  // 그 밖에는 끌면 지도 이동, 끌지 않고 떼면 누르기 (편집 도구는 그 자리에 쓰고, 아니면 고르기)
  e.preventDefault();
  pan = {
    id: e.pointerId, last: px, start: px, moved: false, button: e.button,
    action: !wantsPan && e.button === 0 && editMode ? tool : undefined,
  };
  capturePointer(e.pointerId);
});

/** 선택·이동 도구: 누른 곳의 건물·상징물을 잡는다. 잡았으면 true. */
function startDrag(e: PointerEvent, px: [number, number]): boolean {
  if (!layout) return false;
  const p = pickAt(...px);
  if (!p) return false;
  select(p);
  const b = p.kind === "building" ? findBuilding(layout, p.id) : undefined;
  const obj = b ?? findLandmark(layout, p.id);
  if (!obj) return false;
  const z = b && !isPlace(b) ? Math.min(b.floors * FLOOR_H, 40) * 0.6 : 0;
  const g = toGround(...px, z);
  if (!g) return false;
  e.preventDefault();
  drag = { pick: p, id: p.id, offset: [obj.x - g[0], obj.y - g[1]], start: px, moved: false, z };
  capturePointer(e.pointerId);
  return true;
}

/** 편집 도구를 누른 자리에 쓴다 (추가·지우기). */
function useToolAt(px: [number, number]): void {
  if (!layout) return;
  const g = toGround(...px);
  if (tool === "select") {
    select(pickAt(...px));
  } else if (tool === "erase") {
    const p = pickAt(...px);
    if (!p) { setStatus("지울 건물·상징물을 누르세요.", true); return; }
    if (applyEdit((l) => p.kind === "building" ? deleteBuilding(l, p.id) : deleteLandmark(l, p.id))) select(undefined);
  } else if (tool === "addBuilding") {
    if (!g) return;
    const type = $<HTMLSelectElement>("addType").value;
    let newId: number | undefined;
    addGhost = undefined;
    if (applyEdit((l) => { const r = addBuilding(pctx!, l, type, g[0], g[1], rules(), ADD_SNAP); newId = r.id; return r; }) && newId) {
      select({ kind: "building", id: newId });
    }
  } else if (tool === "addLandmark") {
    if (!g) return;
    const kind = $<HTMLSelectElement>("addLandmarkKind").value as LandmarkKind;
    let newId: number | undefined;
    if (applyEdit((l) => { const r = addLandmark(pctx!, l, kind, g[0], g[1], rules()); newId = r.id; return r; }) && newId) {
      select({ kind: "landmark", id: newId });
    }
  }
}

canvas.addEventListener("pointermove", (e) => {
  const px = canvasPx(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, px);
  if (pinch) {
    if (pointers.size >= 2) {
      const { mid, dist } = pinchPoints();
      setView(anchoredView(pinch.mx, pinch.my, mid[0], mid[1], pinch.scale * (dist / pinch.dist), W, H));
    }
    return;
  }
  if (pan) {
    if (e.pointerId !== pan.id) return;
    if (!pan.moved && Math.hypot(px[0] - pan.start[0], px[1] - pan.start[1]) > 4) {
      pan.moved = true;
      mapWrap.classList.add("panning");
      if (addGhost) { addGhost = undefined; drawOverlay(); }
      // 편집 모드가 아닐 때 건물을 끌면 지도가 움직인다는 것을 한 번 알려 준다.
      if (!editMode && !panHintShown && pickAt(...pan.start)?.kind) {
        panHintShown = true;
        setStatus("건물을 옮기려면 '편집 모드'(E)를 켜고 끄세요. 지금은 지도가 움직입니다.");
      }
    }
    if (pan.moved) {
      const s = view.scale;
      setView({ scale: s, x: view.x - (px[0] - pan.last[0]) / s, y: view.y - (px[1] - pan.last[1]) / s });
    }
    pan.last = px;
    return;
  }
  if (gestureLock) return;
  if (drag && layout && pctx) {
    if (!drag.moved && Math.hypot(px[0] - drag.start[0], px[1] - drag.start[1]) < 3) return;
    drag.moved = true;
    mapWrap.classList.add("dragging");
    const g = toGround(...px, drag.z);
    if (!g) return;
    const d = drag;
    const x = g[0] + d.offset[0], y = g[1] + d.offset[1];
    queuePreview(() => {
      if (!layout || !pctx || drag !== d) return;
      if (d.pick.kind === "building") {
        const b = findBuilding(layout, d.id);
        if (!b) return;
        // 놓을 때와 같은 방법으로 찾되 미리보기는 조금 좁게 (손을 떼면 더 넓게 찾는다)
        const trial = { ...b, x, y };
        const spot = checkPlacement(pctx, layout.buildings, trial, b.id, [], rules()) ? findPlacement(pctx, layout.buildings, trial, x, y, b.id, rules(), snapReach(b, MOVE_SNAP), [b.angle, b.angle + Math.PI / 2]) : trial;
        dragGhost = { kind: "building", id: d.id, x: spot?.x ?? x, y: spot?.y ?? y, angle: spot?.angle ?? b.angle, valid: !!spot, rawX: x, rawY: y };
      } else {
        const m = findLandmark(layout, d.id);
        if (!m) return;
        const spot = landmarkSpot(pctx, layout, m.kind, x, y, rules(), m.id);
        dragGhost = { kind: "landmark", id: d.id, x: spot?.[0] ?? x, y: spot?.[1] ?? y, angle: 0, valid: !!spot, rawX: x, rawY: y };
      }
      drawOverlay();
    });
    return;
  }
  if (editMode && tool === "addBuilding" && e.pointerType === "mouse" && layout && pctx) {
    const g = toGround(...px);
    if (g) {
      queuePreview(() => {
        if (!layout || !pctx || drag || pan) return;
        const b = newBuilding(layout, $<HTMLSelectElement>("addType").value, g[0], g[1]);
        if (!b) return;
        const spot = addSpot(pctx, layout, b, rules(), ADD_SNAP);
        addGhost = { b: spot ?? b, valid: !!spot, rawX: g[0], rawY: g[1] };
        drawOverlay();
      });
    }
  }
  if (e.pointerType === "mouse") {
    const p = pickAt(...px);
    if (!samePick(p, hovered)) {
      hovered = p;
      mapWrap.classList.toggle("hovering", !!p && (!editMode || tool !== "addBuilding"));
      if (!selected) showInfo(p);
      drawOverlay();
    }
  }
});

function onPointerEnd(e: PointerEvent): void {
  pointers.delete(e.pointerId);
  if (pinch || gestureLock) {
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) gestureLock = false;
    return;
  }
  if (pan && e.pointerId === pan.id) {
    const clicked = !pan.moved && pan.button === 0 && e.type === "pointerup";
    const action = pan.action;
    pan = null;
    mapWrap.classList.remove("panning");
    if (clicked) {
      if (action) useToolAt(canvasPx(e));
      else select(pickAt(...canvasPx(e)));
    }
    return;
  }
  if (drag) {
    const d = drag;
    drag = null;
    previewTask = undefined;
    mapWrap.classList.remove("dragging");
    const ghost = dragGhost;
    dragGhost = undefined;
    if (d.moved && ghost && e.type === "pointerup") {
      // 커서 자리에서 다시 찾는다 (미리보기와 같은 순서로 찾으므로 보인 자리에 놓이고, 미리보기에서 못 찾았으면 더 넓게 찾는다).
      applyEdit((l) => d.pick.kind === "building"
        ? moveBuilding(pctx!, l, d.id, ghost.rawX, ghost.rawY, rules(), MOVE_SNAP)
        : moveLandmark(pctx!, l, d.id, ghost.rawX, ghost.rawY, rules()));
    }
    drawOverlay();
  }
}
canvas.addEventListener("pointerup", onPointerEnd);
canvas.addEventListener("pointercancel", onPointerEnd);
canvas.addEventListener("pointerleave", () => {
  if (addGhost) { addGhost = undefined; drawOverlay(); }
  if (hovered) {
    hovered = undefined;
    mapWrap.classList.remove("hovering");
    if (!selected) showInfo(undefined);
    drawOverlay();
  }
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("wheel", (e) => {
  if (!dl) return;
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const factor = Math.exp(-e.deltaY * unit * 0.0015);
  if ((factor < 1 && view.scale <= MIN_SCALE + 1e-6) || (factor > 1 && view.scale >= MAX_SCALE - 1e-6)) return;
  e.preventDefault();
  const px = canvasPx(e);
  setView(zoomAt(view, factor, px[0], px[1], W, H));
}, { passive: false });
$("zoomIn").addEventListener("click", () => zoomBy(1.5));
$("zoomOut").addEventListener("click", () => zoomBy(1 / 1.5));
$("zoomReset").addEventListener("click", () => setView(identityView()));

// ── 선택 편집 창 이벤트 ──────────────────────────────────────────────
function renameSelected(): void {
  if (!selected) return;
  const value = $<HTMLInputElement>("selName").value;
  const p = selected;
  applyEdit((l) => p.kind === "building" ? renameBuilding(l, p.id, value) : renameLandmark(l, p.id, value));
}
$("selRename").addEventListener("click", renameSelected);
$<HTMLInputElement>("selName").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); renameSelected(); }
});
$<HTMLInputElement>("selFloors").addEventListener("input", (e) => {
  $("selFloorsOut").textContent = `${(e.target as HTMLInputElement).value}층`;
});
$<HTMLInputElement>("selFloors").addEventListener("change", (e) => {
  if (selected?.kind !== "building") return;
  const id = selected.id, f = Number((e.target as HTMLInputElement).value);
  applyEdit((l) => setFloors(l, id, f));
});
const rotateSelected = (deg: number): void => {
  if (selected?.kind !== "building") return;
  const id = selected.id;
  applyEdit((l) => rotateBuilding(pctx!, l, id, (deg * Math.PI) / 180, rules()));
};
$("selRotL").addEventListener("click", () => rotateSelected(-15));
$("selRotR").addEventListener("click", () => rotateSelected(15));
$("selZoom").addEventListener("click", () => selected && zoomTo(selected.id));
const deleteSelected = (): void => {
  if (!selected) return;
  const p = selected;
  if (applyEdit((l) => p.kind === "building" ? deleteBuilding(l, p.id) : deleteLandmark(l, p.id))) select(undefined);
};
$("selDelete").addEventListener("click", deleteSelected);

// 방향키 미세 이동: 누르는 동안 모아 두었다가 잠시 멈추면 한 번에 반영한다 (되돌리기 기록도 하나로 묶임).
let nudgePending: { kind: "building" | "landmark"; id: number; dx: number; dy: number } | undefined;
let nudgeTimer = 0;
function queueNudge(dx: number, dy: number): void {
  if (!layout || !selected || !pctx) return;
  if (!nudgePending || nudgePending.id !== selected.id || nudgePending.kind !== selected.kind) {
    commitNudge();
    nudgePending = { kind: selected.kind, id: selected.id, dx: 0, dy: 0 };
  }
  const p = nudgePending;
  const o = p.kind === "building" ? findBuilding(layout, p.id) : findLandmark(layout, p.id);
  if (!o) return;
  // 막힌 쪽으로는 더 가지 않고 그 앞에서 멈춘다.
  const x = o.x + p.dx + dx, y = o.y + p.dy + dy;
  let valid = true;
  if (p.kind === "building") valid = !checkPlacement(pctx, layout.buildings, { ...(o as Building), x, y }, o.id, [], rules());
  else valid = landmarkFits(pctx, layout, (o as Layout["landmarks"][number]).kind, x, y, rules());
  if (valid) { p.dx += dx; p.dy += dy; } else setStatus("그쪽은 막혀 있어 더 옮길 수 없습니다.", true);
  const gx = o.x + p.dx, gy = o.y + p.dy;
  dragGhost = { kind: p.kind, id: p.id, x: gx, y: gy, angle: p.kind === "building" ? (o as Building).angle : 0, valid: true, rawX: gx, rawY: gy };
  drawOverlay();
  clearTimeout(nudgeTimer);
  nudgeTimer = window.setTimeout(commitNudge, 350);
}
function commitNudge(): void {
  clearTimeout(nudgeTimer);
  const p = nudgePending;
  nudgePending = undefined;
  if (!p) return;
  dragGhost = undefined;
  if (p.dx || p.dy) applyEdit((l) => nudge(pctx!, l, p.kind, p.id, p.dx, p.dy, rules()), `nudge:${p.kind}:${p.id}`);
  else drawOverlay();
}

function duplicateSelected(): void {
  if (selected?.kind !== "building") return;
  const id = selected.id;
  let newId: number | undefined;
  if (applyEdit((l) => { const r = duplicateBuilding(pctx!, l, id, rules()); newId = r.id; return r; }) && newId) {
    select({ kind: "building", id: newId });
  }
}
$("selDup").addEventListener("click", duplicateSelected);
$("barDup").addEventListener("click", duplicateSelected);
$("barRotL").addEventListener("click", () => rotateSelected(-15));
$("barRotR").addEventListener("click", () => rotateSelected(15));
$("barDelete").addEventListener("click", deleteSelected);
$("barClose").addEventListener("click", () => select(undefined));

const reorderTo = (n: number): void => {
  if (selected?.kind !== "building" || !Number.isFinite(n)) return;
  const id = selected.id;
  applyEdit((l) => reorderBuilding(l, id, n));
};
$<HTMLInputElement>("selNo").addEventListener("change", (e) => reorderTo(Number((e.target as HTMLInputElement).value)));
const currentNo = (): number => (layout && selected?.kind === "building" ? numberMap(layout.buildings).get(selected.id) ?? 0 : 0);
$("selNoUp").addEventListener("click", () => { const n = currentNo(); if (n > 1) reorderTo(n - 1); });
$("selNoDown").addEventListener("click", () => { const n = currentNo(); if (n) reorderTo(n + 1); });
$<HTMLSelectElement>("selType").addEventListener("change", (e) => {
  if (selected?.kind !== "building") return;
  const id = selected.id, v = (e.target as HTMLSelectElement).value;
  applyEdit((l) => setType(l, id, v));
});
$<HTMLSelectElement>("selStyle").addEventListener("change", (e) => {
  if (selected?.kind !== "building") return;
  const id = selected.id, v = (e.target as HTMLSelectElement).value as Building["style"];
  applyEdit((l) => setStyle(l, id, v));
});
$<HTMLSelectElement>("selShape").addEventListener("change", (e) => {
  if (selected?.kind !== "building") return;
  const id = selected.id, v = (e.target as HTMLSelectElement).value as Building["shape"];
  applyEdit((l) => setShape(l, id, v));
});
$<HTMLInputElement>("selAngle").addEventListener("change", (e) => {
  if (selected?.kind !== "building") return;
  const id = selected.id, v = Number((e.target as HTMLInputElement).value);
  applyEdit((l) => setAngle(pctx!, l, id, v, rules()));
});
for (const [id, out] of [["selW", "selWOut"], ["selD", "selDOut"]] as const) {
  $<HTMLInputElement>(id).addEventListener("input", (e) => { $(out).textContent = `${(e.target as HTMLInputElement).value}m`; });
  $<HTMLInputElement>(id).addEventListener("change", () => {
    if (selected?.kind !== "building") return;
    const bid = selected.id, w = Number($<HTMLInputElement>("selW").value), d = Number($<HTMLInputElement>("selD").value);
    applyEdit((l) => resizeBuilding(pctx!, l, bid, w, d, rules()));
  });
}
$<HTMLInputElement>("selLabelHidden").addEventListener("change", (e) => {
  if (!selected) return;
  const p = selected, hidden = (e.target as HTMLInputElement).checked;
  applyEdit((l) => setLabel(l, p.kind, p.id, { hidden }));
});
$("selLabelReset").addEventListener("click", () => {
  if (!selected) return;
  const p = selected;
  applyEdit((l) => setLabel(l, p.kind, p.id, { reset: true }));
});

// ── 폼 이벤트 ────────────────────────────────────────────────────────
function confirmDiscard(): boolean {
  return !edited || window.confirm("시드·건물 수·병원 설정이나 건물 목록을 바꾸면 편집한 배치가 사라집니다. 계속할까요?");
}

$<HTMLFormElement>("controls").addEventListener("submit", (e) => {
  e.preventDefault();
  const next = readForm();
  if (layoutKey(next) !== layoutKey(options)) {
    if (!confirmDiscard()) { fillForm(options); return; }
    generate(next);
    return;
  }
  applyViewOptions(next);
});

/** 시드·건물 수·병원은 그대로이고 보기 설정이나 이름만 바뀐 경우: 편집을 유지한 채 반영한다. */
function applyViewOptions(next: Options): void {
  const prev = options;
  options = next;
  writeHash(next);
  if (next.name !== prev.name && layout) {
    const target = next.name || autoName(next.seed);
    if (target !== layout.name) applyEdit((l) => renameUniversity(l, target));
  }
  if (next.view !== prev.view || next.surround !== prev.surround) {
    ensureSite(next);
    view = identityView();
    syncZoomUi();
    rebuild();
  } else if (next.season !== prev.season || next.time !== prev.time) {
    repaintPalette();
  } else {
    draw();
  }
}

$<HTMLInputElement>("buildings").addEventListener("input", (e) => {
  $("buildingsOut").textContent = `${(e.target as HTMLInputElement).value}동`;
});
for (const id of ["season", "time", "view", "surround"]) {
  $(id).addEventListener("change", () => applyViewOptions(readForm()));
}
$<HTMLInputElement>("univName").addEventListener("change", () => applyViewOptions(readForm()));
$("random").addEventListener("click", () => {
  if (!confirmDiscard()) return;
  const words = ["봄", "별", "솔", "빛", "강", "숲", "들", "새", "달", "바람", "구름", "누리"];
  const seed = `${words[Math.floor(Math.random() * words.length)]}${Math.floor(Math.random() * 9000 + 1000)}`;
  generate({ ...readForm(), seed, name: "" });
});

for (const box of document.querySelectorAll<HTMLInputElement>("input[data-layer]")) {
  const key = box.dataset.layer as keyof Layers;
  box.checked = layers[key];
  box.addEventListener("change", () => {
    layers = { ...layers, [key]: box.checked };
    draw();
  });
}

$<HTMLInputElement>("editMode").addEventListener("change", (e) => setEditMode((e.target as HTMLInputElement).checked));
$<HTMLInputElement>("freePlace").addEventListener("change", (e) => {
  freePlace = (e.target as HTMLInputElement).checked;
  setStatus(freePlace
    ? "자유 배치: 캠퍼스 경계 안이면 건물·도로와 겹쳐도 그 자리에 놓습니다."
    : "겹치지 않게 놓습니다. 막힌 자리에 놓으면 가장 가까운 빈자리에 붙입니다.");
});
for (const r of document.querySelectorAll<HTMLInputElement>('input[name="tool"]')) {
  r.addEventListener("change", () => setTool(r.value as Tool));
}
$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);
$("resetLayout").addEventListener("click", () => {
  if (!edited || !window.confirm("편집한 배치를 버리고 시드 배치로 되돌릴까요?")) return;
  generate({ ...options, name: "" });
  setStatus("시드 배치로 되돌렸습니다.");
});

document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  // 글자를 넣는 칸·슬라이더에서는 원래 동작을 둔다.
  if (target.tagName === "TEXTAREA") return;
  if (target.tagName === "INPUT" && ["text", "number", "search", "range"].includes((target as HTMLInputElement).type)) return;
  const mod = e.ctrlKey || e.metaKey;
  if (selected && !mod && !e.altKey && target.tagName !== "SELECT" && e.key.startsWith("Arrow")) {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    const d: Record<string, [number, number]> = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
    const v = d[e.key];
    if (v) queueNudge(v[0], v[1]);
    return;
  }
  if (mod && e.key.toLowerCase() === "d" && selected?.kind === "building") {
    e.preventDefault();
    duplicateSelected();
    return;
  }
  if (e.key === " " && editMode && mapWrap.matches(":hover")) {
    e.preventDefault();
    spaceHeld = true;
    mapWrap.classList.add("pan-ready");
    return;
  }
  if (!mod && !e.altKey && target.tagName !== "SELECT") {
    if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.5); return; }
    if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomBy(1 / 1.5); return; }
    if (e.key === "0") { e.preventDefault(); setView(identityView()); return; }
    if (e.key === "Escape") { select(undefined); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); deleteSelected(); return; }
    if (e.key.toLowerCase() === "r" && selected?.kind === "building") { e.preventDefault(); rotateSelected(e.shiftKey ? -15 : 15); return; }
  }
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  } else if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redo();
  } else if (!mod && e.key.toLowerCase() === "e" && target.tagName !== "SELECT") {
    setEditMode(!editMode);
  }
});
document.addEventListener("keyup", (e) => {
  if (e.key !== " " || !spaceHeld) return;
  spaceHeld = false;
  mapWrap.classList.remove("pan-ready");
});
window.addEventListener("blur", () => {
  spaceHeld = false;
  mapWrap.classList.remove("pan-ready");
});

// ── 내보내기·불러오기 ───────────────────────────────────────────────
function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const safeFileName = (s: string): string => s.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40) || "campus";
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

$("exportPng").addEventListener("click", () => {
  if (!dl) return;
  // 보고 있는 화면과 관계없이 전체를 2배 해상도(3200×2400)로 저장한다.
  const out = document.createElement("canvas");
  out.width = W * 2;
  out.height = H * 2;
  paint(out.getContext("2d")!, dl, { scale: 1, x: 0, y: 0, ratio: 2, textScale: 1 }, layers, frame(), "all");
  out.toBlob((blob) => blob && download(`${safeFileName(layout?.name ?? options.seed)}_조감도.png`, blob), "image/png");
  // 라벨 클릭 판정이 내보내기용 배치로 덮이지 않게 화면을 다시 그린다.
  draw();
});
$("exportJson").addEventListener("click", () => {
  if (!layout) return;
  const file = toSavedFile({ ...options, program: programText || undefined }, layout);
  download(`${safeFileName(layout.name)}${edited ? "_편집" : ""}.json`, new Blob([JSON.stringify(file)], { type: "application/json" }));
});
$("importJson").addEventListener("click", () => $<HTMLInputElement>("importFile").click());
$<HTMLInputElement>("importFile").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  (async () => {
    if (file.size > MAX_IMPORT_BYTES) throw new Error("파일이 너무 큽니다 (5MB 이하만 불러올 수 있습니다).");
    const parsed = parseSavedFile(JSON.parse(await file.text()));
    const o = parsed.options;
    const next: Options = {
      seed: o.seed,
      name: "",
      buildings: Math.max(MIN_BUILDINGS, Math.min(MAX_BUILDINGS, o.buildings)),
      hospital: o.hospital,
      season: SEASONS.find((v) => v === o.season) ?? "spring",
      time: TIMES.find((v) => v === o.time) ?? "day",
      view: VIEWS.find((v) => v === o.view) ?? "mid",
      surround: SURROUNDS.find((v) => v === o.surround) ?? "forest",
    };
    setProgram(o.program ?? "");
    generate(next, parsed.layout);
    setStatus(`${file.name}${eul(file.name)} 불러왔습니다.${o.program ? " (건물 목록 포함)" : ""}`);
  })().catch((err) => setStatus(err instanceof Error ? err.message : String(err), true));
});
$("copyLink").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    setStatus(edited || programText
      ? "링크를 복사했습니다. 편집한 배치와 건물 목록은 링크에 담기지 않으니 함께 보내려면 'JSON 저장'을 쓰세요."
      : "현재 조감도 링크를 복사했습니다.");
  } catch {
    setStatus("클립보드에 접근할 수 없습니다. 주소창의 링크를 직접 복사하세요.", true);
  }
});

// ── 건물 목록·설정 글 ───────────────────────────────────────────────
const programInput = $<HTMLTextAreaElement>("programText");
const programReport = $("programReport");
const MAX_TEXT_FILE = 2 * 1024 * 1024;

/** 적용할 목록을 정한다 (빈 문자열이면 자동 배치). 읽을 수 없는 목록이면 자동 배치로 둔다. */
function setProgram(text: string): void {
  const t = text.slice(0, MAX_PROGRAM_TEXT);
  const parsed = t.trim() ? parseProgram(t) : undefined;
  if (parsed && parsed.program.items.length) {
    programText = t;
    program = parsed.program;
  } else {
    programText = "";
    program = undefined;
  }
  programInput.value = programText;
  siteKey = "";
}

function report(lines: string[], isError = false): void {
  programReport.replaceChildren(...lines.map((l) => {
    const p = document.createElement("span");
    p.textContent = l;
    return p;
  }));
  programReport.classList.toggle("error", isError);
}

/** 목록 모드면 목록 칸을 지금 배치에 맞춘다 (칸에 글을 쓰는 중이면 건드리지 않는다). */
const SYNC_HEADER = "지도에서 고친 내용이 반영된 목록입니다. 좌표가 붙은 줄은 그 자리에 고정됩니다.";
function syncProgramText(): void {
  if (!program || !layout || !site || !edited || document.activeElement === programInput) return;
  programInput.value = programToText(programFromLayout(layout, site, program), SYNC_HEADER);
}

function syncProgramUi(): void {
  const on = !!program;
  $<HTMLInputElement>("buildings").disabled = on;
  $<HTMLInputElement>("hospital").disabled = on;
  $("programState").textContent = on ? `목록 사용 중 · ${program!.items.filter((i) => !i.unlisted).length}개` : "자동 배치";
  $("programBox").classList.toggle("active", on);
  $<HTMLButtonElement>("programClear").disabled = !on;
  if (on && programWarnings.length) report(programWarnings.slice(0, 8));
}

$("programApply").addEventListener("click", () => {
  const text = programInput.value;
  const parsed = parseProgram(text);
  if (!parsed.program.items.length) {
    report(["건물이 한 줄도 없습니다. '이름 | 종류 | 층수 | 위치 | 외관' 형식으로 적거나 설정 글 파일을 불러오세요."], true);
    return;
  }
  if (!confirmDiscard()) return;
  setProgram(text);
  generate({ ...readForm() });
  const lines = [...parsed.warnings, ...programWarnings];
  const listed = parsed.program.items.filter((i) => !i.unlisted).length, extra = parsed.program.items.length - listed;
  const done = `시설 ${listed}개${extra ? `(번호 없는 ${extra}개 별도)` : ""}·상징물 ${parsed.program.landmarks.length}개로 만들었습니다.`;
  report([done, ...lines.slice(0, 10)]);
});
$("programFromMap").addEventListener("click", () => {
  if (!layout || !site) return;
  const p = program
    ? programFromLayout(layout, site, program)
    : programFromLayout(layout, site, undefined, { pinAll: true, site: { auto: true, buildings: options.buildings } });
  programInput.value = programToText(p, program ? SYNC_HEADER
    : "지금 지도의 배치를 옮긴 목록입니다. 모든 건물이 좌표로 고정되어 있습니다. 좌표 칸을 지우면 위치 묘사대로 다시 놓입니다.");
  ($("programBox") as HTMLDetailsElement).open = true;
  report([program
    ? "지금 배치를 목록 칸에 적었습니다."
    : `건물 ${p.items.length}개·상징물 ${p.landmarks.length}개를 목록 칸에 적었습니다. '이 목록으로 생성'을 누르면 같은 배치로 목록 모드가 됩니다.`]);
});
$("programClear").addEventListener("click", () => {
  if (!program || !confirmDiscard()) return;
  setProgram("");
  generate({ ...readForm() });
  report(["자동 배치로 돌아왔습니다. 적어 둔 목록은 지웠습니다."]);
});
$("programFile").addEventListener("click", () => $<HTMLInputElement>("programFileInput").click());
$<HTMLInputElement>("programFileInput").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  (async () => {
    if (file.size > MAX_TEXT_FILE) throw new Error("파일이 너무 큽니다 (2MB 이하만 읽습니다).");
    const text = await file.text();
    if (looksLikeProgram(text)) {
      programInput.value = text.slice(0, MAX_PROGRAM_TEXT);
      const parsed = parseProgram(programInput.value);
      report([`${file.name}에서 건물 ${parsed.program.items.length}개를 읽었습니다. '이 목록으로 생성'을 누르세요.`, ...parsed.warnings.slice(0, 6)]);
      return;
    }
    const r = extractFromProse(text);
    if (!r.program.items.length) {
      report(r.warnings.length ? r.warnings : ["글에서 시설을 찾지 못했습니다."], true);
      return;
    }
    programInput.value = programToText(r.program, `${file.name}에서 찾은 시설과 상징물입니다. 틀린 줄은 고쳐 쓴 뒤 '이 목록으로 생성'을 누르세요.`);
    report([
      `글에서 시설 ${r.found.items}개·상징물 ${r.found.landmarks}개를 찾았습니다. 내용을 확인하고 '이 목록으로 생성'을 누르세요.`,
      ...r.warnings.slice(0, 6),
    ]);
    ($("programBox") as HTMLDetailsElement).open = true;
  })().catch((err) => report([err instanceof Error ? err.message : String(err)], true));
});

// ── 시작 ─────────────────────────────────────────────────────────────
fillAddSelects();
fillInspectorSelects();
setTool("select");
setEditMode(false);
syncZoomUi();
const initial: Options = { ...DEFAULTS, ...readHash() };
fillForm(initial);
let resizeQueued = false;
const onResize = (): void => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    if (dl && syncBacking()) draw();
  });
};
new ResizeObserver(onResize).observe(canvas);
window.addEventListener("resize", onResize);
Promise.race([
  Promise.all([document.fonts.load('700 16px "Noto Sans KR"'), document.fonts.load('700 16px "Noto Serif KR"')]),
  new Promise((r) => setTimeout(r, 2500)),
]).catch(() => undefined).finally(() => {
  try {
    const savedProgram = localStorage.getItem(PROGRAM_KEY);
    if (savedProgram) setProgram(savedProgram);
  } catch {
    // 저장소를 쓸 수 없으면 자동 배치로 시작한다.
  }
  const saved = loadLayout(initial);
  generate(initial, saved);
  if (saved) setStatus("이 브라우저에 저장된 편집 배치를 불러왔습니다. '배치 초기화'로 되돌릴 수 있습니다.");
  document.documentElement.dataset.ready = "1";
});

