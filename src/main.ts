import { type Camera, fitCamera, project, unproject, type ViewAngle, VIEW_KO } from "./camera.ts";
import { BUILDING_TYPES, buildingType, LANDMARK_KINDS, LANDMARKS, PLACE_TYPES, STYLE_KO, type LandmarkKind } from "./catalog.ts";
import { buildDrawList, computeForest, type DrawList, type Forest } from "./drawlist.ts";
import {
  addBuilding, addLandmark, cloneLayout, deleteBuilding, deleteLandmark, EditHistory, type EditResult, findBuilding, findLandmark,
  layoutFromJSON, moveBuilding, moveLandmark, parseSavedFile, renameBuilding, renameLandmark, renameUniversity, rotateBuilding,
  setFloors, toSavedFile,
} from "./edit.ts";
import { pointInPolygon, rectCorners, type Vec2 } from "./geom.ts";
import {
  autoName, checkPlacement, generateLayout, isPlace, placementContext, type Layout, type PlacementContext,
} from "./layout.ts";
import { FLOOR_H } from "./model.ts";
import { englishName, eul } from "./names.ts";
import { makePalette, SEASON_KO, TIME_KO, type Season, type TimeOfDay } from "./palette.ts";
import { DEFAULT_LAYERS, LANDMARK_DESC, labelHits, type Layers, paint, type PaintView } from "./paint.ts";
import { deriveScene, makeSurroundings, type Scene, type Surround, type Surroundings, SURROUND_KO } from "./scene.ts";
import { generateSite, type Site } from "./site.ts";
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
  select: "건물·상징물을 눌러 고르고, 끌어서 옮깁니다. 고른 건물은 R로 돌리고 Delete로 지웁니다.",
  addBuilding: "고른 종류의 건물을 누른 자리에 놓습니다. 정면이 남쪽(화면 아래)을 보게 놓고, 자리가 안 맞으면 돌려 봅니다.",
  addLandmark: "고른 상징물을 누른 자리에 놓습니다.",
  erase: "누른 건물·상징물을 지웁니다. 건물을 지우면 뒤 번호가 하나씩 당겨집니다.",
};
let editMode = false;
let tool: Tool = "select";

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
const layoutKey = (o: Options): string => `${o.seed}|${o.buildings}|${o.hospital ? 1 : 0}`;

function ensureSite(o: Options): void {
  const sk = `${o.seed}|${o.buildings}`;
  if (sk !== siteKey || !site) {
    site = generateSite(o.seed, o.buildings);
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
  layout = saved ?? generateLayout(site!, { seed: o.seed, buildings: o.buildings, hospital: o.hospital, name: o.name });
  edited = !!saved;
  if (!saved && o.name) layout.name = renameTo(layout, o.name);
  history.clear();
  selected = hovered = undefined;
  view = identityView();
  syncZoomUi();
  syncBacking();
  canvas.style.aspectRatio = overlay.style.aspectRatio = `${W} / ${H}`;
  rebuild();
  saveLayout();
  setStatus(`${layout.name} · 건물 ${layout.buildings.filter((b) => !isPlace(b)).length}동 · ${SEASON_KO[o.season]} ${TIME_KO[o.time]} · 시점 ${VIEW_KO[o.view]} · 주변 ${SURROUND_KO[o.surround]}`);
}

function renameTo(l: Layout, name: string): string {
  renameUniversity(l, name);
  return l.name;
}

// ── 편집 공통 ────────────────────────────────────────────────────────
function applyEdit(edit: (l: Layout) => EditResult): boolean {
  if (!layout) return false;
  const before = cloneLayout(layout);
  const res = edit(layout);
  if (!res.ok) {
    setStatus(res.message, true);
    return false;
  }
  history.record(before);
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
function toGround(px: number, py: number): Vec2 | undefined {
  if (!cam) return undefined;
  const [ix, iy] = toMap(view, px, py);
  return unproject(cam, ix, iy);
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
  selected = p;
  syncInspector();
  renderLegendList();
  showInfo(p);
  drawOverlay();
}

// ── 오버레이 (선택·강조·끌기 미리보기) ───────────────────────────────
let dragGhost: { kind: "building" | "landmark"; id: number; x: number; y: number; valid: boolean } | undefined;

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
    const color = dragGhost.valid ? "rgba(60,200,120,0.95)" : "rgba(230,60,60,0.95)";
    if (dragGhost.kind === "building") {
      const b = findBuilding(layout, dragGhost.id);
      if (b) {
        const poly = rectCorners(dragGhost.x, dragGhost.y, b.w, b.d, b.angle);
        const hgt = isPlace(b) ? 0.5 : Math.max(4, b.floors * FLOOR_H);
        const P = (p: Vec2, z: number): [number, number] => { const q = project(cam!, p[0], p[1], z); return [q[0], q[1]]; };
        octx!.beginPath();
        for (const z of [0, hgt]) {
          poly.forEach((p, i) => { const [x, y] = P(p, z); if (i === 0) octx!.moveTo(x, y); else octx!.lineTo(x, y); });
          octx!.closePath();
        }
        for (const p of poly) { const a = P(p, 0), c = P(p, hgt); octx!.moveTo(a[0], a[1]); octx!.lineTo(c[0], c[1]); }
        octx!.lineWidth = 2 * lw;
        octx!.strokeStyle = color;
        octx!.stroke();
        octx!.fillStyle = dragGhost.valid ? "rgba(60,200,120,0.18)" : "rgba(230,60,60,0.18)";
        octx!.beginPath();
        poly.forEach((p, i) => { const [x, y] = P(p, 0); if (i === 0) octx!.moveTo(x, y); else octx!.lineTo(x, y); });
        octx!.fill();
      }
    } else {
      const q = project(cam, dragGhost.x, dragGhost.y, 0);
      octx!.beginPath();
      octx!.arc(q[0], q[1], 8 * lw * 1.5, 0, Math.PI * 2);
      octx!.lineWidth = 2.5 * lw;
      octx!.strokeStyle = color;
      octx!.stroke();
    }
  }
}

