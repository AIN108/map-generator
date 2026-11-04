// 그리기 목록을 Canvas 2D에 칠한다. 라벨·제목·범례는 확대해도 화면에서 같은 크기로 그린다.

import { isVector } from "./svg.ts";
import { LANDMARKS, type LandmarkKind } from "./catalog.ts";
import type { Cmd, DrawList, PointAnchor } from "./drawlist.ts";

export interface Layers {
  title: boolean;
  legend: boolean;
  labels: boolean;
  landmarks: boolean;
  notes: boolean;
}

export const DEFAULT_LAYERS: Layers = { title: true, legend: true, labels: true, landmarks: true, notes: true };

export interface PaintView {
  /** 확대 배율 */
  scale: number;
  /** 화면 왼쪽 위에 보이는 이미지 좌표 */
  x: number;
  y: number;
  /** 이미지 픽셀 → 캔버스 픽셀 배율 (devicePixelRatio·표시 크기 반영) */
  ratio: number;
  /** 좁은 화면에서 글자를 키우는 배율 */
  textScale: number;
}

export interface FrameInfo {
  name: string;
  nameEn: string;
}

export type PaintPart = "all" | "base" | "labels";

const NAVY = "#1b2a5c";
const GOLD = "#c9a75a";

export function paint(
  ctx: CanvasRenderingContext2D, dl: DrawList, v: PaintView, layers: Layers, frame: FrameInfo, part: PaintPart = "all",
): void {
  if (part !== "labels") {
    ctx.save();
    ctx.setTransform(v.scale * v.ratio, 0, 0, v.scale * v.ratio, -v.x * v.scale * v.ratio, -v.y * v.scale * v.ratio);
    paintCmds(ctx, dl);
    ctx.restore();
  }
  if (part !== "base") {
    ctx.save();
    ctx.setTransform(v.ratio, 0, 0, v.ratio, 0, 0);
    drawOverlayText(ctx, dl, v, layers, frame);
    ctx.restore();
  }
}

function tracePath(ctx: CanvasRenderingContext2D, a: Float32Array, close: boolean): void {
  if (a.length < 4) return;
  ctx.moveTo(a[0], a[1]);
  for (let i = 2; i < a.length; i += 2) ctx.lineTo(a[i], a[i + 1]);
  if (close) ctx.closePath();
}

export function paintCmds(ctx: CanvasRenderingContext2D, dl: DrawList): void {
  ctx.lineJoin = "round";
  for (const c of dl.cmds) paintCmd(ctx, dl, c);
}

