// 지도 위 치수선 (고른 건물의 폭·깊이·높이)

import { project, type Camera } from "../camera.ts";
import { localToWorld } from "../geom.ts";
import type { Building } from "../layout.ts";

/**
 * 고른 건물의 치수선 (도면처럼): 카메라에 가까운 쪽 변에 폭·깊이, 가까운 모서리에 높이.
 * lw는 지도 좌표에서 화면 1px에 해당하는 길이, top은 높이(m, 없으면 높이 치수를 그리지 않음).
 */
export function drawDimensions(c: CanvasRenderingContext2D, cam: Camera, b: Building, lw: number, top?: number): void {
  const hw = b.w / 2, hd = b.d / 2, off = 6;
  const P = (u: number, v: number, z = 0.4): [number, number] => {
    const w = localToWorld(b.x, b.y, b.angle, u, v);
    const q = project(cam, w[0], w[1], z);
    return [q[0], q[1]];
  };
  // 화면에서 아래(카메라 쪽)에 있는 변을 고른다. 비슷하면 오른쪽.
  const sv = P(0, hd)[1] >= P(0, -hd)[1] ? 1 : -1;
  const ru = P(hw, 0), lu = P(-hw, 0);
  const su = Math.abs(ru[1] - lu[1]) > 4 ? (ru[1] > lu[1] ? 1 : -1) : ru[0] >= lu[0] ? 1 : -1;
  const ink = "#1b2a5c";
  const line = (pts: [number, number][]): void => {
    for (const [color, width] of [["rgba(255,255,255,0.9)", 3.4], [ink, 1.3]] as const) {
      c.beginPath();
      pts.forEach(([x, y], k) => (k === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
      c.strokeStyle = color;
      c.lineWidth = width * lw;
      c.stroke();
    }
  };
  const tag = (text: string, x: number, y: number): void => {
    c.font = `600 ${11 * lw}px ui-monospace, Menlo, Consolas, monospace`;
    const tw = c.measureText(text).width + 8 * lw, th = 15 * lw;
    c.fillStyle = "rgba(255,255,255,0.95)";
    c.strokeStyle = ink;
    c.lineWidth = 1 * lw;
    c.beginPath();
    c.rect(x - tw / 2, y - th / 2, tw, th);
    c.fill();
    c.stroke();
    c.fillStyle = ink;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, x, y + 0.5 * lw);
  };
  const tickAt = (p: [number, number], q: [number, number]): [number, number][] => {
    // 치수선 끝의 빗금 (선 방향에 45°)
    const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
    const ux = dx / l, uy = dy / l, k = 4.5 * lw;
    return [[p[0] - (ux + uy) * k, p[1] - (uy - ux) * k], [p[0] + (ux + uy) * k, p[1] + (uy - ux) * k]];
  };
  const dim = (a: [number, number], b2: [number, number], ea: [number, number], eb: [number, number], text: string): void => {
    line([ea, a]);
    line([eb, b2]);
    line([a, b2]);
    line(tickAt(a, b2));
    line(tickAt(b2, a));
    tag(text, (a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2);
  };
  const m1 = (v: number): string => `${(Math.round(v * 10) / 10).toFixed(1)} m`;
  // 폭: 정면(또는 뒤) 변 바깥
  dim(P(-hw, sv * (hd + off)), P(hw, sv * (hd + off)), P(-hw, sv * (hd + 1)), P(hw, sv * (hd + 1)), m1(b.w));
  // 깊이: 옆 변 바깥
  dim(P(su * (hw + off), -hd), P(su * (hw + off), hd), P(su * (hw + 1), -hd), P(su * (hw + 1), hd), m1(b.d));
  // 높이: 가까운 모서리
  if (top !== undefined) {
    const u = su * (hw + 2.5), v = sv * (hd + 2.5);
    const g = P(u, v, 0), t = P(u, v, top);
    line([g, t]);
    line(tickAt(g, t));
    line(tickAt(t, g));
    tag(`H ${Math.round(top)} m`, t[0], t[1] - 11 * lw);
  }
}
