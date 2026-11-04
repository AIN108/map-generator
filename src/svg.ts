// SVG로 받아 적는 그리기 판: Canvas 2D 그리기 함수(paint·배치도)가 쓰는 만큼의 명령을 흉내 내 벡터 도면(SVG)을 만든다.
// 변환은 닮음 변환(이동·회전·균일 배율)만 쓴다고 보고, 좌표를 미리 변환해 적는다. 그림자는 적지 않는다.

type M = [number, number, number, number, number, number]; // a b c d e f

const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const num = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

class Gradient {
  readonly stops: [number, string][] = [];
  readonly kind: "linear" | "radial";
  readonly coords: number[];
  constructor(kind: "linear" | "radial", coords: number[]) {
    this.kind = kind;
    this.coords = coords;
  }
  addColorStop(offset: number, color: string): void { this.stops.push([offset, color]); }
}

interface State {
  m: M;
  fillStyle: string | Gradient;
  strokeStyle: string | Gradient;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  dash: number[];
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  composite: string;
  clip?: string;
}

/** 글자 너비는 실제 캔버스로 잰다 (없으면 대략) */
let measurer: CanvasRenderingContext2D | null | undefined;
function measure(font: string, text: string): number {
  if (measurer === undefined) {
    try {
      measurer = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    } catch {
      measurer = null;
    }
  }
  if (measurer) {
    measurer.font = font;
    return measurer.measureText(text).width;
  }
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 12);
  return text.length * px * 0.9;
}

export class SvgContext {
  /** 그리는 쪽에서 SVG인지 알아보는 표시 (나무를 스프라이트 대신 도형으로) */
  readonly vector = true;
  readonly canvas: { width: number; height: number };
  private body: string[] = [];
  private defs: string[] = [];
  private ids = 0;
  private path: string[] = [];
  private cur: [number, number] | undefined;
  private start: [number, number] | undefined;
  private st: State;
  private stack: State[] = [];
  private gradIds = new Map<Gradient, string>();

  constructor(width: number, height: number) {
    this.canvas = { width, height };
    this.st = {
      m: [1, 0, 0, 1, 0, 0], fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, lineCap: "butt", lineJoin: "miter", dash: [],
      font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic", globalAlpha: 1, composite: "source-over",
    };
  }

  // ── 상태 ──
  get fillStyle(): string | Gradient { return this.st.fillStyle; }
  set fillStyle(v: string | Gradient) { this.st.fillStyle = v; }
  get strokeStyle(): string | Gradient { return this.st.strokeStyle; }
  set strokeStyle(v: string | Gradient) { this.st.strokeStyle = v; }
  get lineWidth(): number { return this.st.lineWidth; }
  set lineWidth(v: number) { this.st.lineWidth = v; }
  get lineCap(): CanvasLineCap { return this.st.lineCap; }
  set lineCap(v: CanvasLineCap) { this.st.lineCap = v; }
  get lineJoin(): CanvasLineJoin { return this.st.lineJoin; }
  set lineJoin(v: CanvasLineJoin) { this.st.lineJoin = v; }
  get font(): string { return this.st.font; }
  set font(v: string) { this.st.font = v; }
  get textAlign(): CanvasTextAlign { return this.st.textAlign; }
  set textAlign(v: CanvasTextAlign) { this.st.textAlign = v; }
  get textBaseline(): CanvasTextBaseline { return this.st.textBaseline; }
  set textBaseline(v: CanvasTextBaseline) { this.st.textBaseline = v; }
  get globalAlpha(): number { return this.st.globalAlpha; }
  set globalAlpha(v: number) { this.st.globalAlpha = v; }
  get globalCompositeOperation(): string { return this.st.composite; }
  set globalCompositeOperation(v: string) { this.st.composite = v; }
  // 그림자·이미지 다듬기는 적지 않는다
  shadowColor = "transparent";
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  imageSmoothingEnabled = true;

