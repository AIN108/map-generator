// 건물 내부 층 평면: 층마다 바닥(덩어리 단면)을 직사각형 동으로 나누고, 동마다 복도와 실을 배치해 호실 번호를 매긴다.
// 건물 모양·크기·종류로만 정해지므로 같은 건물이면 늘 같은 평면이 나온다. 호실 이름은 건물에 따로 저장한다(Building.rooms).

import type { Vec2 } from "./geom.ts";
import { isPlace, type Building } from "./layout.ts";
import { FLOOR_H, planMasses, type PlanMass } from "./model.ts";

export type RoomKind = "room" | "hall" | "stair" | "core" | "lobby" | "corridor" | "void";

export interface Room {
  /** 호실 번호 (예: "312"). 계단·복도 등에는 없다 */
  no?: string;
  kind: RoomKind;
  /** 기본 용도 이름 (강의실·연구실 …) */
  label: string;
  /** 국소 좌표 다각형 */
  poly: Vec2[];
}

export interface FloorPlan {
  floor: number;
  /** 이 층의 바닥 덩어리 (윤곽) */
  outline: PlanMass[];
  rooms: Room[];
}

type Rect = [number, number, number, number];

interface SideSpec { name: string; module: number }
interface Program { a: SideSpec; b: SideSpec; ground?: Partial<Record<"a" | "b", SideSpec>>; top?: Partial<Record<"a" | "b", SideSpec>> }

const P = (a: [string, number], b: [string, number], ground?: [string, number][], top?: [string, number][]): Program => ({
  a: { name: a[0], module: a[1] },
  b: { name: b[0], module: b[1] },
  ground: ground ? { a: ground[0] && { name: ground[0][0], module: ground[0][1] }, b: ground[1] && { name: ground[1][0], module: ground[1][1] } } : undefined,
  top: top ? { a: top[0] && { name: top[0][0], module: top[0][1] }, b: top[1] && { name: top[1][0], module: top[1][1] } } : undefined,
});

const LECTURE = P(["교수 연구실", 4.5], ["강의실", 9], [["강의실", 9], ["강의실", 9]], [["세미나실", 7.2], ["교수 연구실", 4.5]]);
const LAB = P(["연구실", 4.5], ["실험실", 7.2], [["공용 실험실", 9], ["실험실", 7.2]]);
const DORM = P(["호실", 3.6], ["호실", 3.6], [["휴게실", 7.2], ["세탁실", 4.5]]);
const OFFICE = P(["사무실", 4.5], ["사무실", 6], undefined, [["회의실", 9], ["사무실", 6]]);

const PROGRAMS: Record<string, Program> = {
  admin: P(["사무실", 4.5], ["행정실", 7.2], [["민원실", 9], ["행정실", 7.2]], [["총장실", 9], ["대회의실", 12]]),
  library: P(["그룹 스터디실", 3.6], ["열람실", 14], [["대출·반납실", 9], ["자료실", 12]], [["사무실", 4.5], ["열람실", 14]]),
  union: P(["동아리방", 3.6], ["세미나실", 7.2], [["매점·서점", 7.2], ["학생식당", 18]]),
  welfare: P(["상담실", 4.5], ["세미나실", 7.2], [["보건소", 7.2], ["식당", 18]]),
  hospital: P(["진료실", 4.5], ["병실", 4.5], [["외래 진료실", 4.5], ["검사실", 7.2]]),
  museum: P(["수장고", 7.2], ["전시실", 12]),
  music: P(["연습실", 3.6], ["레슨실", 4.5], [["연습실", 3.6], ["합주실", 9]]),
  dorm: DORM, intlDorm: DORM, dorm2: DORM,
  intlCenter: P(["게스트룸", 4.5], ["게스트룸", 4.5], [["사무실", 6], ["라운지", 9]]),
  faculty: OFFICE,
  eng1: LAB, eng2: LAB, eng3: LAB, sci1: LAB, sci2: LAB, lifesci: LAB, pharmacy: LAB, med: LAB, nursingLab: LAB,
  research: P(["사무실", 4.5], ["창업 보육실", 7.2]), computing: P(["사무실", 4.5], ["전산실", 12]), sw: P(["연구실", 4.5], ["실습실", 9]),
  design: P(["연구실", 4.5], ["작업실", 9]),
};
const programFor = (type: string): Program => PROGRAMS[type] ?? LECTURE;

