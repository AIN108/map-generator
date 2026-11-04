// 건물 목록(Program)으로 배치하기. 위치 묘사(방향·옆·사이·앞뒤)를 목표 지점으로 바꾸고,
// 자동 배치와 같은 도로변 후보 자리 중 목표에 가장 가까운 빈자리에 놓는다.

import { buildingType, DISTRICTS, LANDMARKS, type BuildingType } from "./catalog.ts";
import { localToWorld, rectCorners, type Poly, type Vec2 } from "./geom.ts";
import {
  autoName, frontages, landmarkClear, makeBuilding, placeAlongRoads, placementContext, round1, type Building, type Landmark,
  type Layout, type PlacementContext,
} from "./layout.ts";
import { DIR_ANGLE, type Dir, type PlaceHint, type Program, type ProgramItem } from "./program.ts";
import { subRng, type Rng } from "./rng.ts";
import { generateSite, type Site } from "./site.ts";

export interface ProgramLayoutResult {
  site: Site;
  layout: Layout;
  warnings: string[];
}

const unit = (d: Dir): Vec2 => {
  const a = (DIR_ANGLE[d] * Math.PI) / 180;
  return [Math.cos(a), -Math.sin(a)];
};

const RING_R = { center: 0.4, mid: 0.66, outer: 0.86 } as const;

function absTarget(site: Site, p: PlaceHint | undefined): Vec2 | undefined {
  if (!p) return undefined;
  if (p.absDir) {
    const a = (DIR_ANGLE[p.absDir] * Math.PI) / 180;
    const r = RING_R[p.ring ?? "mid"];
    return [Math.cos(a) * site.rx * r, -Math.sin(a) * site.ry * r];
  }
  if (p.ring === "center") return [0, 0];
  if (p.ring === "outer") return undefined;
  return undefined;
}

/** 방사형 도로를 피할 방향: 운동장·병원·체육관처럼 큰 시설이 갈 곳 */
function avoidAngles(program: Program): number[] {
  const out: number[] = [];
  const byName = new Map(program.items.map((i) => [i.name, i]));
  for (const it of program.items) {
    if (!["field", "gym"].includes(it.type)) continue;
    let d = it.place?.absDir;
    if (!d && it.place?.ref) d = byName.get(it.place.ref)?.place?.absDir;
    if (d) out.push(DIR_ANGLE[d]);
  }
  return out;
}