  save(): void { this.stack.push({ ...this.st, dash: [...this.st.dash] }); }
  restore(): void { const s = this.stack.pop(); if (s) this.st = s; }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void { this.st.m = [a, b, c, d, e, f]; }
  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const [a, b, c, d, e, f] = this.st.m;
    return { a, b, c, d, e, f };
  }
  translate(x: number, y: number): void { this.st.m = mul(this.st.m, [1, 0, 0, 1, x, y]); }
  rotate(r: number): void { const c = Math.cos(r), s = Math.sin(r); this.st.m = mul(this.st.m, [c, s, -s, c, 0, 0]); }
  scale(x: number, y: number): void { this.st.m = mul(this.st.m, [x, 0, 0, y, 0, 0]); }
  setLineDash(d: number[]): void { this.st.dash = [...d]; }
  getLineDash(): number[] { return [...this.st.dash]; }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): Gradient {
    const [a, b] = this.tp(x0, y0), [c, d] = this.tp(x1, y1);
    return new Gradient("linear", [a, b, c, d]);
  }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): Gradient {
    const [a, b] = this.tp(x0, y0), [c, d] = this.tp(x1, y1), k = this.k();
    return new Gradient("radial", [a, b, r0 * k, c, d, r1 * k]);
  }
  measureText(text: string): TextMetrics {
    return { width: measure(this.st.font, text) } as TextMetrics;
  }

  // ── 경로 ──
  private tp(x: number, y: number): [number, number] {
    const m = this.st.m;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }
  /** 닮음 변환의 배율 */
  private k(): number { const m = this.st.m; return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])); }
  beginPath(): void { this.path = []; this.cur = undefined; this.start = undefined; }
  moveTo(x: number, y: number): void {
    const p = this.tp(x, y);
    this.path.push(`M${num(p[0])} ${num(p[1])}`);
    this.cur = p;
    this.start = p;
  }
  lineTo(x: number, y: number): void {
    if (!this.cur) { this.moveTo(x, y); return; }
    const p = this.tp(x, y);
    this.path.push(`L${num(p[0])} ${num(p[1])}`);
    this.cur = p;
  }
  closePath(): void {
    if (!this.cur) return;
    this.path.push("Z");
    this.cur = this.start;
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    if (!this.cur) this.moveTo(cx, cy);
    const c = this.tp(cx, cy), p = this.tp(x, y);
    this.path.push(`Q${num(c[0])} ${num(c[1])} ${num(p[0])} ${num(p[1])}`);
    this.cur = p;
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    if (!this.cur) this.moveTo(c1x, c1y);
    const a = this.tp(c1x, c1y), b = this.tp(c2x, c2y), p = this.tp(x, y);
    this.path.push(`C${num(a[0])} ${num(a[1])} ${num(b[0])} ${num(b[1])} ${num(p[0])} ${num(p[1])}`);
    this.cur = p;
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void {
    this.ellipse(x, y, r, r, 0, a0, a1, ccw);
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false): void {
    if (rx <= 0 || ry <= 0) return;
    let sweep = ccw ? a0 - a1 : a1 - a0;
    const full = sweep >= Math.PI * 2 - 1e-9;
    if (!full) sweep = ((sweep % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const at = (a: number): [number, number] => {
      const cx = Math.cos(a) * rx, cy = Math.sin(a) * ry;
      return [x + cx * Math.cos(rot) - cy * Math.sin(rot), y + cx * Math.sin(rot) + cy * Math.cos(rot)];
    };
    const s = at(a0);
    if (this.cur) this.lineTo(s[0], s[1]); else this.moveTo(s[0], s[1]);
    const k = this.k(), m = this.st.m;
    const rotDeg = ((Math.atan2(m[1], m[0]) + rot) * 180) / Math.PI;
    const flag = ccw ? 0 : 1;
    const seg = (to: number, large: number): void => {
      const e = at(to), p = this.tp(e[0], e[1]);
      this.path.push(`A${num(rx * k)} ${num(ry * k)} ${num(rotDeg)} ${large} ${flag} ${num(p[0])} ${num(p[1])}`);
      this.cur = p;
    };
    if (full) {
      const dir = ccw ? -1 : 1;
      seg(a0 + dir * Math.PI, 0);
      seg(a0 + dir * Math.PI * 2, 0);
    } else if (sweep > 1e-9) {
      seg(ccw ? a0 - sweep : a0 + sweep, sweep > Math.PI ? 1 : 0);
    }
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    if (!this.cur) { this.moveTo(x1, y1); return; }
    // 현재 점을 사용자 좌표로 되돌리지 않고, 사용자 좌표의 세 점으로 접선 원을 구한다
    const inv = this.invert();
    const p0 = inv(this.cur);
    const v1 = [p0[0] - x1, p0[1] - y1], v2 = [x2 - x1, y2 - y1];
    const l1 = Math.hypot(v1[0], v1[1]), l2 = Math.hypot(v2[0], v2[1]);
    if (l1 < 1e-9 || l2 < 1e-9 || r <= 0) { this.lineTo(x1, y1); return; }
    const u1 = [v1[0] / l1, v1[1] / l1], u2 = [v2[0] / l2, v2[1] / l2];
    const cos = u1[0] * u2[0] + u1[1] * u2[1];
    const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (ang < 1e-6 || Math.abs(ang - Math.PI) < 1e-6) { this.lineTo(x1, y1); return; }
    const t = r / Math.tan(ang / 2);
    const a: [number, number] = [x1 + u1[0] * t, y1 + u1[1] * t], b: [number, number] = [x1 + u2[0] * t, y1 + u2[1] * t];
    this.lineTo(a[0], a[1]);
    const cross = u1[0] * u2[1] - u1[1] * u2[0];
    const pb = this.tp(b[0], b[1]);
    this.path.push(`A${num(r * this.k())} ${num(r * this.k())} 0 0 ${cross > 0 ? 0 : 1} ${num(pb[0])} ${num(pb[1])}`);
    this.cur = pb;
  }
  private invert(): (p: [number, number]) => [number, number] {
    const [a, b, c, d, e, f] = this.st.m;
    const det = a * d - b * c || 1;
    return ([x, y]) => [(d * (x - e) - c * (y - f)) / det, (-b * (x - e) + a * (y - f)) / det];
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath();
  }
  roundRect(x: number, y: number, w: number, h: number, r: number | number[] = 0): void {
    const rr = Math.max(0, Math.min(Array.isArray(r) ? r[0] ?? 0 : r, Math.abs(w) / 2, Math.abs(h) / 2));
    this.moveTo(x + rr, y);
    this.arcTo(x + w, y, x + w, y + h, rr);
    this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr);
    this.arcTo(x, y, x + w, y, rr);
    this.closePath();
  }

  // ── 칠하기 ──
  private paint(style: string | Gradient): string {
    if (typeof style === "string") return style;
    let id = this.gradIds.get(style);
    if (!id) {
      id = `g${++this.ids}`;
      this.gradIds.set(style, id);
      const stops = style.stops.map(([o, c]) => `<stop offset="${num(o)}" stop-color="${esc(c)}"/>`).join("");
      const c = style.coords.map(num);
      this.defs.push(style.kind === "linear"
        ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${c[0]}" y1="${c[1]}" x2="${c[2]}" y2="${c[3]}">${stops}</linearGradient>`
        : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" fx="${c[0]}" fy="${c[1]}" fr="${c[2]}" cx="${c[3]}" cy="${c[4]}" r="${c[5]}">${stops}</radialGradient>`);
    }
    return `url(#${id})`;
  }
  private common(): string {
    let s = "";
    if (this.st.globalAlpha < 1) s += ` opacity="${num(this.st.globalAlpha)}"`;
    if (this.st.composite === "lighter") s += ` style="mix-blend-mode:screen"`;
    if (this.st.clip) s += ` clip-path="url(#${this.st.clip})"`;
    return s;
  }
  fill(rule?: CanvasFillRule): void {
    if (!this.path.length) return;
    this.body.push(`<path d="${this.path.join("")}" fill="${esc(this.paint(this.st.fillStyle))}"${rule === "evenodd" ? ' fill-rule="evenodd"' : ""}${this.common()}/>`);
  }
  stroke(): void {
    if (!this.path.length) return;
    const k = this.k();
    const dash = this.st.dash.length ? ` stroke-dasharray="${this.st.dash.map((d) => num(d * k)).join(" ")}"` : "";
    this.body.push(`<path d="${this.path.join("")}" fill="none" stroke="${esc(this.paint(this.st.strokeStyle))}" stroke-width="${num(this.st.lineWidth * k)}"`
      + `${this.st.lineCap !== "butt" ? ` stroke-linecap="${this.st.lineCap}"` : ""}${this.st.lineJoin !== "miter" ? ` stroke-linejoin="${this.st.lineJoin}"` : ""}${dash}${this.common()}/>`);
  }
  clip(): void {
    if (!this.path.length) return;
    const id = `c${++this.ids}`;
    this.defs.push(`<clipPath id="${id}"><path d="${this.path.join("")}"/></clipPath>`);
    this.st.clip = id;
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const saved = this.path, cur = this.cur, start = this.start;
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
    this.path = saved; this.cur = cur; this.start = start;
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    const saved = this.path, cur = this.cur, start = this.start;
    this.beginPath();
    this.rect(x, y, w, h);
    this.stroke();
    this.path = saved; this.cur = cur; this.start = start;
  }
  clearRect(): void {
    // 내보내기는 빈 판에서 시작하므로 무시한다
  }
  fillText(text: string, x: number, y: number): void {
    const m = /^(?:(\d{3}|bold|normal)\s+)?(\d+(?:\.\d+)?)px\s+(.+)$/.exec(this.st.font.trim());
    const weight = m?.[1] === "bold" ? "700" : m?.[1] ?? "400";
    const size = Number(m?.[2] ?? 10) * this.k();
    const family = (m?.[3] ?? "sans-serif").replace(/"/g, "'");
    const [px, py] = this.tp(x, y);
    const anchor = this.st.textAlign === "center" ? "middle" : this.st.textAlign === "right" || this.st.textAlign === "end" ? "end" : "start";
    const base = this.st.textBaseline === "middle" ? "central" : this.st.textBaseline === "top" || this.st.textBaseline === "hanging" ? "hanging"
      : this.st.textBaseline === "bottom" ? "text-after-edge" : "auto";
    const rot = (Math.atan2(this.st.m[1], this.st.m[0]) * 180) / Math.PI;
    const tr = Math.abs(rot) > 0.01 ? ` transform="rotate(${num(rot)} ${num(px)} ${num(py)})"` : "";
    this.body.push(`<text x="${num(px)}" y="${num(py)}" font-family="${esc(family)}" font-size="${num(size)}" font-weight="${weight}" text-anchor="${anchor}"`
      + ` dominant-baseline="${base}" fill="${esc(this.paint(this.st.fillStyle))}"${tr}${this.common()}>${esc(text)}</text>`);
  }
  drawImage(): void {
    // 스프라이트는 쓰지 않는다 (나무는 도형으로 그린다)
  }

  /** 완성한 SVG 글 */
  toString(): string {
    const { width, height } = this.canvas;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
      + `<style>text{white-space:pre}</style><style>@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&amp;family=Noto+Serif+KR:wght@700&amp;display=swap');</style>`
      + `<defs>${this.defs.join("")}</defs>${this.body.join("\n")}</svg>\n`;
  }
}

/** SVG 판을 캔버스 그리기 함수에 넘길 때 */
export const asCanvas = (c: SvgContext): CanvasRenderingContext2D => c as unknown as CanvasRenderingContext2D;
export const isVector = (ctx: CanvasRenderingContext2D): boolean => (ctx as unknown as { vector?: boolean }).vector === true;