const CORRIDOR_DOUBLE = 2.4, CORRIDOR_SINGLE = 2.1, STAIR = 4;
const rectPoly = ([u0, v0, u1, v1]: Rect): Vec2[] => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

function inside(p: Vec2, r: readonly Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 이 층에 있는 덩어리 (층 가운데 높이가 덩어리 안에 드는 것) */
export function floorMasses(b: Building, floor: number): PlanMass[] {
  const z = (floor - 0.5) * FLOOR_H;
  return planMasses(b).filter((m) => m.z0 <= z + 1e-6 && z < m.z1 - 1e-6);
}

/** 직각 다각형들의 합집합을 직사각형 몇 개로 나눈다 (가로로 이은 뒤 같은 폭끼리 세로로 잇는다) */
export function decompose(masses: readonly PlanMass[]): Rect[] {
  const us = new Set<number>(), vs = new Set<number>();
  const r3 = (x: number): number => Math.round(x * 1000) / 1000;
  for (const m of masses) for (const ring of [m.outer, ...m.holes]) for (const [u, v] of ring) { us.add(r3(u)); vs.add(r3(v)); }
  const U = [...us].sort((a, b) => a - b), V = [...vs].sort((a, b) => a - b);
  if (U.length < 2 || V.length < 2) return [];
  const filled = (i: number, j: number): boolean => {
    const p: Vec2 = [(U[i] + U[i + 1]) / 2, (V[j] + V[j + 1]) / 2];
    return masses.some((m) => inside(p, m.outer) && !m.holes.some((h) => inside(p, h)));
  };
  // 줄마다 이어진 칸 묶음
  const runs: { j: number; i0: number; i1: number }[] = [];
  for (let j = 0; j + 1 < V.length; j++) {
    let i = 0;
    while (i + 1 < U.length) {
      if (!filled(i, j)) { i++; continue; }
      let k = i;
      while (k + 1 < U.length - 1 && filled(k + 1, j)) k++;
      runs.push({ j, i0: i, i1: k });
      i = k + 1;
    }
  }
  // 바로 위 줄에 같은 폭의 묶음이 있으면 잇는다
  const rects: Rect[] = [];
  const open = new Map<string, Rect>();
  for (let j = 0; j + 1 < V.length; j++) {
    const row = runs.filter((r) => r.j === j);
    const next = new Map<string, Rect>();
    for (const r of row) {
      const key = `${r.i0}:${r.i1}`;
      const prev = open.get(key);
      if (prev && prev[3] === V[j]) { prev[3] = V[j + 1]; next.set(key, prev); open.delete(key); }
      else next.set(key, [U[r.i0], V[j], U[r.i1 + 1], V[j + 1]]);
    }
    for (const r of open.values()) rects.push(r);
    open.clear();
    for (const [k, r] of next) open.set(k, r);
  }
  for (const r of open.values()) rects.push(r);
  return rects.filter((r) => r[2] - r[0] > 0.5 && r[3] - r[1] > 0.5);
}

/** 길이 len을 module 정도 폭의 칸 n개로 나눈 경계들 */
function splits(a: number, b: number, module: number): number[] {
  const n = Math.max(1, Math.round((b - a) / module));
  return Array.from({ length: n + 1 }, (_, k) => a + ((b - a) * k) / n);
}

/** 특수 모양: 체육관·공연장·원형 */
function specialFloor(b: Building, floor: number, outline: PlanMass[]): Room[] | undefined {
  const hw = b.w / 2, hd = b.d / 2;
  if (b.shape === "gym") {
    if (floor === 1) {
      const back = -hd + Math.min(10, b.d * 0.2);
      const rooms: Room[] = [{ kind: "hall", label: "경기장", poly: rectPoly([-hw + 4, back, hw - 4, hd - 4]) }];
      const xs = splits(-hw, hw, b.w / 4);
      const names = ["탈의실", "샤워실", "체력단련실", "사무실"];
      for (let k = 0; k + 1 < xs.length; k++) rooms.push({ kind: "room", label: names[k % names.length], poly: rectPoly([xs[k], -hd, xs[k + 1], back]) });
      rooms.push({ kind: "stair", label: "계단", poly: rectPoly([-hw, back, -hw + 4, back + 6]) }, { kind: "stair", label: "계단", poly: rectPoly([hw - 4, back, hw, back + 6]) });
      return rooms;
    }
    return [
      { kind: "void", label: "경기장 (트임)", poly: rectPoly([-hw + 8, -hd + 8, hw - 8, hd - 8]) },
      { kind: "hall", label: "관람석", poly: rectPoly([-hw, hd - 8, hw, hd]) },
      { kind: "hall", label: "관람석", poly: rectPoly([-hw, -hd, hw, -hd + 8]) },
    ];
  }
  if (b.shape === "hall") {
    if (floor === 1) {
      return [
        { kind: "lobby", label: "로비", poly: rectPoly([-hw * 0.8, hd - 10, hw * 0.8, hd]) },
        { kind: "hall", label: "객석", poly: rectPoly([-hw, -hd + 14, hw, hd - 10]) },
        { kind: "hall", label: "무대", poly: rectPoly([-hw * 0.45, -hd, hw * 0.45, -hd + 14]) },
        { kind: "room", label: "분장실", poly: rectPoly([-hw, -hd, -hw * 0.45, -hd + 14]) },
        { kind: "room", label: "분장실", poly: rectPoly([hw * 0.45, -hd, hw, -hd + 14]) },
      ];
    }
    if (floor === 2) return [{ kind: "hall", label: "2층 객석", poly: rectPoly([-hw, hd * 0.1, hw, hd - 10]) }, { kind: "void", label: "객석 (트임)", poly: rectPoly([-hw, -hd + 14, hw, hd * 0.1]) }];
    return [{ kind: "room", label: "조명·음향실", poly: rectPoly([-hw * 0.5, -hd + 14, hw * 0.5, -hd + 24]) }];
  }
  if (b.shape === "round") {
    const ring = outline[0]?.outer ?? [];
    if (!ring.length) return [];
    const r = Math.min(b.w, b.d) / 2;
    const inner = ring.map(([u, v]) => [u * 0.55, v * 0.55] as Vec2);
    return [
      { kind: "hall", label: floor === 1 ? "원형 공연장" : "실기실", poly: inner },
      { kind: "corridor", label: "", poly: ring },
      { kind: "stair", label: "계단", poly: rectPoly([r * 0.62, -2, r * 0.9, 2]) },
    ];
  }
  return undefined;
}

/** 층 평면. floor는 1부터 (지상 1층) */
export function floorPlan(b: Building, floor: number): FloorPlan {
  const outline = floorMasses(b, floor);
  if (isPlace(b) || !outline.length) return { floor, outline, rooms: [] };
  const special = specialFloor(b, floor, outline);
  if (special) return { floor, outline, rooms: number(special, floor) };

  const prog = programFor(b.type);
  const top = floor === b.floors && b.floors > 2;
  const side = (k: "a" | "b"): SideSpec => (floor === 1 ? prog.ground?.[k] : top ? prog.top?.[k] : undefined) ?? prog[k];
  const wings = decompose(outline).sort((p, q) => p[1] - q[1] || p[0] - q[0]);
  const rooms: Room[] = [];
  const area = (r: Rect): number => (r[2] - r[0]) * (r[3] - r[1]);
  const biggest = wings.reduce((best, r, k) => (area(r) > area(wings[best]) ? k : best), 0);
  // 정면(+v) 가운데에 가장 가까운 동에 로비
  const lobbyWing = floor === 1 ? wings.reduce((best, r, k) => {
    const d = (x: Rect): number => Math.abs((x[0] + x[2]) / 2) / b.w + (b.d / 2 - x[3]) / b.d;
    return d(r) < d(wings[best]) ? k : best;
  }, 0) : -1;

  wings.forEach((r, wi) => {
    const [u0, v0, u1, v1] = r;
    const horiz = u1 - u0 >= v1 - v0;
    const L = horiz ? u1 - u0 : v1 - v0, D = horiz ? v1 - v0 : u1 - u0;
    // 국소 좌표 (a: 긴 축, c: 짧은 축) → (u, v)
    const R = (a0: number, c0: number, a1: number, c1: number): Vec2[] => rectPoly(horiz ? [a0, c0, a1, c1] : [c0, a0, c1, a1]);
    const A0 = horiz ? u0 : v0, A1 = horiz ? u1 : v1, C0 = horiz ? v0 : u0, C1 = horiz ? v1 : u1;
    // 계단: 긴 동은 양 끝, 중간 길이는 한쪽 끝
    let a0 = A0, a1 = A1;
    if (L >= 30) {
      rooms.push({ kind: "stair", label: "계단", poly: R(A0, C0, A0 + STAIR, C1) }, { kind: "stair", label: "계단", poly: R(A1 - STAIR, C0, A1, C1) });
      a0 += STAIR; a1 -= STAIR;
    } else if (L >= 16 && (wings.length === 1 || wi === biggest)) {
      rooms.push({ kind: "stair", label: "계단", poly: R(A1 - STAIR, C0, A1, C1) });
      a1 -= STAIR;
    }
    // 복도: 깊으면 가운데(양쪽 실), 보통이면 건물 가운데 쪽 한 줄, 얕으면 없음
    const sides: { c0: number; c1: number; spec: SideSpec }[] = [];
    if (D >= 14) {
      const m = (C0 + C1) / 2;
      rooms.push({ kind: "corridor", label: "", poly: R(a0, m - CORRIDOR_DOUBLE / 2, a1, m + CORRIDOR_DOUBLE / 2) });
      sides.push({ c0: C0, c1: m - CORRIDOR_DOUBLE / 2, spec: side("a") }, { c0: m + CORRIDOR_DOUBLE / 2, c1: C1, spec: side("b") });
    } else if (D >= 7.5) {
      // 건물 가운데(0,0)에 가까운 쪽에 복도. 일자형처럼 같으면 뒤쪽(북쪽)
      const centerSide = Math.abs(C0) < Math.abs(C1) - 0.5 ? 0 : Math.abs(C1) < Math.abs(C0) - 0.5 ? 1 : 0;
      if (centerSide === 0) {
        rooms.push({ kind: "corridor", label: "", poly: R(a0, C0, a1, C0 + CORRIDOR_SINGLE) });
        sides.push({ c0: C0 + CORRIDOR_SINGLE, c1: C1, spec: side("b") });
      } else {
        rooms.push({ kind: "corridor", label: "", poly: R(a0, C1 - CORRIDOR_SINGLE, a1, C1) });
        sides.push({ c0: C0, c1: C1 - CORRIDOR_SINGLE, spec: side("b") });
      }
    } else {
      sides.push({ c0: C0, c1: C1, spec: side("b") });
    }
    sides.forEach((sd, si) => {
      const cuts = splits(a0, a1, sd.spec.module);
      const cells = cuts.slice(0, -1).map((c, k) => [c, cuts[k + 1]] as [number, number]);
      // 코어(엘리베이터·화장실): 가장 큰 동의 뒤쪽 줄 가운데
      const coreAt = wi === biggest && si === 0 && cells.length >= 3 ? Math.floor(cells.length / 2) : -1;
      // 로비: 정면 쪽 줄 가운데
      const front = si === sides.length - 1;
      const lobbyAt = wi === lobbyWing && front && horiz ? cells.reduce((best, c, k) => (Math.abs((c[0] + c[1]) / 2) < Math.abs((cells[best][0] + cells[best][1]) / 2) ? k : best), 0) : -1;
      const ordered = si === 0 ? cells : [...cells].reverse();
      for (const [x0, x1] of ordered) {
        const k = cells.findIndex((c) => c[0] === x0);
        const kind: RoomKind = k === coreAt ? "core" : k === lobbyAt ? "lobby" : "room";
        rooms.push({ kind, label: kind === "core" ? "EV·화장실" : kind === "lobby" ? "로비" : sd.spec.name, poly: R(x0, sd.c0, x1, sd.c1) });
      }
    });
  });
  return { floor, outline, rooms: number(rooms, floor) };
}

/** 번호를 매긴다: 실(room·hall)만, 층 번호 + 두 자리 (101, 102 …) */
function number(rooms: Room[], floor: number): Room[] {
  let k = 0;
  for (const r of rooms) if (r.kind === "room" || r.kind === "hall") r.no = `${floor}${String(++k).padStart(2, "0")}`;
  return rooms;
}

/** 호실 표시 이름: 손으로 붙인 이름이 있으면 그것 */
export const roomTitle = (b: Pick<Building, "rooms">, r: Room): string => (r.no && b.rooms?.[r.no]) || r.label;

/** 건물의 모든 층 (지상 1층부터) */
export function floorsOf(b: Building): number[] {
  if (isPlace(b)) return [];
  return Array.from({ length: Math.max(1, b.floors) }, (_, k) => k + 1).filter((f) => floorMasses(b, f).length);
}

/** 호실 번호가 이 건물에 있는가 */
export function hasRoom(b: Building, no: string): boolean {
  const f = Number(no.slice(0, -2));
  return Number.isInteger(f) && f >= 1 && floorPlan(b, f).rooms.some((r) => r.no === no);
}
