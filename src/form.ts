// 건물 모양의 세부 조절 값(날개 폭·뒤 동 깊이·저층부 등)과 자유형 평면(칸마다 층수).
// 값을 정하지 않은 건물은 모양별 기본 비율을 써서, 예전 배치와 똑같이 그려진다.

import type { Shape } from "./catalog.ts";
import type { Vec2 } from "./geom.ts";

/** 자유형 평면: 바닥 상자를 cols×rows 칸으로 나누고 칸마다 층수(0은 빈칸)를 적는다. 첫 줄이 뒤(북쪽, 정면 반대)다. */
export interface FormGrid { cols: number; rows: number; cells: number[] }

export interface BuildingForm {
  /** 날개·탑·중정 둘레 동의 폭 (모양마다 기준 길이에 대한 비율) */
  wing?: number;
  /** 뒤 동·탑의 깊이 (깊이에 대한 비율) */
  depth?: number;
  /** 좌우 뒤집기 */
  flip?: boolean;
  /** 저층부 층수 */
  podium?: number;
  /** 지붕 (없으면 외관을 따른다: 벽돌·고전은 경사 지붕) */
  roof?: "flat" | "hip";
  /** 자유형 평면 */
  grid?: FormGrid;
}

export const GRID_MAX = 24;
export const CELL_MAX_FLOORS = 25;

export interface RatioSpec {
  label: string;
  /** 비율의 기준 길이: 폭·깊이·짧은 변 */
  base: "w" | "d" | "min";
  lo: number;
  hi: number;
  def: number;
}

export interface FormSpec {
  wing?: RatioSpec;
  depth?: RatioSpec;
  /** 좌우 뒤집기를 쓰는 모양 */
  flip?: boolean;
  /** 저층부 층수를 쓰는 모양 (기본값은 층수로 정한다) */
  podium?: (floors: number) => number;
  /** 지붕을 고를 수 있는 모양 */
  roof?: boolean;
}

/** 모양별로 조절할 수 있는 값과 기본값 (기본값은 예전의 고정 비율) */
export const FORM_SPEC: Partial<Record<Shape, FormSpec>> = {
  bar: { roof: true },
  L: {
    wing: { label: "앞 날개 폭", base: "w", lo: 0.15, hi: 0.6, def: 0.3 },
    depth: { label: "뒤 동 깊이", base: "d", lo: 0.25, hi: 0.85, def: 0.55 },
    flip: true, roof: true,
  },
  U: {
    wing: { label: "날개 폭", base: "w", lo: 0.12, hi: 0.4, def: 0.27 },
    depth: { label: "뒤 동 깊이", base: "d", lo: 0.2, hi: 0.8, def: 0.42 },
    roof: true,
  },
  court: { wing: { label: "동 두께", base: "min", lo: 0.12, hi: 0.42, def: 0.3 }, roof: true },
  wings: { wing: { label: "가운데 동 폭", base: "w", lo: 0.2, hi: 0.7, def: 0.4 } },
  atrium: { wing: { label: "아트리움 폭", base: "w", lo: 0.2, hi: 0.9, def: 0.44 } },
  stepped: {
    wing: { label: "윗부분 폭", base: "w", lo: 0.4, hi: 0.95, def: 0.78 },
    podium: (f) => Math.max(2, f - 2),
  },
  twin: { wing: { label: "탑 폭", base: "w", lo: 0.2, hi: 0.48, def: 0.36 }, podium: () => 2 },
  tower: {
    wing: { label: "탑 폭", base: "w", lo: 0.3, hi: 1, def: 0.6 },
    depth: { label: "탑 깊이", base: "d", lo: 0.3, hi: 1, def: 0.8 },
    podium: () => 2, roof: true,
  },
  hospital: { flip: true, podium: () => 3 },
};

export interface ResolvedForm {
  wing: number;
  depth: number;
  flip: boolean;
  podium: number;
  /** 정하지 않았으면 undefined (외관을 따름) */
  roof?: "flat" | "hip";
}

