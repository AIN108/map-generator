// 지도에서 고친 배치를 목록(Program)으로 되돌려 쓴다. 목록 칸과 지도가 같은 내용을 가리키게 하는 용도.
// 손으로 옮긴 건물(pinned)은 좌표·각도·크기·모양을 적어 고정하고, 나머지는 원래 목록의 위치 묘사를 지킨다.

import { cloneForm } from "./form.ts";
import { isPlace, type Layout } from "./layout.ts";
import { DIR_ANGLE, type Dir, type PlaceHint, type Program, type ProgramItem, type ProgramLandmark } from "./program.ts";
import type { Site } from "./site.ts";

const DIRS = Object.keys(DIR_ANGLE) as Dir[];

/** 좌표를 캠퍼스 기준 방향·위치(중앙·외곽)로 바꾼다. */
export function placeFromPosition(site: Site, x: number, y: number): PlaceHint | undefined {
  const r = Math.hypot(x / site.rx, y / site.ry);
  if (r < 0.14) return { ring: "center" };
  const deg = ((Math.atan2(-y, x) * 180) / Math.PI + 360) % 360;
  let best: Dir = "E", bestD = Infinity;
  for (const d of DIRS) {
    const diff = Math.abs(((deg - DIR_ANGLE[d] + 540) % 360) - 180);
    if (diff < bestD) { bestD = diff; best = d; }
  }
  const hint: PlaceHint = { absDir: best };
  if (r < 0.34) hint.ring = "center";
  else if (r > 0.8) hint.ring = "outer";
  return hint;
}

export interface SyncOptions {
  /** 모든 건물·상징물에 좌표를 적는다 (자동 배치를 목록으로 옮길 때) */
  pinAll?: boolean;
  /** 부지 설정을 직접 정한다 (자동 배치에서 옮길 때: 그때의 건물 수) */
  site?: Program["site"];
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * 현재 배치를 목록으로 만든다. base는 그 배치를 만든 목록 (없으면 자동 배치에서 옮기는 경우).
 * 이름을 바꾼 건물은 다른 줄의 기준 이름도 따라 바꾸고, 지운 건물을 기준으로 삼던 줄은 그 기준을 뺀다.
 */
export function programFromLayout(layout: Layout, site: Site, base: Program | undefined, opts: SyncOptions = {}): Program {
  const baseItems = new Map((base?.items ?? []).map((i) => [i.name, i]));
  const baseMarks = new Map((base?.landmarks ?? []).map((l) => [l.name, l]));
  // 원래 이름 → 지금 이름
  const renamed = new Map<string, string>();
  for (const b of layout.buildings) if (b.src) renamed.set(b.src, b.name);
  const alive = new Set(layout.buildings.map((b) => b.name));
  const fixRef = (r: string | undefined): string | undefined => {
    if (!r) return undefined;
    if (r === "정문" || r === "후문") return r;
    const now = renamed.get(r) ?? r;
    return alive.has(now) ? now : undefined;
  };
  const fixPlace = (p: PlaceHint | undefined, selfName: string): PlaceHint | undefined => {
    if (!p) return undefined;
    const out: PlaceHint = { ...p };
    out.ref = fixRef(p.ref);
    out.ref2 = fixRef(p.ref2);
    if (out.ref === selfName) out.ref = undefined;
    if (!out.ref) { delete out.ref; delete out.rel; delete out.dir; delete out.ref2; }
    else if (p.rel === "between" && !out.ref2) { out.rel = "near"; delete out.ref2; }
    if (!out.ref2) delete out.ref2;
    if (out.absDir === undefined) delete out.absDir;
    if (out.ring === undefined) delete out.ring;
    return out.ref || out.absDir || out.ring ? out : undefined;
  };

  const order = [...layout.buildings.filter((b) => !b.unlisted), ...layout.buildings.filter((b) => b.unlisted)];
  const items: ProgramItem[] = order.map((b) => {
    const bi = b.src ? baseItems.get(b.src) : undefined;
    const item: ProgramItem = { name: b.name, type: b.type };
    const place = isPlace(b);
    if (!place) item.floors = b.floors;
    const hint = bi ? fixPlace(bi.place, b.name) : placeFromPosition(site, b.x, b.y);
    if (hint) item.place = hint;
    if (!place && b.type !== "admin") item.style = b.style;
    if (b.unlisted) item.unlisted = true;
    if (b.pinned || opts.pinAll) {
      item.at = [r1(b.x), r1(b.y)];
      item.angle = Math.round(((((b.angle * 180) / Math.PI) % 360 + 360) % 360) * 100) / 100;
      item.size = [r1(b.w), r1(b.d)];
      item.shape = b.shape;
      item.variant = Math.round(b.variant * 1000) / 1000;
      if (b.form) item.form = cloneForm(b.form);
    }
    return item;
  });
  const landmarks: ProgramLandmark[] = layout.landmarks.map((m) => {
    const bl = m.src ? baseMarks.get(m.src) : undefined;
    const lm: ProgramLandmark = { name: m.name, kind: m.kind };
    const hint = bl ? fixPlace(bl.place, "") : undefined;
    if (hint) lm.place = hint;
    if (m.pinned || opts.pinAll || !bl) lm.at = [r1(m.x), r1(m.y)];
    return lm;
  });
  const listedBase = base ? base.items.filter((i) => !i.unlisted).length : layout.buildings.filter((b) => !b.unlisted).length;
  const program: Program = {
    name: layout.name,
    items,
    landmarks,
    site: opts.site ?? base?.site ?? { auto: !base, buildings: Math.max(10, Math.min(40, listedBase)) },
  };
  if (base?.size) program.size = base.size;
  return program;
}
