// 끌 때 정렬 안내: 같은 방향(또는 90° 돌린 방향)인 이웃 건물과 가운데·변이 맞으면 그 자리로 살짝 당기고 안내선을 돌려준다.

import type { Vec2 } from "./geom.ts";
import { isPlace, type Building } from "./layout.ts";

export interface AlignGuide { a: Vec2; b: Vec2 }
export interface AlignResult { x: number; y: number; guides: AlignGuide[] }

const TAU = Math.PI * 2;
/** 두 방향이 같은 축을 쓰는가 (0° 또는 90° 차이). 90°면 폭·깊이가 바뀐다. */
function axisRelation(a: number, b: number): "same" | "swapped" | undefined {
  const d = (((b - a) % TAU) + TAU) % TAU;
  const q = d / (Math.PI / 2);
  const k = Math.round(q);
  if (Math.abs(q - k) * 90 > 1) return undefined;
  return k % 2 === 0 ? "same" : "swapped";
}

/**
 * (x, y)에 b를 놓을 때 이웃과 맞출 자리. threshold(m) 안에 맞출 것이 있으면 당긴다.
 * 축마다(건물 국소 u·v) 가운데·양쪽 변 가운데 가장 가까운 하나만 맞춘다.
 */
export function alignTo(b: Building, x: number, y: number, others: readonly Building[], threshold = 2.5, reach = 260): AlignResult {
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  const toLocal = (px: number, py: number): Vec2 => [(px - x) * c + (py - y) * s, -(px - x) * s + (py - y) * c];
  const toWorld = (u: number, v: number): Vec2 => [x + u * c - v * s, y + u * s + v * c];
  const hw = b.w / 2, hd = b.d / 2;
  let bestU: { delta: number; o: Vec2; line: number } | undefined, bestV: typeof bestU;
  for (const o of others) {
    if (o.id === b.id || isPlace(o)) continue;
    if (Math.abs(o.x - x) > reach || Math.abs(o.y - y) > reach) continue;
    const rel = axisRelation(b.angle, o.angle);
    if (!rel) continue;
    const [ou, ov] = toLocal(o.x, o.y);
    const ow = (rel === "same" ? o.w : o.d) / 2, od = (rel === "same" ? o.d : o.w) / 2;
    // u 축: 세로선끼리 (가운데·왼쪽 변·오른쪽 변)
    for (const mine of [-hw, 0, hw]) {
      for (const theirs of [ou - ow, ou, ou + ow]) {
        const delta = theirs - mine;
        if (Math.abs(delta) <= threshold && (!bestU || Math.abs(delta) < Math.abs(bestU.delta))) bestU = { delta, o: [ou, ov], line: theirs };
      }
    }
    for (const mine of [-hd, 0, hd]) {
      for (const theirs of [ov - od, ov, ov + od]) {
        const delta = theirs - mine;
        if (Math.abs(delta) <= threshold && (!bestV || Math.abs(delta) < Math.abs(bestV.delta))) bestV = { delta, o: [ou, ov], line: theirs };
      }
    }
  }
  const du = bestU?.delta ?? 0, dv = bestV?.delta ?? 0;
  const [nx, ny] = toWorld(du, dv);
  const guides: AlignGuide[] = [];
  // 안내선: 맞춘 선을 따라 내 건물과 이웃 건물을 잇는다 (국소 좌표 → 월드, 옮긴 뒤 기준)
  const toWorldNew = (u: number, v: number): Vec2 => [nx + (u - du) * c - (v - dv) * s, ny + (u - du) * s + (v - dv) * c];
  if (bestU) {
    const v0 = Math.min(-hd + dv, bestU.o[1]) - 6, v1 = Math.max(hd + dv, bestU.o[1]) + 6;
    guides.push({ a: toWorldNew(bestU.line, v0), b: toWorldNew(bestU.line, v1) });
  }
  if (bestV) {
    const u0 = Math.min(-hw + du, bestV.o[0]) - 6, u1 = Math.max(hw + du, bestV.o[0]) + 6;
    guides.push({ a: toWorldNew(u0, bestV.line), b: toWorldNew(u1, bestV.line) });
  }
  return { x: Math.round(nx * 10) / 10, y: Math.round(ny * 10) / 10, guides };
}