interface FormHost { shape: Shape; floors: number; variant: number; form?: BuildingForm }

/** 실제로 쓸 값 (정하지 않은 값은 기본값, 범위 밖은 잘라 낸다) */
export function resolveForm(b: FormHost): ResolvedForm {
  const spec = FORM_SPEC[b.shape] ?? {};
  const f = b.form ?? {};
  const ratio = (s: RatioSpec | undefined, v: number | undefined): number =>
    s ? Math.max(s.lo, Math.min(s.hi, v ?? s.def)) : 0;
  const podDef = spec.podium ? spec.podium(b.floors) : 0;
  const podium = spec.podium ? Math.max(1, Math.min(Math.max(1, b.floors - 1), Math.round(f.podium ?? podDef))) : 0;
  return {
    wing: ratio(spec.wing, f.wing),
    depth: ratio(spec.depth, f.depth),
    flip: f.flip ?? b.variant > 0.5,
    podium,
    roof: spec.roof ? f.roof : undefined,
  };
}

// ── 자유형 평면 ──────────────────────────────────────────────────────
export const gridMax = (g: FormGrid): number => g.cells.reduce((m, v) => Math.max(m, v), 0);

/** 칸 수를 바꾼다 (가장 가까운 칸 값을 가져온다) */
export function resampleGrid(g: FormGrid, cols: number, rows: number): FormGrid {
  const c = Math.max(1, Math.min(GRID_MAX, Math.round(cols))), r = Math.max(1, Math.min(GRID_MAX, Math.round(rows)));
  const cells: number[] = [];
  for (let j = 0; j < r; j++) {
    for (let i = 0; i < c; i++) {
      const si = Math.min(g.cols - 1, Math.floor(((i + 0.5) / c) * g.cols));
      const sj = Math.min(g.rows - 1, Math.floor(((j + 0.5) / r) * g.rows));
      cells.push(g.cells[sj * g.cols + si]);
    }
  }
  return { cols: c, rows: r, cells };
}

/**
 * 조건을 만족하는 칸들의 합집합 윤곽선 (칸 단위 좌표, 첫 줄이 위).
 * 바깥 고리와 구멍을 나눠 돌려준다. 꼭짓점만 맞닿은 칸은 따로 떨어진 덩어리로 본다.
 */
