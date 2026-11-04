// 평면도 편집기의 기하: 화면 맞춤, 끌 수 있는 손잡이, 손잡이를 끈 자리 → 새 크기·모양 값, 자유형 칸 찾기.
// 국소 좌표는 건물 중심 기준 u(오른쪽, 폭 방향)·v(정면 쪽, 깊이 방향)이고 평면도에서는 v가 아래로 간다.

import { FORM_SPEC, resolveForm, type BuildingForm } from "./form.ts";
import type { Building } from "./layout.ts";

export interface PlanFit {
  /** 1 m당 화면 px */
  s: number;
  /** 건물 중심의 화면 위치 */
  ox: number;
  oy: number;
}

/** 폭 w·깊이 d를 화면 cw×ch 안에 margin을 두고 맞춘다. 크기 손잡이를 끌 때 흔들리지 않게 base 크기를 따로 줄 수 있다. */
export function planFit(w: number, d: number, cw: number, ch: number, margin: number): PlanFit {
  const s = Math.max(0.2, Math.min((cw - 2 * margin) / Math.max(1, w), (ch - 2 * margin) / Math.max(1, d)));
  return { s, ox: cw / 2, oy: ch / 2 };
}

export type HandleKey = "w" | "d" | "wing" | "depth";

export interface Handle {
  key: HandleKey;
  u: number;
  v: number;
  /** 끄는 방향 */
  axis: "u" | "v";
  label: string;
}

type Host = Pick<Building, "shape" | "w" | "d" | "floors" | "variant" | "form">;

/** 끌 수 있는 손잡이: 바닥 상자 오른쪽(폭)·앞쪽(깊이), 모양마다 날개·뒤 동·탑 경계 */
export function planHandles(b: Host): Handle[] {
  const hw = b.w / 2, hd = b.d / 2;
  const out: Handle[] = [
    { key: "w", u: hw, v: 0, axis: "u", label: "폭" },
    { key: "d", u: 0, v: hd, axis: "v", label: "깊이" },
  ];
  const spec = FORM_SPEC[b.shape];
  if (!spec) return out;
  const f = resolveForm(b);
  const wingLabel = spec.wing?.label ?? "", depthLabel = spec.depth?.label ?? "";
  switch (b.shape) {
    case "L": {
      const ww = b.w * f.wing, mainD = b.d * f.depth, side = f.flip ? -1 : 1;
      out.push({ key: "wing", u: side * (hw - ww), v: (-hd + mainD + hd) / 2, axis: "u", label: wingLabel });
      out.push({ key: "depth", u: -side * ww / 2, v: -hd + mainD, axis: "v", label: depthLabel });
      break;
    }
    case "U": {
      const ww = b.w * f.wing, backD = b.d * f.depth;
      out.push({ key: "wing", u: hw - ww, v: (-hd + backD + hd) / 2, axis: "u", label: wingLabel });
      out.push({ key: "depth", u: 0, v: -hd + backD, axis: "v", label: depthLabel });
      break;
    }
    case "court":
      out.push({ key: "wing", u: hw - Math.min(b.w, b.d) * f.wing, v: 0, axis: "u", label: wingLabel });
      break;
    case "wings":
      out.push({ key: "wing", u: (b.w * f.wing) / 2, v: hd - 2.5, axis: "u", label: wingLabel });
      break;
    case "atrium":
      out.push({ key: "wing", u: (b.w * f.wing) / 2, v: hd - 4.5, axis: "u", label: wingLabel });
      break;
    case "stepped":
      out.push({ key: "wing", u: hw * f.wing, v: -hd * 0.3, axis: "u", label: wingLabel });
      break;
    case "twin":
      out.push({ key: "wing", u: -hw + b.w * f.wing, v: 0, axis: "u", label: wingLabel });
      break;
    case "tower":
      out.push({ key: "wing", u: hw * f.wing, v: 0, axis: "u", label: wingLabel });
      out.push({ key: "depth", u: 0, v: hd * f.depth, axis: "v", label: depthLabel });
      break;
  }
  return out;
}

export interface DragResult {
  w?: number;
  d?: number;
  form?: Pick<BuildingForm, "wing" | "depth">;
  /** 손잡이 옆에 보여 줄 길이 (m) */
  meters: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const r2 = (v: number): number => Math.round(v * 100) / 100;
const r1 = (v: number): number => Math.round(v * 10) / 10;

/** 손잡이를 국소 좌표 (u, v)로 끌었을 때의 새 값 */
export function dragHandle(b: Host, key: HandleKey, u: number, v: number): DragResult {
  const hw = b.w / 2, hd = b.d / 2;
  if (key === "w") { const w = r1(clamp(2 * Math.abs(u), 8, 220)); return { w, meters: w }; }
  if (key === "d") { const d = r1(clamp(2 * Math.abs(v), 8, 160)); return { d, meters: d }; }
  const spec = FORM_SPEC[b.shape];
  const rs = key === "wing" ? spec?.wing : spec?.depth;
  if (!rs) return { meters: 0 };
  const f = resolveForm(b);
  let ratio: number;
  if (key === "wing") {
    switch (b.shape) {
      case "L": ratio = f.flip ? (u + hw) / b.w : (hw - u) / b.w; break;
      case "U": case "twin": ratio = (hw - Math.abs(u)) / b.w; break;
      case "court": ratio = (hw - Math.abs(u)) / Math.min(b.w, b.d); break;
      case "wings": case "atrium": ratio = (2 * Math.abs(u)) / b.w; break;
      default: ratio = Math.abs(u) / hw; // 계단식·탑상형: 반폭 비율
    }
  } else {
    ratio = b.shape === "tower" ? Math.abs(v) / hd : (v + hd) / b.d;
  }
  const value = r2(clamp(ratio, rs.lo, rs.hi));
  const base = rs.base === "w" ? b.w : rs.base === "d" ? b.d : Math.min(b.w, b.d);
  return { form: { [key]: value }, meters: r1(value * base) };
}

/** 자유형 칸 번호 (밖이면 undefined) */
export function cellAt(b: Host, u: number, v: number): number | undefined {
  const g = b.shape === "custom" ? b.form?.grid : undefined;
  if (!g) return undefined;
  const i = Math.floor(((u + b.w / 2) / b.w) * g.cols), j = Math.floor(((v + b.d / 2) / b.d) * g.rows);
  if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) return undefined;
  return j * g.cols + i;
}

/** 화면에 알맞은 눈금 간격 (m): 칸이 minPx 이상 되는 가장 작은 값 */
export function niceStep(s: number, minPx: number): number {
  for (const m of [1, 2, 5, 10, 20, 50, 100]) if (m * s >= minPx) return m;
  return 200;
}

/** 정면이 바라보는 방위 (16방위, 0°면 남쪽) */
export function facingText(angle: number): string {
  // 정면(+v)의 월드 방향 = (-sin a, cos a). 동쪽 0°, 북쪽 90° 기준 방위각으로 바꾼다.
  const fx = -Math.sin(angle), fy = Math.cos(angle);
  const deg = ((Math.atan2(-fy, fx) * 180) / Math.PI + 360) % 360;
  const names = ["동", "동북동", "북동", "북북동", "북", "북북서", "북서", "서북서", "서", "서남서", "남서", "남남서", "남", "남남동", "남동", "동남동"];
  return names[Math.round(deg / 22.5) % 16];
}
