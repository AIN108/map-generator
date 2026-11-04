// 평면 기하 도구. 월드 좌표는 미터 단위이고 x는 동쪽, y는 남쪽(화면 아래쪽)이 양수다.

export type Vec2 = [number, number];
export type Poly = Vec2[];

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 짝수-홀수 규칙으로 점이 다각형 안에 있는지 판정한다. */
export function pointInPolygon(p: Vec2, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const STAR_BINS = 720;
const starCache = new WeakMap<Poly, { min: Float64Array; max: Float64Array }>();

const starBin = (x: number, y: number): number =>
  ((Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * STAR_BINS) % STAR_BINS) + STAR_BINS) % STAR_BINS;

/**
 * 원점을 품은 다각형(부지 경계·순환도로)의 빠른 안팎 판정.
 * 방향별로 경계 반지름의 최소·최대를 적어 두고, 그 범위 밖이면 바로 정하고 경계 근처에서만 정확히 판정한다.
 * 원점에서 그 점까지(또는 그 점에서 무한대까지) 경계를 만나지 않으면 원점과 같은 쪽(또는 바깥)이라는 성질만 쓰므로
 * 별 모양이 아닌 다각형에도 맞다. 다각형 배열은 바뀌지 않는다고 보고 배열마다 한 번만 준비한다.
 */
export function insideAroundOrigin(poly: Poly, x: number, y: number): boolean {
  let s = starCache.get(poly);
  if (!s) {
    const min = new Float64Array(STAR_BINS).fill(Infinity);
    const max = new Float64Array(STAR_BINS).fill(0);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.5));
      for (let k = 0; k <= steps; k++) {
        const px = a[0] + ((b[0] - a[0]) * k) / steps, py = a[1] + ((b[1] - a[1]) * k) / steps;
        const r = Math.hypot(px, py);
        const bin = starBin(px, py);
        for (let d = -1; d <= 1; d++) {
          const bb = (bin + d + STAR_BINS) % STAR_BINS;
          if (r < min[bb]) min[bb] = r;
          if (r > max[bb]) max[bb] = r;
        }
      }
    }
    s = { min, max };
    starCache.set(poly, s);
  }
  const r = Math.hypot(x, y);
  const bin = starBin(x, y);
  if (r < s.min[bin] - 1) return true;
  if (r > s.max[bin] + 1) return false;
  return pointInPolygon([x, y], poly);
}

/**
 * 중심 (cx, cy), 폭 w(국소 u축), 깊이 d(국소 v축), 회전 angle인 직사각형의 네 꼭짓점.
 * u = (cos a, sin a), v = (-sin a, cos a). 순서: (-u,-v), (+u,-v), (+u,+v), (-u,+v).
 */
export function rectCorners(cx: number, cy: number, w: number, d: number, angle: number): Poly {
  const c = Math.cos(angle), s = Math.sin(angle);
  const hw = w / 2, hd = d / 2;
  const pt = (u: number, v: number): Vec2 => [cx + u * c - v * s, cy + u * s + v * c];
  return [pt(-hw, -hd), pt(hw, -hd), pt(hw, hd), pt(-hw, hd)];
}

/** 국소 좌표 (u, v)를 회전·이동해 월드 좌표로 바꾼다. */
export function localToWorld(cx: number, cy: number, angle: number, u: number, v: number): Vec2 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [cx + u * c - v * s, cy + u * s + v * c];
}

/** 월드 좌표를 (cx, cy, angle) 기준 국소 좌표로 바꾼다. */
export function worldToLocal(cx: number, cy: number, angle: number, x: number, y: number): Vec2 {
  const c = Math.cos(angle), s = Math.sin(angle);
  const dx = x - cx, dy = y - cy;
  return [dx * c + dy * s, -dx * s + dy * c];
}

function project(poly: Poly, ax: number, ay: number): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const [x, y] of poly) {
    const p = x * ax + y * ay;
    if (p < lo) lo = p;
    if (p > hi) hi = p;
  }
  return [lo, hi];
}

/**
 * 볼록 다각형 두 개가 margin 이내로 가까운지(겹치거나 간격이 margin 미만인지) 분리축 정리로 판정한다.
 * 모서리 근처에서는 실제 거리보다 보수적으로(겹친다고) 판정할 수 있다.
 */
export function convexOverlap(a: Poly, b: Poly, margin = 0): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      let ax = -(q[1] - p[1]), ay = q[0] - p[0];
      const len = Math.hypot(ax, ay);
      if (len < 1e-9) continue;
      ax /= len; ay /= len;
      const [a0, a1] = project(a, ax, ay);
      const [b0, b1] = project(b, ax, ay);
      if (a1 + margin <= b0 || b1 + margin <= a0) return false;
    }
  }
  return true;
}

/** 점과 선분 사이 거리 */
export function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (o: Vec2, p: Vec2, q: Vec2): number => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** 다각형(볼록·오목 모두)과 선분 사이 최소 거리. 선분이 다각형을 지나거나 안에 있으면 0. */
export function polygonSegmentDistance(poly: Poly, a: Vec2, b: Vec2): number {
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    if (segmentsIntersect(p, q, a, b)) return 0;
    best = Math.min(best, segmentDistance(p, a, b), segmentDistance(a, p, q), segmentDistance(b, p, q));
  }
  return best;
}