export function gridRings(g: FormGrid, filled: (v: number) => boolean): { outer: Vec2[]; holes: Vec2[][] }[] {
  const { cols, rows } = g;
  const on = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < cols && j < rows && filled(g.cells[j * cols + i]);
  // 칸 둘레를 시계 방향(화면 좌표, y 아래)으로 도는 변 가운데 이웃이 빈 변만 남긴다. 안쪽이 진행 방향의 오른쪽이다.
  const edges = new Map<number, [number, number, number, number][]>();
  const key = (x: number, y: number): number => y * (cols + 1) + x;
  const add = (x0: number, y0: number, x1: number, y1: number): void => {
    const k = key(x0, y0);
    const list = edges.get(k);
    if (list) list.push([x0, y0, x1, y1]); else edges.set(k, [[x0, y0, x1, y1]]);
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (!on(i, j)) continue;
      if (!on(i, j - 1)) add(i, j, i + 1, j);
      if (!on(i + 1, j)) add(i + 1, j, i + 1, j + 1);
      if (!on(i, j + 1)) add(i + 1, j + 1, i, j + 1);
      if (!on(i - 1, j)) add(i, j + 1, i, j);
    }
  }
  const loops: Vec2[][] = [];
  for (;;) {
    let start: [number, number, number, number] | undefined;
    for (const list of edges.values()) if (list.length) { start = list.pop(); break; }
    if (!start) break;
    const pts: Vec2[] = [[start[0], start[1]]];
    let cur = start;
    for (let guard = 0; guard < 4 * (cols + 1) * (rows + 1) + 8; guard++) {
      const [, , x1, y1] = cur;
      if (x1 === start[0] && y1 === start[1]) break;
      pts.push([x1, y1]);
      const list = edges.get(key(x1, y1));
      if (!list || !list.length) break;
      // 꼭짓점에서 갈 길이 둘이면 오른쪽(안쪽)으로 꺾는 변을 먼저 고른다.
      const dx = x1 - cur[0], dy = y1 - cur[1];
      const rank = (e: [number, number, number, number]): number => {
        const ex = e[2] - e[0], ey = e[3] - e[1];
        if (ex === -dy && ey === dx) return 0;
        if (ex === dx && ey === dy) return 1;
        return 2;
      };
      let best = 0;
      for (let k = 1; k < list.length; k++) if (rank(list[k]) < rank(list[best])) best = k;
      cur = list.splice(best, 1)[0];
    }
    // 한 직선 위의 꼭짓점은 뺀다.
    const simple = pts.filter((p, k) => {
      const a = pts[(k - 1 + pts.length) % pts.length], c = pts[(k + 1) % pts.length];
      return (p[0] - a[0]) * (c[1] - p[1]) - (p[1] - a[1]) * (c[0] - p[0]) !== 0;
    });
    if (simple.length >= 3) loops.push(simple);
  }
  const area = (r: Vec2[]): number => {
    let s = 0;
    for (let k = 0; k < r.length; k++) { const a = r[k], b = r[(k + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; }
    return s / 2;
  };
  // 화면 좌표(y 아래)에서 시계 방향 → 넓이 양수가 바깥, 음수가 구멍
  const outers = loops.filter((r) => area(r) > 0).map((outer) => ({ outer, holes: [] as Vec2[][] }));
  const inside = (p: Vec2, poly: Vec2[]): boolean => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  for (const h of loops.filter((r) => area(r) < 0)) {
    const mid: Vec2 = [(h[0][0] + h[1][0]) / 2, (h[0][1] + h[1][1]) / 2];
    // 가장 작은(안쪽) 바깥 고리에 넣는다
    const host = outers.filter((o) => inside(mid, o.outer)).sort((a, b) => area(a.outer) - area(b.outer))[0];
    if (host) host.holes.push(h);
  }
  return outers;
}

/** 목록 글에 쓰는 칸 층수 기호 (0~9, a~p = 10~25) */
const CELL_CHARS = "0123456789abcdefghijklmnop";

export function gridToText(g: FormGrid): string {
  const rows: string[] = [];
  for (let j = 0; j < g.rows; j++) rows.push(g.cells.slice(j * g.cols, (j + 1) * g.cols).map((v) => CELL_CHARS[v] ?? "0").join(""));
  return `${g.cols}x${g.rows} ${rows.join("/")}`;
}

export function gridFromText(t: string): FormGrid | undefined {
  const m = /^(\d{1,2})\s*[x×]\s*(\d{1,2})\s+([0-9a-p/]+)$/i.exec(t.trim());
  if (!m) return undefined;
  const cols = Number(m[1]), rows = Number(m[2]);
  const lines = m[3].toLowerCase().split("/");
  if (cols < 1 || rows < 1 || cols > GRID_MAX || rows > GRID_MAX || lines.length !== rows || lines.some((l) => l.length !== cols)) return undefined;
  const cells = lines.join("").split("").map((c) => CELL_CHARS.indexOf(c));
  return checkGrid({ cols, rows, cells });
}

/** 칸 값이 올바르면 그대로, 아니면 undefined */
export function checkGrid(raw: unknown): FormGrid | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const g = raw as Record<string, unknown>;
  const cols = g.cols, rows = g.rows, cells = g.cells;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || !Array.isArray(cells)) return undefined;
  const c = cols as number, r = rows as number;
  if (c < 1 || r < 1 || c > GRID_MAX || r > GRID_MAX || cells.length !== c * r) return undefined;
  if (!cells.every((v) => Number.isInteger(v) && v >= 0 && v <= CELL_MAX_FLOORS)) return undefined;
  if (!cells.some((v) => v > 0)) return undefined;
  return { cols: c, rows: r, cells: [...(cells as number[])] };
}

