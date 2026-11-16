// 끌기·추가 미리보기 상자: 바닥과 지붕 테두리를 오버레이에 그린다 (main.ts에서 옮김)

import { project, type Camera } from "../camera.ts";
import { rectCorners, type Vec2 } from "../geom.ts";
import { isPlace, type Building } from "../layout.ts";
import { FLOOR_H } from "../model.ts";

/** 바닥과 지붕 테두리로 상자를 그린다. scale은 지금 보기 배율 (선 굵기를 화면 기준으로 맞춘다). */
export function drawGhostBox(
  octx: CanvasRenderingContext2D, cam: Camera, scale: number,
  b: { w: number; d: number; floors: number; shape: Building["shape"] }, x: number, y: number, angle: number, valid: boolean, faint = false,
): void {
  const lw = 1 / scale;
  const poly = rectCorners(x, y, b.w, b.d, angle);
  const hgt = isPlace(b) ? 0.5 : Math.max(4, b.floors * FLOOR_H);
  const P = (p: Vec2, z: number): [number, number] => { const q = project(cam, p[0], p[1], z); return [q[0], q[1]]; };
  const color = faint ? "rgba(255,255,255,0.75)" : valid ? "rgba(60,200,120,0.95)" : "rgba(230,60,60,0.95)";
  octx.setLineDash(faint ? [5 * lw, 4 * lw] : []);
  if (!faint) {
    octx.fillStyle = valid ? "rgba(60,200,120,0.2)" : "rgba(230,60,60,0.2)";
    octx.beginPath();
    poly.forEach((p, i) => { const [px, py] = P(p, 0); if (i === 0) octx.moveTo(px, py); else octx.lineTo(px, py); });
    octx.fill();
  }
  octx.beginPath();
  for (const z of faint ? [0] : [0, hgt]) {
    poly.forEach((p, i) => { const [px, py] = P(p, z); if (i === 0) octx.moveTo(px, py); else octx.lineTo(px, py); });
    octx.closePath();
  }
  if (!faint) for (const p of poly) { const a = P(p, 0), c = P(p, hgt); octx.moveTo(a[0], a[1]); octx.lineTo(c[0], c[1]); }
  octx.lineWidth = (faint ? 1.5 : 2) * lw;
  octx.strokeStyle = color;
  octx.stroke();
  octx.setLineDash([]);
}