// ── 정보 창 ──────────────────────────────────────────────────────────
function showInfo(p: Pick | undefined): void {
  const rows: [string, string][] = [];
  if (!p || !layout) {
    rows.push(["안내", "건물에 마우스를 올리거나 눌러 보세요."]);
  } else if (p.kind === "building") {
    const b = findBuilding(layout, p.id);
    if (b) {
      const no = layout.buildings.indexOf(b) + 1;
      const t = buildingType(b.type);
      rows.push(["번호", `${no}번`], ["이름", b.name]);
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
  el.replaceChildren(...layout.buildings.map((b, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const no = document.createElement("b");
    no.textContent = String(i + 1);
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
  if (!layout || !selected) { box.hidden = true; return; }
  const b = selected.kind === "building" ? findBuilding(layout, selected.id) : undefined;
  const m = selected.kind === "landmark" ? findLandmark(layout, selected.id) : undefined;
  if (!b && !m) { box.hidden = true; return; }
  box.hidden = false;
  const name = b ? b.name : m!.name;
  $("inspectorTitle").textContent = b ? `${layout.buildings.indexOf(b) + 1}번 ${b.name}` : `상징물 · ${m!.name}`;
  const input = $<HTMLInputElement>("selName");
  if (document.activeElement !== input) input.value = name;
  const floorsField = $("selFloorsField");
  floorsField.hidden = !b || isPlace(b);
  if (b && !isPlace(b)) {
    $<HTMLInputElement>("selFloors").value = String(b.floors);
    $("selFloorsOut").textContent = `${b.floors}층`;
  }
  $("selRotateRow").hidden = !b;
  $("selZoom").hidden = !b;
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
  $("addTypeField").hidden = tool !== "addBuilding";
  $("addLandmarkField").hidden = tool !== "addLandmark";
  $("toolHint").textContent = editMode ? TOOL_HINTS[tool] : "편집 모드를 켜면 지도에서 건물을 옮기거나 추가·삭제할 수 있습니다.";
  mapWrap.classList.toggle("add-tool", editMode && (tool === "addBuilding" || tool === "addLandmark"));
  mapWrap.classList.toggle("erase-tool", editMode && tool === "erase");
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
let pan: { id: number; last: [number, number]; start: [number, number]; moved: boolean; button: number } | null = null;
let pinch: { mx: number; my: number; dist: number; scale: number } | null = null;
let gestureLock = false;
let spaceHeld = false;
let drag: { pick: Pick; id: number; offset: Vec2; start: [number, number]; moved: boolean } | null = null;

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
  if (!wantsPan && e.button === 0 && editMode) {
    onEditDown(e, px);
    return;
  }
  e.preventDefault();
  pan = { id: e.pointerId, last: px, start: px, moved: false, button: e.button };
  capturePointer(e.pointerId);
});

function onEditDown(e: PointerEvent, px: [number, number]): void {
  if (!layout) return;
  const g = toGround(...px);
  if (tool === "select") {
    const p = pickAt(...px);
    select(p);
    if (!p || !g) return;
    const obj = p.kind === "building" ? findBuilding(layout, p.id) : findLandmark(layout, p.id);
    if (!obj) return;
    e.preventDefault();
    drag = { pick: p, id: p.id, offset: [obj.x - g[0], obj.y - g[1]], start: px, moved: false };
    capturePointer(e.pointerId);
  } else if (tool === "erase") {
    const p = pickAt(...px);
    if (!p) { setStatus("지울 건물·상징물을 누르세요.", true); return; }
    if (applyEdit((l) => p.kind === "building" ? deleteBuilding(l, p.id) : deleteLandmark(l, p.id))) select(undefined);
  } else if (tool === "addBuilding") {
    if (!g) return;
    const type = $<HTMLSelectElement>("addType").value;
    let newId: number | undefined;
    if (applyEdit((l) => { const r = addBuilding(pctx!, l, type, g[0], g[1]); newId = r.id; return r; }) && newId) {
      select({ kind: "building", id: newId });
    }
  } else if (tool === "addLandmark") {
    if (!g) return;
    const kind = $<HTMLSelectElement>("addLandmarkKind").value as LandmarkKind;
    let newId: number | undefined;
    if (applyEdit((l) => { const r = addLandmark(pctx!, l, kind, g[0], g[1]); newId = r.id; return r; }) && newId) {
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
    const g = toGround(...px);
    if (!g) return;
    const x = g[0] + drag.offset[0], y = g[1] + drag.offset[1];
    let valid = true;
    if (drag.pick.kind === "building") {
      const b = findBuilding(layout, drag.id);
      if (b) valid = !checkPlacement(pctx, layout.buildings, { ...b, x, y }, b.id);
    }
    dragGhost = { kind: drag.pick.kind, id: drag.id, x, y, valid };
    drawOverlay();
    return;
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
    pan = null;
    mapWrap.classList.remove("panning");
    if (clicked) select(pickAt(...canvasPx(e)));
    return;
  }
  if (drag) {
    const d = drag;
    drag = null;
    mapWrap.classList.remove("dragging");
    const ghost = dragGhost;
    dragGhost = undefined;
    if (d.moved && ghost && e.type === "pointerup") {
      applyEdit((l) => d.pick.kind === "building" ? moveBuilding(pctx!, l, d.id, ghost.x, ghost.y) : moveLandmark(pctx!, l, d.id, ghost.x, ghost.y));
    }
    drawOverlay();
  }
}
canvas.addEventListener("pointerup", onPointerEnd);
canvas.addEventListener("pointercancel", onPointerEnd);
canvas.addEventListener("pointerleave", () => {
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
  applyEdit((l) => rotateBuilding(pctx!, l, id, (deg * Math.PI) / 180));
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

// ── 폼 이벤트 ────────────────────────────────────────────────────────
function confirmDiscard(): boolean {
  return !edited || window.confirm("시드·건물 수·병원 설정을 바꾸면 편집한 배치가 사라집니다. 계속할까요?");
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
  if (target.tagName === "INPUT" && (target as HTMLInputElement).type === "text") return;
  const mod = e.ctrlKey || e.metaKey;
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
  const file = toSavedFile({ ...options }, layout);
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
    generate(next, parsed.layout);
    setStatus(`${file.name}${eul(file.name)} 불러왔습니다.`);
  })().catch((err) => setStatus(err instanceof Error ? err.message : String(err), true));
});
$("copyLink").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    setStatus(edited
      ? "링크를 복사했습니다. 편집한 배치는 링크에 담기지 않으니 함께 보내려면 'JSON 저장'을 쓰세요."
      : "현재 조감도 링크를 복사했습니다.");
  } catch {
    setStatus("클립보드에 접근할 수 없습니다. 주소창의 링크를 직접 복사하세요.", true);
  }
});

// ── 시작 ─────────────────────────────────────────────────────────────
fillAddSelects();
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
  const saved = loadLayout(initial);
  generate(initial, saved);
  if (saved) setStatus("이 브라우저에 저장된 편집 배치를 불러왔습니다. '배치 초기화'로 되돌릴 수 있습니다.");
  document.documentElement.dataset.ready = "1";
});

