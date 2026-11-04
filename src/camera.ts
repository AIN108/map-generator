// 원근 카메라. 남쪽 하늘에서 북쪽을 비스듬히 내려다본다.
// 월드: x 동쪽, y 남쪽, z 위 (m). 이미지: 왼쪽 위가 (0, 0)인 픽셀 좌표.

import type { Vec2 } from "./geom.ts";

export type ViewAngle = "low" | "mid" | "high";

export const PITCH_DEG: Record<ViewAngle, number> = { low: 36, mid: 47, high: 60 };
export const VIEW_KO: Record<ViewAngle, string> = { low: "낮게", mid: "보통", high: "높게" };

export interface Camera {
  /** 카메라 위치 */
  cx: number;
  cy: number;
  cz: number;
  /** 내려다보는 각 (라디안) */
  pitch: number;
  /** 초점 거리 (픽셀) */
  f: number;
  /** 화면 중심 (픽셀) */
  ox: number;
  oy: number;
  width: number;
  height: number;
}

/** [화면 x, 화면 y, 깊이(카메라 앞쪽 거리)] */
export type Projected = [number, number, number];

export function project(cam: Camera, x: number, y: number, z: number): Projected {
  const rx = x - cam.cx, ry = y - cam.cy, rz = z - cam.cz;
  const c = Math.cos(cam.pitch), s = Math.sin(cam.pitch);
  // 앞쪽 f = (0, -cos, -sin), 위쪽 u = (0, -sin, cos), 오른쪽 r = (1, 0, 0)
  const depth = -ry * c - rz * s;
  const up = -ry * s + rz * c;
  const d = Math.max(depth, 1e-3);
  return [cam.ox + (cam.f * rx) / d, cam.oy - (cam.f * up) / d, depth];
}

/** 화면 픽셀 위치에서 지면(z = groundZ)으로 쏜 광선이 만나는 점. 하늘을 가리키면 undefined. */
export function unproject(cam: Camera, sx: number, sy: number, groundZ = 0): Vec2 | undefined {
  const c = Math.cos(cam.pitch), s = Math.sin(cam.pitch);
  const a = (sx - cam.ox) / cam.f;
  const b = -(sy - cam.oy) / cam.f;
  // 방향 = 앞 + a·오른쪽 + b·위
  const dx = a;
  const dy = -c - b * s;
  const dz = -s + b * c;
  if (dz >= -1e-6) return undefined;
  const t = (groundZ - cam.cz) / dz;
  if (t <= 0) return undefined;
  return [cam.cx + dx * t, cam.cy + dy * t];
}

/** 그 지점에서 1m가 화면에서 몇 픽셀인지 (깊이 기준 근사) */
export const pixelsPerMeter = (cam: Camera, depth: number): number => cam.f / Math.max(depth, 1e-3);

/**
 * 캠퍼스 경계가 이미지의 지정 영역(top~bottom 비율)에 꽉 차도록 카메라를 맞춘다.
 * distanceFactor가 클수록 원근감이 약해진다.
 */
export function fitCamera(
  outline: readonly Vec2[], view: ViewAngle, width: number, height: number,
  region = { left: 0.025, right: 0.975, top: 0.075, bottom: 0.83 }, extraTop = 40,
): Camera {
  const pitch = (PITCH_DEG[view] * Math.PI) / 180;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of outline) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const span = Math.max(x1 - x0, (y1 - y0) * 1.2);
  const dist = span * 1.25;
  const tx = (x0 + x1) / 2, ty = (y0 + y1) / 2 + (y1 - y0) * 0.05;
  const cam: Camera = {
    cx: tx, cy: ty + dist * Math.cos(pitch), cz: dist * Math.sin(pitch), pitch, f: 1, ox: 0, oy: 0, width, height,
  };
  // f = 1, 원점 기준으로 투영한 범위를 구해 영역에 맞춘다.
  let sx0 = Infinity, sx1 = -Infinity, sy0 = Infinity, sy1 = -Infinity;
  for (const [x, y] of outline) {
    for (const z of [0, extraTop]) {
      const [sx, sy] = project(cam, x, y, z);
      sx0 = Math.min(sx0, sx); sx1 = Math.max(sx1, sx); sy0 = Math.min(sy0, sy); sy1 = Math.max(sy1, sy);
    }
  }
  const rw = (region.right - region.left) * width, rh = (region.bottom - region.top) * height;
  const f = Math.min(rw / (sx1 - sx0), rh / (sy1 - sy0));
  cam.f = f;
  cam.ox = (region.left + region.right) / 2 * width - ((sx0 + sx1) / 2) * f;
  cam.oy = (region.top + region.bottom) / 2 * height - ((sy0 + sy1) / 2) * f;
  return cam;
}

/** 수평선의 화면 y (이보다 위는 하늘) */
export const horizonY = (cam: Camera): number => cam.oy - cam.f * Math.tan(cam.pitch);
