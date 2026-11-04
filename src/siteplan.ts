// 캠퍼스 배치도: 위에서 곧게 내려다본(정사영) 도면. 북쪽이 위, 축척 막대·방위표·좌표 격자·번호 목록이 있다.
// 조감도와 같은 배치(Scene)를 쓰며, TRPG 지도나 설정 자료처럼 거리·위치를 재는 용도다.

import { STYLE_KO } from "./catalog.ts";
import { localToWorld, type Poly, type Vec2 } from "./geom.ts";
import { isPlace, numberMap } from "./layout.ts";
import { planMasses } from "./model.ts";
import { drawSymbol } from "./paint.ts";
import type { Scene } from "./scene.ts";

export interface SitePlanOptions {
  width: number;
  height: number;
  /** 좌표 격자 간격 (m). 큰 칸마다 A·B·C…, 1·2·3… 이름을 붙인다. */
  grid: number;
  /** 큰 칸 = grid × major */
  major: number;
  trees: boolean;
}

export const SITEPLAN_DEFAULTS: SitePlanOptions = { width: 3600, height: 2400, grid: 10, major: 5, trees: true };

const INK = "#1b2a5c", DIM = "#3b6c9a", PAPER = "#fbfaf6", LAWN = "#e9f0df", ROAD = "#d9d9d6", ROAD_EDGE = "#9b9b98";
const PATH = "#e8dcc4", PLAZA = "#ece4d4", FIELD = "#cfe3b6", TRACK = "#d99a7a", PARK = "#dedfe3", TREE = "rgba(76,128,72,0.55)";
const FONT = '"Noto Sans KR", system-ui, sans-serif';

/** 열 이름: 0→A … 25→Z, 26→AA */
export const columnName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : columnName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

export interface PlanFrame { s: number; ox: number; oy: number; x0: number; y0: number; x1: number; y1: number }

/** 지도 영역(mw×mh px)에 캠퍼스 경계와 주변 여백이 들어가도록 맞춘다 */
export function sitePlanFrame(scene: Scene, mw: number, mh: number, pad = 70): PlanFrame {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of scene.site.boundary) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  // 정문 앞 간선도로까지
  y1 = Math.max(y1, scene.site.arterialY + 30);
  x0 -= 40; x1 += 40; y0 -= 40;
  const s = Math.min((mw - 2 * pad) / (x1 - x0), (mh - 2 * pad) / (y1 - y0));
  const ox = mw / 2 - ((x0 + x1) / 2) * s, oy = mh / 2 - ((y0 + y1) / 2) * s;
  return { s, ox, oy, x0, y0, x1, y1 };
}