/** 저장 파일의 form 값을 검사한다. 알 수 없는 값은 버리고, 틀린 값이면 오류. */
export function checkForm(raw: unknown, shape: Shape): BuildingForm | undefined {
  if (raw === undefined) {
    if (shape === "custom") throw new Error("자유형 건물에 평면이 없습니다.");
    return undefined;
  }
  if (!raw || typeof raw !== "object") throw new Error("모양 조절 값이 올바르지 않습니다.");
  const f = raw as Record<string, unknown>;
  const out: BuildingForm = {};
  const ratio = (v: unknown): number | undefined => {
    if (v === undefined) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0.05 || v > 1) throw new Error("모양 조절 값이 올바르지 않습니다.");
    return v;
  };
  const wing = ratio(f.wing), depth = ratio(f.depth);
  if (wing !== undefined) out.wing = wing;
  if (depth !== undefined) out.depth = depth;
  if (f.flip !== undefined) out.flip = f.flip === true;
  if (f.podium !== undefined) {
    if (!Number.isInteger(f.podium) || (f.podium as number) < 1 || (f.podium as number) > 24) throw new Error("저층부 층수가 올바르지 않습니다.");
    out.podium = f.podium as number;
  }
  if (f.roof !== undefined) {
    if (f.roof !== "flat" && f.roof !== "hip") throw new Error("지붕 값이 올바르지 않습니다.");
    out.roof = f.roof;
  }
  if (f.grid !== undefined) {
    const g = checkGrid(f.grid);
    if (!g) throw new Error("자유형 평면 값이 올바르지 않습니다.");
    out.grid = g;
  }
  if (shape === "custom" && !out.grid) throw new Error("자유형 건물에 평면이 없습니다.");
  return Object.keys(out).length ? out : undefined;
}

export const cloneForm = (f: BuildingForm | undefined): BuildingForm | undefined =>
  f ? { ...f, ...(f.grid ? { grid: { ...f.grid, cells: [...f.grid.cells] } } : {}) } : undefined;

// ── 목록 글의 '형태' 칸 ──────────────────────────────────────────────
/** 형태 칸 글 (예: '날개30 깊이55 반전 저층2 경사지붕'). 정한 값이 없으면 빈 문자열. */
export function formToText(f: BuildingForm | undefined): string {
  if (!f) return "";
  const out: string[] = [];
  if (f.wing !== undefined) out.push(`날개${Math.round(f.wing * 100)}`);
  if (f.depth !== undefined) out.push(`깊이${Math.round(f.depth * 100)}`);
  if (f.flip !== undefined) out.push(f.flip ? "반전" : "정방향");
  if (f.podium !== undefined) out.push(`저층${f.podium}`);
  if (f.roof) out.push(f.roof === "hip" ? "경사지붕" : "평지붕");
  return out.join(" ");
}

export function formFromText(t: string): Omit<BuildingForm, "grid"> | undefined {
  const out: BuildingForm = {};
  for (const w of t.trim().split(/\s+/)) {
    let m: RegExpExecArray | null;
    if ((m = /^날개(\d{1,3})%?$/.exec(w))) out.wing = Math.max(5, Math.min(100, Number(m[1]))) / 100;
    else if ((m = /^깊이(\d{1,3})%?$/.exec(w))) out.depth = Math.max(5, Math.min(100, Number(m[1]))) / 100;
    else if ((m = /^저층(\d{1,2})(?:층)?$/.exec(w))) out.podium = Math.max(1, Math.min(24, Number(m[1])));
    else if (w === "반전") out.flip = true;
    else if (w === "정방향") out.flip = false;
    else if (w === "경사지붕") out.roof = "hip";
    else if (w === "평지붕") out.roof = "flat";
    else return undefined;
  }
  return Object.keys(out).length ? out : undefined;
}