/** 점에서 닫힌 다각형 경계까지의 거리 */
export function polygonEdgeDistance(p: Vec2, poly: Poly): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, segmentDistance(p, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

export function polygonArea(poly: Poly): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return s / 2;
}

export function centroid(points: readonly Vec2[]): Vec2 {
  let x = 0, y = 0;
  for (const p of points) { x += p[0]; y += p[1]; }
  return [x / points.length, y / points.length];
}

/** 2차원 점들의 볼록 껍질 (모노톤 체인), 반시계 방향 */
export function convexHull(points: readonly Vec2[]): Poly {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function polylineLength(line: readonly Vec2[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += dist(line[i - 1], line[i]);
  return s;
}

/** 폴리라인을 대략 step 간격의 점으로 다시 나눈다 (양 끝 포함). */
export function resample(line: readonly Vec2[], step: number): Vec2[] {
  if (line.length < 2) return line.map((p) => [p[0], p[1]] as Vec2);
  const out: Vec2[] = [[line[0][0], line[0][1]]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const len = dist(a, b);
    let t = step - carry;
    while (t < len) {
      out.push([a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len]);
      t += step;
    }
    carry = len - (t - step);
  }
  const last = line[line.length - 1];
  if (dist(out[out.length - 1], last) > step * 0.3) out.push([last[0], last[1]]);
  else out[out.length - 1] = [last[0], last[1]];
  return out;
}

/** 폴리라인 i번째 점의 단위 접선 (닫힌 선이면 앞뒤를 이어서 본다) */
export function tangentAt(line: readonly Vec2[], i: number, closed = false): Vec2 {
  const n = line.length;
  const prev = closed ? line[(i - 1 + n) % n] : line[Math.max(0, i - 1)];
  const next = closed ? line[(i + 1) % n] : line[Math.min(n - 1, i + 1)];
  const dx = next[0] - prev[0], dy = next[1] - prev[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

/**
 * 폴리라인을 halfWidth만큼 양쪽으로 넓힌 띠 다각형 (그리기용).
 * 꺾이는 곳은 접선 평균 방향으로 벌리되 지나치게 뾰족해지지 않도록 길이를 제한한다.
 * closed면 끝을 처음과 이어 고리 모양 띠를 만든다 (nonzero 채우기로 안쪽은 비어 보인다).
 */
export function ribbon(line: readonly Vec2[], halfWidth: number, closed = false): Poly {
  const n = line.length;
  const left: Vec2[] = [], right: Vec2[] = [];
  const count = closed ? n + 1 : n;
  for (let k = 0; k < count; k++) {
    const i = k % n;
    const t = tangentAt(line, i, closed);
    const nx = -t[1], ny = t[0];
    let w = halfWidth;
    if (closed || (i > 0 && i < n - 1)) {
      const a = line[(i - 1 + n) % n], b = line[i];
      const sx = b[0] - a[0], sy = b[1] - a[1];
      const l = Math.hypot(sx, sy) || 1;
      w = halfWidth / Math.max(0.5, (sx / l) * t[0] + (sy / l) * t[1]);
    }
    left.push([line[i][0] + nx * w, line[i][1] + ny * w]);
    right.push([line[i][0] - nx * w, line[i][1] - ny * w]);
  }
  return left.concat(right.reverse());
}

/** 닫힌 다각형을 Chaikin 방식으로 부드럽게 만든다. */
export function chaikinClosed(poly: Poly, iterations = 2): Poly {
  let pts = poly;
  for (let k = 0; k < iterations; k++) {
    const next: Vec2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = next;
  }
  return pts;
}

/** 열린 폴리라인을 Chaikin 방식으로 부드럽게 만든다 (양 끝점은 유지). */
export function chaikinOpen(line: readonly Vec2[], iterations = 2): Vec2[] {
  let pts = line.map((p) => [p[0], p[1]] as Vec2);
  for (let k = 0; k < iterations; k++) {
    if (pts.length < 3) return pts;
    const next: Vec2[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

/** 축 정렬 경계 상자 */
export interface Box { x0: number; y0: number; x1: number; y1: number }

export function bounds(points: readonly Vec2[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** 원점에서 각도 방향으로 쏜 반직선이 닫힌 다각형과 처음 만나는 거리 (없으면 0) */
export function rayPolygon(origin: Vec2, angle: number, poly: Poly): number {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - origin[0]) * ey - (a[1] - origin[1]) * ex) / den;
    const u = ((a[0] - origin[0]) * dy - (a[1] - origin[1]) * dx) / den;
    if (t > 1e-9 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return Number.isFinite(best) ? best : 0;
}

/** 각도를 (-π, π] 범위로 */
/**
 * 각도가 쌓여 커지지 않게: 한 바퀴(±2π) 안이면 그대로 두고(생성기의 각도·예전 저장본과 같게), 넘었을 때만 (-π, π]로 접는다.
 * 0.001 단위로 반올림.
 */
export function tidyAngle(a: number): number {
  const x = Math.abs(a) <= 2 * Math.PI + 1e-3 ? a : normAngle(a);
  return Math.round(x * 1000) / 1000 || 0;
}

export function normAngle(a: number): number {
  let x = a % (2 * Math.PI);
  if (x <= -Math.PI) x += 2 * Math.PI;
  if (x > Math.PI) x -= 2 * Math.PI;
  return x;
}