export function drawSitePlan(ctx: CanvasRenderingContext2D, scene: Scene, o: SitePlanOptions = SITEPLAN_DEFAULTS): void {
  const { width: W, height: H } = o;
  const side = Math.round(W * 0.26);
  const mw = W - side, mh = H;
  const f = sitePlanFrame(scene, mw, mh);
  const { s } = f;
  const X = (x: number): number => f.ox + x * s, Y = (y: number): number => f.oy + y * s;
  const site = scene.site, layout = scene.layout;
  const poly = (p: readonly Vec2[] | Poly, close = true): void => {
    p.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(X(x), Y(y)) : ctx.lineTo(X(x), Y(y))));
    if (close) ctx.closePath();
  };

  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  ctx.beginPath();
  ctx.rect(0, 0, mw, mh);
  ctx.clip();

  // 캠퍼스 땅
  ctx.beginPath();
  poly(site.boundary);
  ctx.fillStyle = LAWN;
  ctx.fill();

  // 좌표 격자 (작은 칸은 옅게, 큰 칸은 진하게)
  const gx0 = Math.floor((0 - f.ox) / s / o.grid) * o.grid, gx1 = (mw - f.ox) / s;
  const gy0 = Math.floor((0 - f.oy) / s / o.grid) * o.grid, gy1 = (mh - f.oy) / s;
  const majorM = o.grid * o.major;
  for (const pass of [0, 1]) {
    ctx.beginPath();
    for (let x = gx0; x <= gx1; x += o.grid) {
      const isMajor = Math.abs(Math.round(x / majorM) * majorM - x) < 1e-6;
      if (isMajor !== (pass === 1)) continue;
      ctx.moveTo(Math.round(X(x)) + 0.5, 0); ctx.lineTo(Math.round(X(x)) + 0.5, mh);
    }
    for (let y = gy0; y <= gy1; y += o.grid) {
      const isMajor = Math.abs(Math.round(y / majorM) * majorM - y) < 1e-6;
      if (isMajor !== (pass === 1)) continue;
      ctx.moveTo(0, Math.round(Y(y)) + 0.5); ctx.lineTo(mw, Math.round(Y(y)) + 0.5);
    }
    ctx.strokeStyle = pass ? "rgba(59,108,154,0.32)" : "rgba(59,108,154,0.12)";
    ctx.lineWidth = pass ? 1.6 : 1;
    ctx.stroke();
  }

  // 도로: 바깥 테두리를 먼저 굵게, 그 위에 바탕
  const roads = [...site.roads, ...scene.streets];
  const ribbon = (kind: "edge" | "fill"): void => {
    for (const r of roads) {
      if (r.kind === "forest") continue;
      ctx.beginPath();
      poly(r.pts, !!r.closed);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      const path = r.kind === "path";
      ctx.lineWidth = r.width * s + (kind === "edge" ? 3 : 0);
      ctx.strokeStyle = kind === "edge" ? (path ? "#c9b998" : ROAD_EDGE) : path ? PATH : ROAD;
      ctx.stroke();
    }
  };
  ribbon("edge");
  ribbon("fill");
  // 차선 가운데 점선 (간선·순환도로)
  ctx.setLineDash([10, 10]);
  for (const r of site.roads) {
    if (r.kind !== "arterial" && r.kind !== "ring") continue;
    ctx.beginPath();
    poly(r.pts, !!r.closed);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 포장 마당·산책로·주차장
  ctx.fillStyle = PATH;
  for (const a of scene.aprons) { ctx.beginPath(); poly(a); ctx.fill(); }
  ctx.strokeStyle = PATH;
  ctx.lineCap = "round";
  ctx.lineWidth = 3.2 * s;
  for (const w of scene.walkways) { ctx.beginPath(); poly(w, false); ctx.stroke(); }
  for (const p of scene.parkings) {
    const c = rectFrom(p.x, p.y, p.w, p.d, p.angle);
    ctx.beginPath(); poly(c); ctx.fillStyle = PARK; ctx.fill();
    ctx.strokeStyle = ROAD_EDGE; ctx.lineWidth = 1; ctx.stroke();
    // 주차 칸 선
    ctx.beginPath();
    const long = p.w >= p.d;
    const n = Math.floor((long ? p.w : p.d) / 2.6);
    for (let k = 1; k < n; k++) {
      const t = -0.5 + k / n;
      const a = long ? localToWorld(p.x, p.y, p.angle, t * p.w, -p.d / 2) : localToWorld(p.x, p.y, p.angle, -p.w / 2, t * p.d);
      const b = long ? localToWorld(p.x, p.y, p.angle, t * p.w, -p.d * 0.1) : localToWorld(p.x, p.y, p.angle, -p.w * 0.1, t * p.d);
      ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1]));
    }
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.stroke();
  }

  // 광장·운동장
  for (const b of layout.buildings) {
    if (!isPlace(b)) continue;
    const c = rectFrom(b.x, b.y, b.w, b.d, b.angle);
    ctx.beginPath(); poly(c);
    ctx.fillStyle = b.shape === "field" ? FIELD : PLAZA;
    ctx.fill();
    ctx.strokeStyle = b.shape === "field" ? "#8fb872" : "#cbbd9f";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (b.shape === "field") {
      // 트랙
      ctx.save();
      ctx.translate(X(b.x), Y(b.y));
      ctx.rotate(b.angle);
      const rw = (b.w * 0.92 * s) / 2, rh = (b.d * 0.8 * s) / 2;
      ctx.beginPath();
      const rr = Math.min(rw, rh);
      ctx.roundRect(-rw, -rh, rw * 2, rh * 2, rr);
      ctx.lineWidth = Math.max(3, 7 * s);
      ctx.strokeStyle = TRACK;
      ctx.stroke();
      ctx.restore();
    }
  }

  // 나무
  if (o.trees) {
    ctx.fillStyle = TREE;
    ctx.beginPath();
    for (const t of scene.trees) {
      const x = X(t.x), y = Y(t.y);
      if (x < -10 || y < -10 || x > mw + 10 || y > mh + 10) continue;
      const r = Math.max(1.2, t.r * s * 0.9);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  // 캠퍼스 경계선 (일점쇄선)
  ctx.beginPath();
  poly(site.boundary);
  ctx.setLineDash([18, 6, 3, 6]);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  // 건물: 덩어리마다 층수 농도, 윗덩어리는 점선
  const numbers = numberMap(layout.buildings);
  const maxF = Math.max(1, ...layout.buildings.filter((b) => !isPlace(b)).map((b) => b.floors));
  const tint = (fl: number): string => {
    const t = Math.min(1, fl / maxF);
    const lo = [226, 232, 241], hi = [120, 146, 182];
    return `rgb(${lo.map((v, i) => Math.round(v + (hi[i] - v) * t)).join(",")})`;
  };
  for (const b of layout.buildings) {
    if (isPlace(b)) continue;
    const ms = planMasses(b).sort((p, q) => p.z0 - q.z0 || p.z1 - q.z1);
    const toW = (p: Vec2): Vec2 => localToWorld(b.x, b.y, b.angle, p[0], p[1]);
    for (const m of ms) {
      ctx.beginPath();
      poly(m.outer.map(toW));
      for (const h of m.holes) poly(h.map(toW));
      ctx.fillStyle = m.glass ? "#cfe6ee" : tint(m.floors);
      ctx.fill("evenodd");
    }
    for (const m of ms) {
      ctx.beginPath();
      poly(m.outer.map(toW));
      for (const h of m.holes) poly(h.map(toW));
      ctx.strokeStyle = INK;
      ctx.lineWidth = m.z0 === 0 ? 2.4 : 1.2;
      if (m.z0 > 0) ctx.setLineDash([7, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 정면 출입구 표시
    const door = localToWorld(b.x, b.y, b.angle, 0, b.d / 2 + 1.5);
    ctx.beginPath();
    ctx.arc(X(door[0]), Y(door[1]), 3, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
  }

  // 상징물
  for (const m of layout.landmarks) drawSymbol(ctx, m.kind, X(m.x), Y(m.y), 11);

  // 번호·이름
  const badge = (x: number, y: number, no: number): void => {
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${no >= 10 ? 14 : 16}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(no), x, y + 1);
  };
  const tag = (x: number, y: number, text: string, size = 14): void => {
    ctx.font = `600 ${size}px ${FONT}`;
    const tw = ctx.measureText(text).width + 10;
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillRect(x - tw / 2, y - size * 0.75, tw, size * 1.5);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 0.5);
  };
  for (const b of layout.buildings) {
    const no = numbers.get(b.id);
    if (no !== undefined) badge(X(b.x), Y(b.y), no);
    else tag(X(b.x), Y(b.y), b.name);
  }
  for (const m of layout.landmarks) tag(X(m.x), Y(m.y) + 24, m.name, 12.5);
  tag(X(site.gateS[0]), Y(site.gateS[1]) + 4, "정문", 15);
  tag(X(site.gateN[0]), Y(site.gateN[1]) - 4, "후문", 15);

  // 격자 이름 (위·왼쪽 가장자리)
  ctx.font = `700 15px ${FONT}`;
  ctx.fillStyle = DIM;
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  const colStart = Math.floor(f.x0 / majorM), rowStart = Math.floor(f.y0 / majorM);
  for (let x = Math.floor((0 - f.ox) / s / majorM) * majorM; x < gx1; x += majorM) {
    const i = Math.round(x / majorM) - colStart;
    const cx = X(x + majorM / 2);
    if (i < 0 || cx < 12 || cx > mw - 12) continue;
    ctx.fillText(columnName(i), cx, 8);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (let y = Math.floor((0 - f.oy) / s / majorM) * majorM; y < gy1; y += majorM) {
    const j = Math.round(y / majorM) - rowStart;
    const cy = Y(y + majorM / 2);
    if (j < 0 || cy < 30 || cy > mh - 12) continue;
    ctx.fillText(String(j + 1), 8, cy);
  }

  // 방위표·축척 막대 (지도 오른쪽 아래)
  const nx = mw - 70, ny = mh - 150;
  ctx.beginPath(); ctx.arc(nx, ny, 34, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(nx, ny - 30); ctx.lineTo(nx + 11, ny + 14); ctx.lineTo(nx, ny + 6); ctx.lineTo(nx - 11, ny + 14); ctx.closePath();
  ctx.fillStyle = INK; ctx.fill();
  ctx.font = `700 18px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText("N", nx, ny - 36);
  const lens = [10, 20, 25, 50, 100, 200, 250, 500];
  const len = lens.find((m) => m * s >= 180) ?? 500;
  const bx = mw - 40 - len * s, by = mh - 50;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(bx - 12, by - 40, len * s + 24, 62);
  for (let k = 0; k < 4; k++) {
    ctx.fillStyle = k % 2 ? "#fff" : INK;
    ctx.fillRect(bx + (k * len * s) / 4, by - 6, (len * s) / 4, 10);
  }
  ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by - 6, len * s, 10);
  ctx.fillStyle = INK; ctx.font = `600 14px ${FONT}`; ctx.textBaseline = "bottom";
  ctx.textAlign = "left"; ctx.fillText("0", bx, by - 10);
  ctx.textAlign = "right"; ctx.fillText(`${len} m`, bx + len * s, by - 10);
  ctx.textAlign = "center"; ctx.fillText(`격자 ${o.grid} m · 큰 칸 ${majorM} m`, bx + (len * s) / 2, by + 26);
  ctx.restore();

  drawSidePanel(ctx, scene, mw, side, H, o);
}

function rectFrom(cx: number, cy: number, w: number, d: number, a: number): Vec2[] {
  return [localToWorld(cx, cy, a, -w / 2, -d / 2), localToWorld(cx, cy, a, w / 2, -d / 2), localToWorld(cx, cy, a, w / 2, d / 2), localToWorld(cx, cy, a, -w / 2, d / 2)];
}

/** 오른쪽 표제란: 도면 이름, 번호 목록(층수·외관), 상징물, 범례 */
function drawSidePanel(ctx: CanvasRenderingContext2D, scene: Scene, x0: number, w: number, H: number, o: SitePlanOptions): void {
  const layout = scene.layout;
  const pad = 36;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x0, 0, w, H);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  ctx.strokeRect(x0 + 10, 10, w - 20, H - 20);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0 + 18, 18, w - 36, H - 36);
  let y = 60;
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 40px "Noto Serif KR", serif`;
  ctx.fillText(layout.name, x0 + pad, y + 20);
  y += 60;
  ctx.font = `500 24px ${FONT}`;
  ctx.fillStyle = DIM;
  ctx.fillText("캠퍼스 배치도 · 단위 m · 북쪽이 위", x0 + pad, y);
  y += 26;
  ctx.fillRect(x0 + pad, y, w - pad * 2, 3);
  y += 40;

  // 번호 목록
  const numbers = numberMap(layout.buildings);
  const rows = layout.buildings.filter((b) => numbers.has(b.id)).sort((a, b) => numbers.get(a.id)! - numbers.get(b.id)!);
  const colW = (w - pad * 2) / 1;
  const lineH = Math.min(40, Math.max(26, (H - y - 520) / Math.max(1, rows.length)));
  ctx.font = `700 ${Math.round(lineH * 0.55)}px ${FONT}`;
  for (const b of rows) {
    const no = numbers.get(b.id)!;
    const cy = y + lineH / 2;
    ctx.beginPath();
    ctx.arc(x0 + pad + lineH * 0.42, cy, lineH * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(lineH * (no >= 10 ? 0.4 : 0.46))}px ${FONT}`;
    ctx.fillText(String(no), x0 + pad + lineH * 0.42, cy + 1);
    ctx.textAlign = "left";
    ctx.fillStyle = INK;
    ctx.font = `600 ${Math.round(lineH * 0.5)}px ${FONT}`;
    ctx.fillText(b.name, x0 + pad + lineH, cy);
    ctx.textAlign = "right";
    ctx.fillStyle = DIM;
    ctx.font = `500 ${Math.round(lineH * 0.42)}px ${FONT}`;
    ctx.fillText(isPlace(b) ? `${Math.round(b.w)}×${Math.round(b.d)}` : `${b.floors}층 · ${STYLE_KO[b.style]}`, x0 + pad + colW, cy);
    y += lineH;
  }
  y += 30;
  // 상징물
  if (layout.landmarks.length) {
    ctx.fillStyle = INK;
    ctx.fillRect(x0 + pad, y, w - pad * 2, 2);
    y += 34;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText("상징물", x0 + pad, y);
    y += 34;
    const half = (w - pad * 2) / 2;
    layout.landmarks.forEach((m, k) => {
      const cx = x0 + pad + (k % 2) * half, cy = y + Math.floor(k / 2) * 34;
      drawSymbol(ctx, m.kind, cx + 11, cy, 10);
      ctx.fillStyle = INK;
      ctx.font = `500 19px ${FONT}`;
      ctx.textAlign = "left";
      ctx.fillText(m.name, cx + 30, cy);
    });
    y += Math.ceil(layout.landmarks.length / 2) * 34 + 20;
  }
  // 범례
  const ly = H - 210;
  ctx.fillStyle = INK;
  ctx.fillRect(x0 + pad, ly, w - pad * 2, 2);
  ctx.font = `500 19px ${FONT}`;
  ctx.textBaseline = "middle";
  const items: [string, (cx: number, cy: number) => void][] = [
    ["건물 (진할수록 높음)", (cx, cy) => { ctx.fillStyle = "rgb(160,180,205)"; ctx.fillRect(cx - 14, cy - 10, 28, 20); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(cx - 14, cy - 10, 28, 20); }],
    ["윗층 윤곽", (cx, cy) => { ctx.setLineDash([7, 4]); ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.strokeRect(cx - 14, cy - 10, 28, 20); ctx.setLineDash([]); }],
    ["캠퍼스 경계", (cx, cy) => { ctx.setLineDash([12, 4, 3, 4]); ctx.beginPath(); ctx.moveTo(cx - 16, cy); ctx.lineTo(cx + 16, cy); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); }],
    ["도로 · 산책로", (cx, cy) => { ctx.fillStyle = ROAD; ctx.fillRect(cx - 16, cy - 7, 16, 14); ctx.fillStyle = PATH; ctx.fillRect(cx, cy - 7, 16, 14); }],
    ["출입구", (cx, cy) => { ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill(); }],
    [`격자 ${o.grid} m (큰 칸 ${o.grid * o.major} m, 열 A·B… 행 1·2…)`, (cx, cy) => { ctx.strokeStyle = "rgba(59,108,154,0.5)"; ctx.lineWidth = 1; ctx.strokeRect(cx - 14, cy - 10, 28, 20); ctx.beginPath(); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10); ctx.moveTo(cx - 14, cy); ctx.lineTo(cx + 14, cy); ctx.stroke(); }],
  ];
  items.forEach(([label, icon], k) => {
    const cy = ly + 30 + k * 28;
    icon(x0 + pad + 18, cy);
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    ctx.font = `500 18px ${FONT}`;
    ctx.fillText(label, x0 + pad + 46, cy);
  });
  ctx.restore();
}

/** 좌표 → 격자 칸 이름 (예: "C4"). 배치도의 격자와 같은 기준 (캠퍼스 경계 왼쪽 위에서 센다). */
export function gridCell(scene: Pick<Scene, "site">, x: number, y: number, o: Pick<SitePlanOptions, "grid" | "major"> = SITEPLAN_DEFAULTS): string {
  const { x0, y0 } = planOrigin(scene);
  const majorM = o.grid * o.major;
  const i = Math.floor(x / majorM) - Math.floor(x0 / majorM);
  const j = Math.floor(y / majorM) - Math.floor(y0 / majorM);
  return `${columnName(Math.max(0, i))}${Math.max(0, j) + 1}`;
}

/** 격자를 세기 시작하는 곳 (경계 상자 왼쪽 위에서 40 m 바깥) */
export function planOrigin(scene: Pick<Scene, "site">): { x0: number; y0: number } {
  let x0 = Infinity, y0 = Infinity;
  for (const [x, y] of scene.site.boundary) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); }
  return { x0: x0 - 40, y0: y0 - 40 };
}