function paintCmd(ctx: CanvasRenderingContext2D, dl: DrawList, c: Cmd): void {
  switch (c.k) {
    case "fill": {
      ctx.beginPath();
      for (const p of c.paths) tracePath(ctx, p, true);
      ctx.fillStyle = c.fill;
      ctx.fill(c.evenodd ? "evenodd" : "nonzero");
      if (c.stroke) {
        ctx.strokeStyle = c.stroke;
        ctx.lineWidth = c.lw ?? 0.5;
        ctx.stroke();
      }
      break;
    }
    case "line": {
      ctx.beginPath();
      for (const p of c.paths) tracePath(ctx, p, false);
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = c.lw;
      ctx.lineCap = c.cap ?? "butt";
      ctx.setLineDash(c.dash ?? []);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = "butt";
      break;
    }
    case "ellipses": {
      ctx.beginPath();
      const d = c.data;
      for (let i = 0; i < d.length; i += 4) {
        ctx.moveTo(d[i] + d[i + 2], d[i + 1]);
        ctx.ellipse(d[i], d[i + 1], d[i + 2], d[i + 3], 0, 0, Math.PI * 2);
      }
      ctx.fillStyle = c.fill;
      ctx.fill();
      break;
    }
    case "trees":
      paintTrees(ctx, dl, c.data, c.n);
      break;
    case "sky": {
      const g = ctx.createLinearGradient(0, Math.min(0, c.y - 400), 0, c.y);
      g.addColorStop(0, c.top);
      g.addColorStop(1, c.bottom);
      ctx.fillStyle = g;
      ctx.fillRect(-10, -10, dl.width + 20, c.y + 12);
      break;
    }
    case "haze": {
      const g = ctx.createLinearGradient(0, 0, 0, c.to);
      g.addColorStop(0, withAlpha(c.color, dl.palette.time === "night" ? 0.25 : 0.4));
      g.addColorStop(1, withAlpha(c.color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-10, -10, dl.width + 20, c.to + 10);
      break;
    }
    case "glow": {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const d = c.data;
      for (let i = 0; i < d.length; i += 3) {
        const g = ctx.createRadialGradient(d[i], d[i + 1], 0, d[i], d[i + 1], d[i + 2]);
        g.addColorStop(0, `rgba(${c.color},0.55)`);
        g.addColorStop(0.25, `rgba(${c.color},0.22)`);
        g.addColorStop(1, `rgba(${c.color},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(d[i] - d[i + 2], d[i + 1] - d[i + 2], d[i + 2] * 2, d[i + 2] * 2);
      }
      ctx.restore();
      break;
    }
    case "globe": {
      const g = ctx.createRadialGradient(c.x - c.r * 0.35, c.y - c.r * 0.4, c.r * 0.1, c.x, c.y, c.r);
      const night = dl.palette.time === "night";
      g.addColorStop(0, night ? "#6a7da0" : "#d9ecff");
      g.addColorStop(0.55, night ? "#2c3d66" : "#5b8fc8");
      g.addColorStop(1, night ? "#141d36" : "#28508a");
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = night ? "rgba(200,210,230,0.35)" : "rgba(240,248,255,0.7)";
      ctx.lineWidth = Math.max(0.3, c.r * 0.06);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.r * 0.45, c.r, 0, 0, Math.PI * 2);
      ctx.moveTo(c.x - c.r, c.y);
      ctx.lineTo(c.x + c.r, c.y);
      ctx.moveTo(c.x + c.r * 0.92, c.y - c.r * 0.4);
      ctx.ellipse(c.x, c.y - c.r * 0.4, c.r * 0.92, c.r * 0.12, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
  }
}

function withAlpha(rgb: string, a: number): string {
  const m = /rgba?\((\d+),(\d+),(\d+)/.exec(rgb);
  return m ? `rgba(${m[1]},${m[2]},${m[3]},${a})` : rgb;
}

/**
 * 나무 묶음 (최대 64그루, 깊이순). 같은 색끼리 경로 하나로 칠해 호출 수를 줄인다.
 * 한 묶음 안에서는 층(그늘 → 기본 → 밝은 면) 순서로 칠하므로 아주 가까운 나무끼리 겹친 순서는 조금 어긋날 수 있다.
 */
// 나무 왕관은 몇 가지 모양·색·크기뿐이라, 미리 그려 둔 작은 그림(스프라이트)을 찍는다.
// 한 장에 나무가 수만 그루라 경로를 매번 그리는 것보다 훨씬 빠르다. 크기는 단계로 묶고 찍을 때 실제 크기로 맞춘다.
type Sprite = { img: CanvasImageSource; w: number; h: number; ox: number; oy: number; r: number; ps: number };
const spriteCache = new Map<string, Sprite>();
const SPRITE_LIMIT = 4000;

function makeCanvas(w: number, h: number): { canvas: CanvasImageSource; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | undefined {
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(w, h);
    const x = c.getContext("2d");
    return x ? { canvas: c, ctx: x } : undefined;
  }
  if (typeof document === "undefined") return undefined;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d");
  return x ? { canvas: c, ctx: x } : undefined;
}

/** 크기 단계: 작을수록 촘촘하게 */
const sizeStep = (r: number): number => (r < 3 ? Math.max(0.25, Math.round(r * 4) / 4) : r < 8 ? Math.round(r * 2) / 2 : Math.round(r));

function treeSprite(kind: number, colors: string[], r: number, ps: number): Sprite | undefined {
  const key = `${kind}|${colors[0]}|${colors[1]}|${colors[2]}|${r}|${ps}`;
  let s = spriteCache.get(key);
  if (s) return s;
  const ox = Math.ceil(r * ps) + 1, oy = Math.ceil(r * 1.25 * ps) + 1;
  const w = ox + Math.ceil(r * ps) + 1, h = oy + Math.ceil(r * ps) + 1;
  const made = makeCanvas(w, h);
  if (!made) return undefined;
  const c = made.ctx as CanvasRenderingContext2D;
  c.setTransform(ps, 0, 0, ps, ox, oy);
  for (let layer = 0; layer < 3; layer++) {
    c.beginPath();
    if (kind === 1) coniferPath(c, 0, 0, r, layer); else crownPath(c, 0, 0, r, layer);
    c.fillStyle = colors[layer];
    c.fill();
  }
  if (spriteCache.size >= SPRITE_LIMIT) spriteCache.clear();
  s = { img: made.canvas, w, h, ox, oy, r, ps };
  spriteCache.set(key, s);
  return s;
}

function paintTrees(ctx: CanvasRenderingContext2D, dl: DrawList, d: Float32Array, n: number): void {
  const S = 6;
  // 줄기
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = d[i * S], y = d[i * S + 1], r = d[i * S + 2], trunk = d[i * S + 5];
    if (r < 2.5) continue;
    ctx.moveTo(x, y + r * 0.5);
    ctx.lineTo(x, y + trunk);
  }
  ctx.strokeStyle = dl.palette.time === "night" ? "#1c1814" : "#5a4632";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  if (isVector(ctx)) {
    // SVG: 스프라이트 대신 색 묶음별 도형 경로 (요소 수를 줄인다)
    for (let layer = 0; layer < 3; layer++) {
      const groups = new Map<number, number[]>();
      for (let i = 0; i < n; i++) {
        const key = d[i * S + 3] * 16 + d[i * S + 4];
        const g = groups.get(key);
        if (g) g.push(i); else groups.set(key, [i]);
      }
      for (const [key, idx] of groups) {
        const ci = Math.floor(key / 16), group = key % 16;
        const colors = dl.treeColors[ci][group] ?? dl.treeColors[ci][0];
        ctx.beginPath();
        for (const i of idx) {
          const x = d[i * S], y = d[i * S + 1], r = d[i * S + 2];
          if (ci % 4 === 1) coniferPath(ctx, x, y, r, layer); else crownPath(ctx, x, y, r, layer);
        }
        ctx.fillStyle = colors[layer];
        ctx.fill();
      }
    }
    return;
  }
  // 화면 1단위가 실제 몇 픽셀인지 (확대·고해상도 화면에서도 선명하게)
  const m = ctx.getTransform();
  const ps = Math.max(0.25, Math.round(Math.hypot(m.a, m.b) * 4) / 4);
  for (let i = 0; i < n; i++) {
    const x = d[i * S], y = d[i * S + 1], r = d[i * S + 2];
    const ci = d[i * S + 3], group = d[i * S + 4];
    const colors = dl.treeColors[ci][group] ?? dl.treeColors[ci][0];
    const rq = sizeStep(r);
    const sp = treeSprite(ci % 4, colors, rq, ps);
    if (!sp) continue;
    const k = r / rq / ps;
    ctx.drawImage(sp.img, x - sp.ox * k, y - sp.oy * k, sp.w * k, sp.h * k);
  }
}

function crownPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, layer: number): void {
  if (layer === 0) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  } else if (layer === 1) {
    const rr = r * 0.78;
    ctx.moveTo(x - r * 0.16 + rr, y - r * 0.16);
    ctx.arc(x - r * 0.16, y - r * 0.16, rr, 0, Math.PI * 2);
  } else if (r > 1.6) {
    const rr = r * 0.38;
    ctx.moveTo(x - r * 0.36 + rr, y - r * 0.38);
    ctx.arc(x - r * 0.36, y - r * 0.38, rr, 0, Math.PI * 2);
  }
}

function coniferPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, layer: number): void {
  const top = y - r * 1.25, bottom = y + r * 0.85;
  if (layer === 0) {
    ctx.moveTo(x, top);
    ctx.lineTo(x + r * 0.85, bottom);
    ctx.lineTo(x - r * 0.85, bottom);
    ctx.closePath();
  } else if (layer === 1) {
    ctx.moveTo(x, top);
    ctx.lineTo(x + r * 0.15, bottom - r * 0.1);
    ctx.lineTo(x - r * 0.8, bottom - r * 0.05);
    ctx.closePath();
  } else if (r > 1.6) {
    ctx.moveTo(x, top);
    ctx.lineTo(x - r * 0.12, y - r * 0.2);
    ctx.lineTo(x - r * 0.42, y + r * 0.1);
    ctx.closePath();
  }
}

// ── 라벨 ─────────────────────────────────────────────────────────────
interface Rect { x0: number; y0: number; x1: number; y1: number }
const hitsAny = (r: Rect, placed: Rect[]): boolean =>
  placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0);

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const LEGEND_HEIGHT_RATIO = 0.155;

/** 마지막으로 그린 라벨 자리 (화면 좌표, 클릭 판정용). id가 음수면 정문·후문. */
export interface LabelHit {
  id: number; x0: number; y0: number; x1: number; y1: number;
  /** 기준점과 이름표 왼쪽 위 (화면 좌표), 글자 배율: 끌어서 옮길 때 쓴다 */
  ax: number; ay: number; bx: number; by: number; t: number;
}
export const labelHits: LabelHit[] = [];
/** 마지막으로 그린 메모 핀 자리 (화면 좌표) */
export const noteHits: { id: number; x0: number; y0: number; x1: number; y1: number }[] = [];

function drawOverlayText(ctx: CanvasRenderingContext2D, dl: DrawList, v: PaintView, layers: Layers, frame: FrameInfo): void {
  const t = v.textScale;
  const toView = (x: number, y: number): [number, number] => [(x - v.x) * v.scale, (y - v.y) * v.scale];
  const placed: Rect[] = [];
  labelHits.length = 0;
  const W = dl.width, H = dl.height;
  // 확대 중이거나 좁은 화면(글자를 크게 키운 경우)에는 지도 안 범례를 숨긴다. 지도 아래 목록이 대신한다.
  const zoomed = v.scale > 1.02 || t > 1.5;
  // 제목·범례 자리는 먼저 막아 둔다.
  let titleRect: Rect | undefined;
  if (layers.title) titleRect = drawTitle(ctx, frame, t, true);
  if (titleRect) placed.push(titleRect);
  const legendTop = layers.legend && !zoomed ? H - H * LEGEND_HEIGHT_RATIO * Math.min(t, 1.6) : H;
  placed.push({ x0: 0, y0: legendTop - 4, x1: W, y1: H + 100 });

  if (layers.labels) {
    const fontPx = 12.5 * t;
    ctx.font = `700 ${fontPx}px "Noto Sans KR", sans-serif`;
    ctx.textBaseline = "middle";
    // 손으로 옮긴 이름표를 먼저 그 자리에 두고, 나머지가 그것을 피한다. 숨긴 이름표는 그리지 않는다.
    const order = dl.labels.filter((l) => !l.hidden)
      .sort((a, b) => Number(b.dx !== undefined) - Number(a.dx !== undefined) || Number(b.core) - Number(a.core) || a.no - b.no);
    for (const lb of order) {
      const [ax, ay] = toView(lb.x, lb.y);
      if (ax < -50 || ax > W + 50 || ay < -50 || ay > H + 50) continue;
      const badge = 10.5 * t;
      const textW = ctx.measureText(lb.name).width;
      const padX = 7 * t, boxH = 20 * t;
      const totalW = badge * 2 + 2 * t + textW + padX * 2 - badge * 0.6;
      const forced = lb.dx !== undefined && lb.dy !== undefined;
      // 시도 자리: 이름표 왼쪽 위 (기준점에서)
      const tries: [number, number][] = forced ? [[lb.dx! * t, lb.dy! * t]]
        : [[0, -8 * t], [0, -26 * t], [totalW * 0.55, -6 * t], [-totalW * 0.55, -6 * t], [0, 14 * t]]
          .map(([dx, dy]) => [dx - totalW / 2, dy - boxH] as [number, number]);
      let done = false;
      for (const [dx, dy] of tries) {
        const x0 = ax + dx, y0 = ay + dy;
        const r: Rect = { x0: x0 - 2, y0: y0 - 2, x1: x0 + totalW + 2, y1: y0 + boxH + 2 };
        if (!forced && (r.x0 < 0 || r.x1 > W || r.y0 < 0 || hitsAny(r, placed))) continue;
        placed.push(r);
        labelHits.push({ id: lb.id, ...r, ax, ay, bx: x0, by: y0, t });
        const leader = forced ? Math.hypot(x0 + totalW / 2 - ax, y0 + boxH - ay) > 14 * t : dy + boxH > 10 * t || Math.abs(dx + totalW / 2) > 1;
        drawBuildingLabel(ctx, x0, y0, totalW, boxH, badge, lb.no, lb.name, t, [ax, ay], leader);
        done = true;
        break;
      }
      if (!done) {
        // 이름이 들어갈 자리가 없으면 번호 배지만 둔다.
        const r: Rect = { x0: ax - badge, y0: ay - badge * 2 - 6 * t, x1: ax + badge, y1: ay - 6 * t };
        if (!hitsAny(r, placed) && ay < legendTop) {
          placed.push(r);
          labelHits.push({ id: lb.id, ...r, ax, ay, bx: r.x0, by: r.y0, t });
          drawBadge(ctx, ax, ay - badge - 6 * t, badge, lb.no, t);
        }
      }
    }
  }
  noteHits.length = 0;
  if (layers.notes) {
    // 메모 핀: 바닥에서 솟은 핀과 제목. 이름표보다 위에 그리고, 겹치면 제목만 비킨다.
    for (const n of dl.notes) {
      const [gx, gy] = toView(n.gx, n.gy);
      // 핀 길이는 화면에서 알맞게 (멀리 있어도 보이고, 확대해도 너무 길지 않게)
      const len = Math.max(18 * t, Math.min(46 * t, gy - toView(n.x, n.y)[1]));
      const hx = gx, hy = gy - len;
      if (gx < -40 || gx > W + 40 || gy < -40 || gy > legendTop + 40) continue;
      const r = 7.5 * t;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(hx, hy + r);
      ctx.strokeStyle = "rgba(30,30,30,0.8)";
      ctx.lineWidth = 1.6 * t;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(gx, gy, 3.2 * t, 1.6 * t, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(hx, hy, r, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();
      ctx.lineWidth = 2 * t;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx - r * 0.3, hy - r * 0.3, r * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fill();
      ctx.font = `700 ${11.5 * t}px "Noto Sans KR", sans-serif`;
      const tw = ctx.measureText(n.title).width + 10 * t, th = 18 * t;
      let x0 = hx + r + 4 * t, y0 = hy - th / 2;
      let rect: Rect = { x0: x0 - 1, y0: y0 - 1, x1: x0 + tw + 1, y1: y0 + th + 1 };
      if (hitsAny(rect, placed) || rect.x1 > W) {
        x0 = hx - r - 4 * t - tw;
        rect = { x0: x0 - 1, y0: y0 - 1, x1: x0 + tw + 1, y1: y0 + th + 1 };
      }
      placed.push(rect);
      roundRect(ctx, x0, y0, tw, th, 4 * t);
      ctx.fillStyle = "rgba(255,255,255,0.94)";
      ctx.fill();
      ctx.lineWidth = 1.2 * t;
      ctx.strokeStyle = n.color;
      ctx.stroke();
      ctx.fillStyle = "#1f1d1a";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(n.title, x0 + 5 * t, y0 + th / 2 + 0.5 * t);
      noteHits.push({ id: n.id, x0: Math.min(hx - r, x0), y0: Math.min(hy - r, y0), x1: Math.max(hx + r, x0 + tw), y1: Math.max(gy, y0 + th) });
    }
  }
  if (layers.landmarks) {
    ctx.font = `600 ${11.5 * t}px "Noto Sans KR", sans-serif`;
    ctx.textBaseline = "middle";
    const pts = dl.points.filter((p) => !p.hidden)
      .sort((a, b) => Number(b.dx !== undefined) - Number(a.dx !== undefined) || Number(b.kind === "gate") - Number(a.kind === "gate"));
    for (const p of pts) {
      const [ax, ay] = toView(p.x, p.y);
      if (ax < 0 || ax > W || ay < 0 || ay > legendTop) continue;
      drawPointLabel(ctx, p, ax, ay, t, placed, W);
    }
  }
  if (titleRect) drawTitle(ctx, frame, t, false);
  if (layers.legend && !zoomed) drawLegend(ctx, dl, t, legendTop);
}

function drawBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, no: number, t: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = NAVY;
  ctx.fill();
  ctx.lineWidth = 1.6 * t;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${(no >= 10 ? 10.5 : 11.5) * t}px "Noto Sans KR", sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(String(no), cx, cy + 0.5 * t);
  ctx.textAlign = "left";
}

function drawBuildingLabel(
  ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, badge: number, no: number, name: string,
  t: number, anchor: [number, number], leader: boolean,
): void {
  const fontPx = 12.5 * t;
  if (leader) {
    ctx.beginPath();
    ctx.moveTo(anchor[0], anchor[1]);
    ctx.lineTo(Math.max(x0, Math.min(x0 + w, anchor[0])), anchor[1] < y0 ? y0 : y0 + h);
    ctx.strokeStyle = "rgba(27,42,92,0.7)";
    ctx.lineWidth = 1 * t;
    ctx.stroke();
  }
  const boxX = x0 + badge * 1.4;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 4 * t;
  ctx.shadowOffsetY = 1 * t;
  roundRect(ctx, boxX, y0 + h * 0.08, w - badge * 1.4, h * 0.84, 4 * t);
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 0.8 * t;
  ctx.strokeStyle = "rgba(27,42,92,0.35)";
  ctx.stroke();
  ctx.fillStyle = "#18213f";
  ctx.font = `700 ${fontPx}px "Noto Sans KR", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(name, boxX + badge * 0.75 + 4 * t, y0 + h / 2 + 0.5 * t);
  drawBadge(ctx, x0 + badge * 1.05, y0 + h / 2, badge, no, t);
}

function drawPointLabel(
  ctx: CanvasRenderingContext2D, p: PointAnchor, ax: number, ay: number, t: number, placed: Rect[], W: number,
): void {
  const gate = p.kind === "gate";
  ctx.font = `${gate ? 700 : 600} ${(gate ? 12.5 : 11.5) * t}px "Noto Sans KR", sans-serif`;
  const tw = ctx.measureText(p.name).width;
  const padX = 6 * t, h = (gate ? 20 : 18) * t;
  const w = tw + padX * 2;
  const forced = p.dx !== undefined && p.dy !== undefined;
  const tries: [number, number][] = forced ? [[p.dx! * t, p.dy! * t]] : gate
    ? [[-w / 2, -h - 14 * t], [-w / 2, 10 * t]]
    : [[10 * t, -h - 16 * t], [-w - 10 * t, -h - 16 * t], [12 * t, 4 * t], [-w - 12 * t, 4 * t], [-w / 2, -h - 30 * t]];
  for (const [dx, dy] of tries) {
    const x0 = ax + dx, y0 = ay + dy;
    const r: Rect = { x0: x0 - 2, y0: y0 - 2, x1: x0 + w + 2, y1: y0 + h + 2 };
    if (!forced && (r.x0 < 0 || r.x1 > W || r.y0 < 0 || hitsAny(r, placed))) continue;
    placed.push(r);
    labelHits.push({ id: p.id, ...r, ax, ay, bx: x0, by: y0, t });
    // 지시선과 점
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(Math.max(x0, Math.min(x0 + w, ax)), ay < y0 ? y0 : y0 + h);
    ctx.strokeStyle = gate ? NAVY : "rgba(40,40,40,0.75)";
    ctx.lineWidth = 1.1 * t;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ax, ay, (gate ? 4.2 : 2.6) * t, 0, Math.PI * 2);
    ctx.fillStyle = gate ? NAVY : "#ffffff";
    ctx.fill();
    ctx.lineWidth = 1.4 * t;
    ctx.strokeStyle = gate ? "#ffffff" : "#333333";
    ctx.stroke();
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.22)";
    ctx.shadowBlur = 3 * t;
    roundRect(ctx, x0, y0, w, h, 3.5 * t);
    ctx.fillStyle = gate ? NAVY : "rgba(255,253,246,0.96)";
    ctx.fill();
    ctx.restore();
    if (!gate) {
      ctx.lineWidth = 0.7 * t;
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.stroke();
    }
    ctx.fillStyle = gate ? "#ffffff" : "#222222";
    ctx.textBaseline = "middle";
    ctx.fillText(p.name, x0 + padX, y0 + h / 2 + 0.5 * t);
    return;
  }
}

// ── 제목 ─────────────────────────────────────────────────────────────
function drawTitle(ctx: CanvasRenderingContext2D, frame: FrameInfo, t: number, measureOnly: boolean): Rect {
  const s = Math.min(t, 1.8);
  const title = `${frame.name} 캠퍼스 조감도`;
  ctx.font = `700 ${27 * s}px "Noto Serif KR", serif`;
  const tw = ctx.measureText(title).width;
  ctx.font = `600 ${10 * s}px "Noto Sans KR", sans-serif`;
  const sub = frame.nameEn.split("").join(" ");
  const sw = ctx.measureText(sub).width;
  const x = 16 * s, y = 14 * s;
  const emblem = 50 * s;
  const w = emblem + 22 * s + Math.max(tw, sw) + 22 * s, h = 70 * s;
  const rect: Rect = { x0: x - 4, y0: y - 4, x1: x + w + 4, y1: y + h + 4 };
  if (measureOnly) return rect;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 10 * s;
  ctx.shadowOffsetY = 2 * s;
  roundRect(ctx, x, y, w, h, 6 * s);
  ctx.fillStyle = "#132250";
  ctx.fill();
  ctx.restore();
  roundRect(ctx, x + 3 * s, y + 3 * s, w - 6 * s, h - 6 * s, 4.5 * s);
  ctx.lineWidth = 1.6 * s;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
  roundRect(ctx, x + 6 * s, y + 6 * s, w - 12 * s, h - 12 * s, 3 * s);
  ctx.lineWidth = 0.6 * s;
  ctx.stroke();
  drawEmblem(ctx, x + 14 * s + emblem / 2, y + h / 2, emblem / 2, s);
  const tx = x + 14 * s + emblem + 12 * s;
  ctx.fillStyle = "#f3e6bf";
  ctx.font = `700 ${27 * s}px "Noto Serif KR", serif`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(title, tx, y + 38 * s);
  ctx.fillStyle = "#d9c992";
  ctx.font = `600 ${10 * s}px "Noto Sans KR", sans-serif`;
  ctx.fillText(sub, tx + 2 * s, y + 56 * s);
  return rect;
}

function drawEmblem(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, s: number): void {
  // 월계수 잎을 두른 방패
  ctx.save();
  ctx.strokeStyle = GOLD;
  ctx.fillStyle = GOLD;
  ctx.lineWidth = 1.2 * s;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.05, r * 0.92, Math.PI / 2 + side * 0.35, Math.PI / 2 + side * 2.5, side < 0);
    ctx.stroke();
    for (let k = 0; k < 7; k++) {
      const a = Math.PI / 2 + side * (0.55 + k * 0.28);
      const lx = cx + Math.cos(a) * r * 0.92, ly = cy + r * 0.05 + Math.sin(a) * r * 0.92;
      ctx.beginPath();
      ctx.ellipse(lx, ly, r * 0.15, r * 0.06, a + side * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const sw = r * 0.95, sh = r * 1.15;
  ctx.beginPath();
  ctx.moveTo(cx - sw / 2, cy - sh / 2);
  ctx.lineTo(cx + sw / 2, cy - sh / 2);
  ctx.lineTo(cx + sw / 2, cy + sh * 0.1);
  ctx.quadraticCurveTo(cx + sw / 2, cy + sh * 0.42, cx, cy + sh / 2);
  ctx.quadraticCurveTo(cx - sw / 2, cy + sh * 0.42, cx - sw / 2, cy + sh * 0.1);
  ctx.closePath();
  ctx.fillStyle = "#0e1a3e";
  ctx.fill();
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();
  // 펼친 책
  ctx.beginPath();
  ctx.moveTo(cx, cy - sh * 0.05);
  ctx.quadraticCurveTo(cx - sw * 0.2, cy - sh * 0.16, cx - sw * 0.34, cy - sh * 0.08);
  ctx.lineTo(cx - sw * 0.34, cy + sh * 0.16);
  ctx.quadraticCurveTo(cx - sw * 0.2, cy + sh * 0.08, cx, cy + sh * 0.2);
  ctx.quadraticCurveTo(cx + sw * 0.2, cy + sh * 0.08, cx + sw * 0.34, cy + sh * 0.16);
  ctx.lineTo(cx + sw * 0.34, cy - sh * 0.08);
  ctx.quadraticCurveTo(cx + sw * 0.2, cy - sh * 0.16, cx, cy - sh * 0.05);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy - sh * 0.05);
  ctx.lineTo(cx, cy + sh * 0.2);
  ctx.strokeStyle = "#0e1a3e";
  ctx.lineWidth = 0.8 * s;
  ctx.stroke();
  // 별
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
    const rr = k % 2 ? r * 0.06 : r * 0.14;
    const px = cx + Math.cos(a) * rr, py = cy - sh * 0.3 + Math.sin(a) * rr;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.restore();
}

// ── 범례 ─────────────────────────────────────────────────────────────
function drawLegend(ctx: CanvasRenderingContext2D, dl: DrawList, t: number, top: number): void {
  const W = dl.width, H = dl.height;
  const s = Math.min(t, 1.6);
  const x = 8 * s, y = top, w = W - 16 * s, h = H - top - 8 * s;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 8 * s;
  roundRect(ctx, x, y, w, h, 6 * s);
  ctx.fillStyle = "#fbf8ef";
  ctx.fill();
  ctx.restore();
  roundRect(ctx, x + 2.5 * s, y + 2.5 * s, w - 5 * s, h - 5 * s, 4.5 * s);
  ctx.lineWidth = 1.4 * s;
  ctx.strokeStyle = NAVY;
  ctx.stroke();

  const symbolsW = Math.min(310 * s, w * 0.3);
  const listW = w - symbolsW - 24 * s;
  const items = dl.labels;
  const rows = Math.max(1, Math.ceil(items.length / 5));
  const cols = Math.max(1, Math.ceil(items.length / rows));
  const colW = listW / cols;
  const rowH = Math.min(22 * s, (h - 18 * s) / rows);
  const fs = Math.min(12.5 * s, rowH * 0.62);
  ctx.textBaseline = "middle";
  items.forEach((lb, i) => {
    const c = Math.floor(i / rows), r = i % rows;
    const cx = x + 16 * s + c * colW, cy = y + 10 * s + rowH * (r + 0.5);
    const br = Math.min(9 * s, rowH * 0.42);
    ctx.beginPath();
    ctx.arc(cx + br, cy, br, 0, Math.PI * 2);
    ctx.fillStyle = NAVY;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${fs * 0.85}px "Noto Sans KR", sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(String(lb.no), cx + br, cy + 0.5);
    ctx.textAlign = "left";
    ctx.fillStyle = "#1e2440";
    ctx.font = `500 ${fs}px "Noto Sans KR", sans-serif`;
    ctx.fillText(fit(ctx, lb.name, colW - br * 2 - 14 * s), cx + br * 2 + 8 * s, cy + 0.5);
    if (c > 0 && r === 0) {
      ctx.beginPath();
      ctx.moveTo(cx - 8 * s, y + 10 * s);
      ctx.lineTo(cx - 8 * s, y + h - 10 * s);
      ctx.strokeStyle = "rgba(27,42,92,0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  });

  // 상징물 칸
  const sx = x + w - symbolsW - 10 * s, sy = y + 8 * s;
  const head = 18 * s;
  ctx.fillStyle = NAVY;
  ctx.fillRect(sx, sy, symbolsW, head);
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${11 * s}px "Noto Sans KR", sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("주요 시설 및 상징물", sx + symbolsW / 2, sy + head / 2 + 0.5);
  ctx.textAlign = "left";
  const entries: { kind: LandmarkKind | "gateS" | "gateN"; name: string }[] = [
    { kind: "gateS", name: "정문 (남문)" }, { kind: "gateN", name: "후문 (북문)" },
  ];
  const seen = new Set<string>();
  for (const p of dl.points) {
    if (p.kind === "gate" || p.kind === "place" || seen.has(p.name)) continue;
    seen.add(p.name);
    entries.push({ kind: p.kind, name: p.name });
  }
  const perCol = Math.max(1, Math.ceil(entries.length / 2));
  const eh = Math.min(19 * s, (h - head - 18 * s) / perCol);
  const efs = Math.min(11 * s, eh * 0.62);
  entries.forEach((e, i) => {
    const c = Math.floor(i / perCol), r = i % perCol;
    const ex = sx + 8 * s + c * (symbolsW / 2), ey = sy + head + 6 * s + eh * (r + 0.5);
    drawSymbol(ctx, e.kind, ex + 7 * s, ey, 6.5 * s);
    ctx.fillStyle = "#1e2440";
    ctx.font = `500 ${efs}px "Noto Sans KR", sans-serif`;
    ctx.fillText(fit(ctx, e.name, symbolsW / 2 - 24 * s), ex + 18 * s, ey + 0.5);
  });
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

/** 범례용 작은 기호 */
export function drawSymbol(ctx: CanvasRenderingContext2D, kind: LandmarkKind | "gateS" | "gateN", x: number, y: number, r: number): void {
  ctx.save();
  ctx.lineWidth = Math.max(1, r * 0.22);
  ctx.strokeStyle = NAVY;
  ctx.fillStyle = NAVY;
  switch (kind) {
    case "gateS": case "gateN":
      ctx.beginPath();
      ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, kind === "gateS" ? y - r * 0.7 : y + r * 0.7);
      ctx.lineTo(x, kind === "gateS" ? y - r * 1.3 : y + r * 1.3);
      ctx.stroke();
      break;
    case "fountain":
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.5, r, r * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y + r * 0.4);
      ctx.quadraticCurveTo(x - r * 0.2, y - r, x - r * 0.7, y + r * 0.1);
      ctx.moveTo(x, y + r * 0.4);
      ctx.quadraticCurveTo(x + r * 0.2, y - r, x + r * 0.7, y + r * 0.1);
      ctx.stroke();
      break;
    case "obelisk":
      ctx.beginPath();
      ctx.moveTo(x - r * 0.3, y + r);
      ctx.lineTo(x - r * 0.18, y - r * 0.6);
      ctx.lineTo(x, y - r);
      ctx.lineTo(x + r * 0.18, y - r * 0.6);
      ctx.lineTo(x + r * 0.3, y + r);
      ctx.closePath();
      ctx.fill();
      break;
    case "loop":
      ctx.beginPath();
      for (let k = 0; k <= 40; k++) {
        const tt = (k / 40) * Math.PI * 2, den = 1 + Math.sin(tt) ** 2;
        const px = x + (r * 1.1 * Math.cos(tt)) / den, py = y + (r * 1.1 * Math.sin(tt) * Math.cos(tt)) / den;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      break;
    case "globe":
      ctx.beginPath();
      ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
      ctx.fillStyle = "#3d6db0";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = r * 0.12;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.35, r * 0.85, 0, 0, Math.PI * 2);
      ctx.moveTo(x - r * 0.85, y);
      ctx.lineTo(x + r * 0.85, y);
      ctx.stroke();
      break;
    case "book":
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.4);
      ctx.lineTo(x - r, y - r * 0.7);
      ctx.lineTo(x - r, y + r * 0.6);
      ctx.lineTo(x, y + r * 0.85);
      ctx.lineTo(x + r, y + r * 0.6);
      ctx.lineTo(x + r, y - r * 0.7);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.4);
      ctx.lineTo(x, y + r * 0.85);
      ctx.stroke();
      break;
    case "curve":
      ctx.beginPath();
      for (let k = 0; k <= 30; k++) {
        const tt = k / 30;
        const px = x - r + 2 * r * tt, py = y - Math.sin(tt * Math.PI * 2) * r * 0.6;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      break;
    case "garden":
      ctx.beginPath();
      ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x - r * 0.25, y - r * 0.1, r * 0.25, 0, Math.PI * 2);
      ctx.arc(x + r * 0.3, y + r * 0.2, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "emblem":
      ctx.beginPath();
      ctx.arc(x, y, r * 0.9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
        const rr = k % 2 ? r * 0.25 : r * 0.6;
        if (k === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      break;
    case "statue":
      ctx.fillRect(x - r * 0.45, y + r * 0.3, r * 0.9, r * 0.6);
      ctx.beginPath();
      ctx.arc(x, y - r * 0.65, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x - r * 0.18, y - r * 0.4, r * 0.36, r * 0.75);
      break;
    case "bell":
      ctx.beginPath();
      ctx.moveTo(x - r, y - r * 0.45);
      ctx.lineTo(x, y - r);
      ctx.lineTo(x + r, y - r * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - r * 0.35, y + r * 0.6);
      ctx.quadraticCurveTo(x - r * 0.35, y - r * 0.3, x, y - r * 0.3);
      ctx.quadraticCurveTo(x + r * 0.35, y - r * 0.3, x + r * 0.35, y + r * 0.6);
      ctx.closePath();
      ctx.fill();
      break;
    case "pond":
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#4f8fc4";
      ctx.fill();
      break;
  }
  ctx.restore();
}

export const LANDMARK_DESC = (kind: LandmarkKind): string => LANDMARKS[kind].desc;
