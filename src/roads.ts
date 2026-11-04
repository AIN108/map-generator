// 손으로 그린 길·숨긴 도로를 부지에 반영한다. 그리기·배치 검사·나무·길찾기가 모두 이 부지를 쓴다.

import { segmentDistance, type Vec2 } from "./geom.ts";
import type { Layout } from "./layout.ts";
import { CAMPUS_ROAD_WIDTH, type Road, type Site } from "./site.ts";

export const PATH_WIDTH = 4;
/** 지울 수 있는 부지 도로 (순환도로·간선도로·숲길은 캠퍼스 뼈대라 남긴다) */
export const ERASABLE: Road["kind"][] = ["campus", "connector"];

const cache = new WeakMap<Site, { key: string; site: Site }>();

/** 편집이 반영된 부지 (도로 목록만 다르다). 같은 편집이면 같은 객체를 돌려준다. */
export function effectiveSite(site: Site, layout: Layout): Site {
  if (!layout.roads?.length && !layout.hiddenRoads?.length) return site;
  const key = JSON.stringify([layout.roads ?? [], layout.hiddenRoads ?? []]);
  const hit = cache.get(site);
  if (hit && hit.key === key) return hit.site;
  const hidden = new Set(layout.hiddenRoads ?? []);
  const roads: Road[] = site.roads.filter((r, i) => !(hidden.has(i) && ERASABLE.includes(r.kind)));
  for (const r of layout.roads ?? []) {
    roads.push(r.kind === "road"
      ? { kind: "campus", pts: r.pts, width: CAMPUS_ROAD_WIDTH }
      : { kind: "path", pts: r.pts, width: PATH_WIDTH });
  }
  const out: Site = { ...site, roads };
  cache.set(site, { key, site: out });
  return out;
}

const lineDistance = (p: Vec2, pts: readonly Vec2[], closed = false): number => {
  let best = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) best = Math.min(best, segmentDistance(p, pts[i], pts[(i + 1) % pts.length]));
  return best;
};

/** (x, y)에서 가장 가까운 지울 수 있는 길: 손으로 그린 길이면 id, 부지 도로면 번호 */
export function roadAt(site: Site, layout: Layout, x: number, y: number, reach = 6):
  { custom?: number; siteIndex?: number; kind: string } | undefined {
  let best: { custom?: number; siteIndex?: number; kind: string } | undefined, bestD = Infinity;
  for (const r of layout.roads ?? []) {
    const d = lineDistance([x, y], r.pts) - (r.kind === "road" ? CAMPUS_ROAD_WIDTH : PATH_WIDTH) / 2;
    if (d < reach && d < bestD) { bestD = d; best = { custom: r.id, kind: r.kind }; }
  }
  const hidden = new Set(layout.hiddenRoads ?? []);
  site.roads.forEach((r, i) => {
    if (hidden.has(i) || !ERASABLE.includes(r.kind)) return;
    const d = lineDistance([x, y], r.pts, r.closed) - r.width / 2;
    if (d < reach && d < bestD) { bestD = d; best = { siteIndex: i, kind: r.kind }; }
  });
  return best;
}
