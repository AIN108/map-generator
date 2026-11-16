// 브라우저 자동 저장본(cmg:layout:v1)의 key: 어떤 옵션으로 만든 배치인지 적은 글.
//   자동 배치: `${seed}|${건물 수}|${병원 0·1}`, 목록: `${seed}|p${목록 해시}`
//   유형·밀도가 기본값(classic·normal)이 아니면 끝에 `|${campus}:${density}`를 붙인다.
// 시드에는 `|`·`:`도 들어갈 수 있으므로 읽을 때는 뒤에서부터 정해진 모양을 떼어 내고 남은 앞부분 전체를 시드로 본다.

import { CAMPUS_TYPES, DENSITIES, type CampusType, type Density } from "./site.ts";

export interface LayoutKeyParts {
  seed: string;
  /** 목록 해시 칸 (`p…`). 있으면 목록 배치 */
  program?: string;
  buildings: number;
  hospital: boolean;
  campus: CampusType;
  density: Density;
}

export function layoutKeyOf(k: LayoutKeyParts): string {
  const body = k.program ? `${k.seed}|${k.program}` : `${k.seed}|${k.buildings}|${k.hospital ? 1 : 0}`;
  return body + (k.campus === "classic" && k.density === "normal" ? "" : `|${k.campus}:${k.density}`);
}

const KEY = new RegExp(
  `^([\\s\\S]*)\\|(?:(\\d+)\\|([01])|(p[0-9a-z]+))(?:\\|(${CAMPUS_TYPES.join("|")}):(${DENSITIES.join("|")}))?$`,
);

/**
 * layoutKeyOf의 역. 모양이 맞지 않으면 undefined.
 * 목록 배치의 key에는 건물 수·병원이 없으므로 buildings·hospital은 defaults를 쓴다.
 */
export function parseLayoutKey(key: string, defaults: { buildings: number; hospital: boolean }): LayoutKeyParts | undefined {
  const m = KEY.exec(key);
  if (!m || !m[1]) return undefined;
  const [, seed, n, h, program, campus, density] = m;
  return {
    seed,
    program,
    buildings: program ? defaults.buildings : Number(n),
    hospital: program ? defaults.hospital : h === "1",
    campus: (campus as CampusType | undefined) ?? "classic",
    density: (density as Density | undefined) ?? "normal",
  };
}