/** 목록 형식으로 부지와 배치를 만든다. 놓지 못한 건물은 경고로 돌려준다. */
export function generateFromProgram(seed: string, program: Program, nameOverride = ""): ProgramLayoutResult {
  const warnings: string[] = [];
  const listed = program.items.filter((i) => !i.unlisted).length;
  const site = generateSite(seed, Math.max(10, Math.min(40, listed)), {
    mirror: false, size: program.size, avoid: avoidAngles(program),
  });
  const ctx = placementContext(site);
  const rng = subRng(seed, "program-layout");
  const name = nameOverride.trim() || program.name || autoName(seed);
  let nextId = 1;

  // 목록 항목 → 건물 (크기·모양은 종류에서, 층수·외관은 목록에서)
  const made = program.items.map((it) => {
    const t: BuildingType = buildingType(it.type) ?? buildingType("generic")!;
    const b = makeBuilding(rng, t, nextId++, name);
    b.name = it.name;
    if (it.floors && b.shape !== "plaza" && b.shape !== "field") b.floors = it.floors;
    if (it.style && t.id !== "admin" && b.shape !== "plaza" && b.shape !== "field") b.style = it.style;
    // 종류의 층수 범위보다 높으면 바닥을 줄이고(높고 날씬하게), 훨씬 높으면 고층형 모양으로 바꾼다 (12층 기숙사 등).
    if (b.floors > t.floors[1] && t.floors[1] > 0) {
      const k = Math.max(0.7, Math.sqrt(t.floors[1] / b.floors));
      b.w = round1(b.w * k);
      b.d = round1(b.d * Math.max(0.8, k));
    }
    if (b.floors > t.floors[1] + 4 && ["U", "court", "L", "bar"].includes(b.shape)) b.shape = "tower";
    if (it.unlisted) b.unlisted = true;
    return { it, t, b };
  });
  const byName = new Map(made.map((m) => [m.it.name, m]));
  const placed: Building[] = [];
  const done = new Set<string>();
  const coreExtra: Poly[] = [];

  // ── 중심 구역: 본부·광장·광장 양옆 ──
  const admin = made.find((m) => m.t.id === "admin");
  if (admin) {
    Object.assign(admin.b, { x: 0, y: site.adminY, d: 32, angle: 0 });
    placed.push(admin.b);
    done.add(admin.it.name);
    const core = site.coreRect;
    coreExtra.push(rectCorners(core.x, core.y, core.w, core.d, 0));
  }
  let plaza = made.find((m) => m.t.id === "plaza");
  if (!plaza && admin) {
    // 광장이 목록에 없어도 중심축이 비지 않게 번호 없는 광장을 둔다.
    const t = buildingType("plaza")!;
    const b = makeBuilding(rng, t, nextId++, name);
    b.unlisted = true;
    plaza = { it: { name: b.name, type: "plaza", unlisted: true }, t, b };
    made.push(plaza);
    byName.set(plaza.it.name, plaza);
  }
  if (plaza) {
    Object.assign(plaza.b, { x: site.plaza.x, y: site.plaza.y, w: site.plaza.w, d: site.plaza.d, angle: 0 });
    placed.push(plaza.b);
    done.add(plaza.it.name);
  }
  const anchors = new Set([admin?.it.name, plaza?.it.name].filter(Boolean) as string[]);
  const slots: Record<"E" | "W", (typeof made)[number] | undefined> = { E: undefined, W: undefined };
  for (const m of made) {
    if (done.has(m.it.name) || m.it.unlisted) continue;
    const p = m.it.place;
    let side: "E" | "W" | undefined;
    if (p?.ref && anchors.has(p.ref) && p.rel === "dir" && (p.dir === "E" || p.dir === "W")) side = p.dir;
    else if (!p && (m.t.id === "library" || m.t.id === "union")) side = m.t.id === "library" ? "W" : "E";
    if (side && !slots[side] && plaza) slots[side] = m;
  }
  for (const side of ["E", "W"] as const) {
    const m = slots[side];
    if (!m || !plaza) continue;
    m.b.w = Math.min(m.b.w, 86);
    m.b.d = Math.min(m.b.d, 52);
    const sx = side === "E" ? 1 : -1;
    Object.assign(m.b, {
      x: round1(sx * (site.plaza.w / 2 + 26 + m.b.w / 2)), y: round1(site.plaza.y - 2 + m.b.d / 2 - 26), angle: 0,
    });
    placed.push(m.b);
    done.add(m.it.name);
  }

  // ── 나머지: 기준이 놓인 것부터 ──
  const fronts = frontages(site);
  const pos = (n: string): Building | undefined => (done.has(n) ? byName.get(n)?.b : undefined);
  const known = (n: string): boolean => byName.has(n) || n === "정문" || n === "후문";
  const refPoint = (n: string): Vec2 | undefined => {
    if (n === "정문") return [0, site.gateS[1] - 40];
    if (n === "후문") return [0, site.gateN[1] + 40];
    const b = pos(n);
    return b ? [b.x, b.y] : undefined;
  };
  const radius = (b: Building): number => Math.max(b.w, b.d) / 2;

  /** 목표 지점. 기준이 아직 안 놓였으면 undefined (기다린다). force면 기준을 무시하고 방향만 쓴다. */
  const targetOf = (m: (typeof made)[number], force: boolean): Vec2 | undefined => {
    const p = m.it.place;
    const abs = absTarget(site, p);
    const fallback = (): Vec2 => {
      if (abs) return abs;
      const d = DISTRICTS[m.t.district];
      const a = (d.angle * Math.PI) / 180;
      return [Math.cos(a) * site.rx * d.r, -Math.sin(a) * site.ry * d.r];
    };
    if (!p?.ref || !known(p.ref) || (p.ref2 && !known(p.ref2))) return fallback();
    const base = refPoint(p.ref);
    const base2 = p.ref2 ? refPoint(p.ref2) : undefined;
    if (!base || (p.ref2 && !base2)) return force ? fallback() : undefined;
    const rb = pos(p.ref);
    const gap = (rb ? radius(rb) : 20) + radius(m.b) + 26;
    let t: Vec2;
    switch (p.rel) {
      case "dir": {
        const u = unit(p.dir ?? "S");
        t = [base[0] + u[0] * gap, base[1] + u[1] * gap];
        if (abs) t = [t[0] * 0.8 + abs[0] * 0.2, t[1] * 0.8 + abs[1] * 0.2];
        break;
      }
      case "front": case "back": {
        const s = p.rel === "front" ? 1 : -1;
        t = rb ? localToWorld(rb.x, rb.y, rb.angle, 0, s * (rb.d / 2 + radius(m.b) + 24)) : base;
        break;
      }
      case "between":
        t = [(base[0] + base2![0]) / 2, (base[1] + base2![1]) / 2];
        break;
      default: {
        // 옆·인근: 기준 가까이, 캠퍼스 방향이 있으면 그쪽으로 조금 당긴다.
        t = abs ? [base[0] * 0.65 + abs[0] * 0.35, base[1] * 0.65 + abs[1] * 0.35] : base;
      }
    }
    return t;
  };

  const placeOne = (m: (typeof made)[number], target: Vec2): void => {
    const setback = m.t.id === "field" ? 18 : m.t.id === "hospital" ? 20 : 10;
    // 목표 가까이에서 먼저 찾고, 안 되면 조금 줄여 보고, 그래도 안 되면 멀리까지 찾는다.
    const near = site.rx * 0.32, mid = site.rx * 0.6;
    const steps: [number, number][] = [[near, 1], [near, 0.9], [mid, 0.9], [mid, 0.82], [Infinity, 0.82], [Infinity, 0.74]];
    const w0 = m.b.w, d0 = m.b.d;
    let ok = false;
    for (const [reach, k] of steps) {
      m.b.w = round1(w0 * k);
      m.b.d = round1(d0 * (1 - (1 - k) * 0.7));
      ok = placeAlongRoads(rng, ctx, fronts, placed, m.b, target, coreExtra, setback, 0.03, reach, m.t.id === "field" ? 1 : 3);
      if (ok) break;
    }
    done.add(m.it.name);
    if (ok) placed.push(m.b);
    else warnings.push(`'${m.it.name}'을(를) 놓을 자리를 찾지 못했습니다. 위치를 바꾸거나 캠퍼스를 키워 보세요 (@크기).`);
  };

  // 놓는 순서: 큰 '뿌리'(기준이 없거나 이미 놓인 건물)부터 놓고, 그 건물을 기준으로 삼은 건물을 곧바로 이어서 놓는다.
  // 그래야 '병원 옆 의대'처럼 묶인 건물이 다른 건물에 자리를 뺏기지 않는다.
  type Made = (typeof made)[number];
  const area = (m: Made): number => m.b.w * m.b.d;
  const refsOf = (m: Made): string[] => [m.it.place?.ref, m.it.place?.ref2].filter((r): r is string => !!r && byName.has(r));
  const dependents = (name: string): Made[] =>
    made.filter((m) => !done.has(m.it.name) && refsOf(m).includes(name)).sort((a, b) => area(b) - area(a));
  /** 기준을 따라가면 자기 자신으로 돌아오는가 (A는 B 옆, B는 A 옆) */
  const cyclic = (m: Made): boolean => {
    const seen = new Set<string>();
    const stack = refsOf(m);
    while (stack.length) {
      const r = stack.pop()!;
      if (r === m.it.name) return true;
      if (seen.has(r) || done.has(r)) continue;
      seen.add(r);
      const rm = byName.get(r);
      if (rm) stack.push(...refsOf(rm));
    }
    return false;
  };
  const placeTree = (m: Made, target: Vec2): void => {
    placeOne(m, target);
    for (const d of dependents(m.it.name)) {
      if (done.has(d.it.name)) continue;
      const t = targetOf(d, false);
      if (t) placeTree(d, t);
    }
  };
  for (;;) {
    const pending = made.filter((m) => !done.has(m.it.name));
    if (!pending.length) break;
    const roots = pending
      .map((m) => ({ m, t: targetOf(m, false) ?? (cyclic(m) ? targetOf(m, true) : undefined) }))
      .filter((x): x is { m: Made; t: Vec2 } => !!x.t)
      .sort((a, b) => area(b.m) - area(a.m));
    if (roots.length) placeTree(roots[0].m, roots[0].t);
    else {
      const m = pending.sort((a, b) => area(b) - area(a))[0];
      placeTree(m, targetOf(m, true)!);
    }
  }

  // 번호 순서는 목록 순서 (번호 없는 시설은 맨 뒤)
  const order = new Map(program.items.map((it, i) => [it.name, i]));
  const buildings = placed.slice().sort((a, b) =>
    Number(!!a.unlisted) - Number(!!b.unlisted) || (order.get(a.name) ?? 999) - (order.get(b.name) ?? 999));

  const layout: Layout = { name, buildings, landmarks: [], nextId };
  layout.landmarks = programLandmarks(subRng(seed, "program-landmarks"), ctx, layout, program, byName, warnings);
  return { site, layout, warnings };
}

