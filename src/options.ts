// 화면 옵션(시드·건물 수·보기 등)과 URL 해시(#seed=…&n=…) 사이의 변환.

import type { ViewAngle } from "./camera.ts";
import type { Season, TimeOfDay } from "./palette.ts";
import type { Surround } from "./scene.ts";
import { CAMPUS_TYPES, DENSITIES, type CampusType, type Density } from "./site.ts";

export interface Options {
  seed: string;
  /** 사용자가 정한 대학 이름 (비면 시드로 자동) */
  name: string;
  buildings: number;
  hospital: boolean;
  season: Season;
  time: TimeOfDay;
  view: ViewAngle;
  surround: Surround;
  campus: CampusType;
  density: Density;
}

export const DEFAULTS: Options = {
  seed: "campus", name: "", buildings: 24, hospital: true, season: "spring", time: "day", view: "mid", surround: "forest",
  campus: "classic", density: "normal",
};
export const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];
export const TIMES: TimeOfDay[] = ["day", "dusk", "night"];
export const VIEWS: ViewAngle[] = ["low", "mid", "high"];
export const SURROUNDS: Surround[] = ["forest", "city"];
export const MIN_BUILDINGS = 10, MAX_BUILDINGS = 32;

/** 해시(앞의 # 있어도 됨)에서 옵션을 읽는다. 알 수 없는 값은 버리고, 없는 항목은 결과에 넣지 않는다. */
export function parseOptionsHash(hash: string): Partial<Options> {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const out: Partial<Options> = {};
  const seed = p.get("seed");
  if (seed) out.seed = seed.slice(0, 40);
  const name = p.get("name");
  if (name) out.name = name.slice(0, 20);
  const n = Number(p.get("n"));
  if (p.has("n") && Number.isFinite(n)) out.buildings = Math.max(MIN_BUILDINGS, Math.min(MAX_BUILDINGS, Math.round(n)));
  if (p.has("hospital")) out.hospital = p.get("hospital") !== "0";
  const pickOf = <T extends string>(key: string, list: readonly T[]): T | undefined => list.find((v) => v === p.get(key));
  out.season = pickOf("season", SEASONS);
  out.time = pickOf("time", TIMES);
  out.view = pickOf("view", VIEWS);
  out.surround = pickOf("surround", SURROUNDS);
  out.campus = pickOf("campus", CAMPUS_TYPES);
  out.density = pickOf("density", DENSITIES);
  for (const k of Object.keys(out) as (keyof Options)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/** 옵션 → 해시 (앞의 # 포함). 유형·밀도는 기본값이면 적지 않는다 (예전 링크와 같은 모양). */
export function formatOptionsHash(o: Options): string {
  const p = new URLSearchParams({
    seed: o.seed, n: String(o.buildings), hospital: o.hospital ? "1" : "0", season: o.season, time: o.time, view: o.view, surround: o.surround,
  });
  if (o.name) p.set("name", o.name);
  if (o.campus !== "classic") p.set("campus", o.campus);
  if (o.density !== "normal") p.set("density", o.density);
  return `#${p}`;
}