function programLandmarks(
  rng: Rng, ctx: PlacementContext, layout: Layout, program: Program,
  byName: Map<string, { b: Building; t: BuildingType; it: ProgramItem }>, warnings: string[],
): Landmark[] {
  const site = ctx.site;
  const out: Landmark[] = [];
  const find = (n: string): Building | undefined => {
    const b = byName.get(n)?.b;
    return b && layout.buildings.includes(b) ? b : undefined;
  };
  const plaza = layout.buildings.find((b) => b.shape === "plaza");
  for (const lm of program.landmarks) {
    const p = lm.place;
    let t: Vec2 | undefined;
    let free = false;
    if (p?.ref === "정문") {
      t = p.rel === "inside" ? [0, site.gateS[1] - 40] : [0, site.gateS[1] + 16];
      free = p.rel !== "inside";
    } else if (p?.ref === "후문") {
      t = [0, site.gateN[1] + 34];
    } else if (p?.ref) {
      const b = find(p.ref);
      if (b && b === plaza && (p.rel === "dir" || p.rel === "near")) {
        const u = p.dir ? unit(p.dir) : [1, 0];
        const ux = Math.abs(u[0]) < 0.2 ? 0 : Math.sign(u[0]), uy = Math.abs(u[1]) < 0.2 ? 0 : Math.sign(u[1]);
        t = localToWorld(b.x, b.y, b.angle, ux * (b.w / 2 - 16), uy * (b.d / 2 - 14));
      } else if (b) {
        const r = Math.max(b.w, b.d) / 2;
        if (p.rel === "between" && p.ref2 && find(p.ref2)) {
          const c = find(p.ref2)!;
          t = [(b.x + c.x) / 2, (b.y + c.y) / 2];
        } else if (p.rel === "dir" && p.dir) {
          const u = unit(p.dir);
          t = [b.x + u[0] * (r + 16), b.y + u[1] * (r + 16)];
        } else if (p.rel === "back") {
          t = localToWorld(b.x, b.y, b.angle, 0, -b.d / 2 - 16);
        } else if (p.absDir && p.rel === "near") {
          const u = unit(p.absDir);
          t = [b.x + u[0] * (r + 16), b.y + u[1] * (r + 16)];
        } else {
          t = localToWorld(b.x, b.y, b.angle, 0, b.d / 2 + 16);
        }
      }
    }
    t ??= absTarget(site, p);
    if (!t) {
      // 위치가 없으면 종류별 기본 자리
      const px = plaza?.x ?? 0, py = plaza?.y ?? site.plaza.y;
      t = lm.kind === "fountain" ? [px + 40, py + 10] : lm.kind === "loop" ? [px - 40, py + 10]
        : lm.kind === "obelisk" ? [0, site.monumentY] : lm.kind === "emblem" ? [0, site.gateS[1] + 16]
          : (() => { const b = layout.buildings[Math.floor(rng() * layout.buildings.length)]; return localToWorld(b.x, b.y, b.angle, 0, b.d / 2 + 16); })();
      free = lm.kind === "emblem";
    }
    const spot = free ? t : findClear(ctx, layout.buildings, out, t, lm.kind === "pond" ? 26 : lm.kind === "garden" ? 10 : 6);
    if (!spot) { warnings.push(`상징물 '${lm.name}'을(를) 놓을 빈자리를 찾지 못했습니다.`); continue; }
    out.push({ id: layout.nextId++, kind: lm.kind, name: lm.name || LANDMARKS[lm.kind].names[0], x: round1(spot[0]), y: round1(spot[1]) });
  }
  return out;
}

/** t 둘레를 나선형으로 돌며 건물·도로·다른 상징물과 겹치지 않는 첫 자리 */
function findClear(ctx: PlacementContext, buildings: readonly Building[], others: readonly Landmark[], t: Vec2, r: number): Vec2 | undefined {
  for (let rad = 0; rad <= 70; rad += 4) {
    const n = rad === 0 ? 1 : Math.max(8, Math.round(rad / 3));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const p: Vec2 = [t[0] + Math.cos(a) * rad, t[1] + Math.sin(a) * rad];
      if (!landmarkClear(ctx, buildings, p, r)) continue;
      if (others.some((o) => Math.hypot(o.x - p[0], o.y - p[1]) < 14)) continue;
      return p;
    }
  }
  return undefined;
}
