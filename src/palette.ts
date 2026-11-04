// 계절·시간대별 색. 모든 색은 tone()을 거쳐 시간대(낮·해질녘·밤) 보정을 받는다.

import type { Style } from "./catalog.ts";

export type RGB = [number, number, number];
export type Season = "spring" | "summer" | "autumn" | "winter";
export type TimeOfDay = "day" | "dusk" | "night";

export const SEASON_KO: Record<Season, string> = { spring: "봄", summer: "여름", autumn: "가을", winter: "겨울" };
export const TIME_KO: Record<TimeOfDay, string> = { day: "낮", dusk: "해질녘", night: "밤" };

export interface StyleColors { wall: RGB; trim: RGB; roof: RGB; pitched: RGB; window: RGB }

export const STYLE_COLORS: Record<Style, StyleColors> = {
  brick: { wall: [172, 92, 68], trim: [232, 222, 204], roof: [150, 140, 128], pitched: [84, 94, 112], window: [48, 62, 80] },
  classic: { wall: [234, 224, 204], trim: [250, 246, 238], roof: [190, 184, 172], pitched: [72, 84, 108], window: [58, 74, 96] },
  stone: { wall: [216, 203, 180], trim: [240, 233, 218], roof: [188, 182, 170], pitched: [96, 92, 90], window: [66, 88, 110] },
  modern: { wall: [234, 232, 226], trim: [250, 250, 248], roof: [198, 196, 190], pitched: [120, 120, 120], window: [88, 126, 158] },
  glass: { wall: [126, 166, 198], trim: [222, 230, 236], roof: [192, 198, 202], pitched: [120, 120, 120], window: [104, 148, 184] },
  concrete: { wall: [192, 192, 188], trim: [228, 228, 224], roof: [178, 178, 174], pitched: [110, 110, 110], window: [76, 100, 124] },
  white: { wall: [244, 245, 246], trim: [252, 252, 252], roof: [214, 216, 218], pitched: [120, 120, 120], window: [98, 146, 188] },
};

export interface Palette {
  season: Season;
  time: TimeOfDay;
  /** 해를 향하는 단위 벡터 (월드: x 동, y 남, z 위) */
  sun: [number, number, number];
  /** 그림자 진하기 */
  shadowAlpha: number;
  /** 밤에 창문이 켜질 확률 */
  litWindows: number;
  snow: boolean;
  forestFloor: RGB;
  forestHill: RGB;
  lawn: RGB;
  lawnLight: RGB;
  field: RGB;
  fieldLight: RGB;
  track: RGB;
  paving: RGB;
  plaza: RGB;
  walkway: RGB;
  road: RGB;
  roadEdge: RGB;
  arterial: RGB;
  marking: RGB;
  water: RGB;
  waterLight: RGB;
  cityGround: RGB;
  cityRoof: RGB[];
  cityWall: RGB[];
  parking: RGB;
  /** 나무 색 묶음: [그늘, 기본, 밝은 면] */
  deciduous: [RGB, RGB, RGB][];
  conifer: [RGB, RGB, RGB][];
  blossom: [RGB, RGB, RGB][];
  avenue: [RGB, RGB, RGB][];
  flowers: RGB[];
  sky: [RGB, RGB];
  haze: RGB;
}

const tri = (a: RGB, b: RGB, c: RGB): [RGB, RGB, RGB] => [a, b, c];

const GREENS: [RGB, RGB, RGB][] = [
  tri([40, 78, 38], [62, 110, 52], [104, 150, 78]),
  tri([46, 86, 40], [74, 120, 58], [118, 162, 86]),
  tri([36, 70, 40], [56, 100, 54], [92, 140, 76]),
  tri([52, 92, 44], [86, 130, 62], [134, 172, 92]),
];
const CONIFERS: [RGB, RGB, RGB][] = [
  tri([24, 52, 36], [38, 74, 48], [66, 104, 70]),
  tri([28, 58, 40], [44, 82, 54], [74, 114, 78]),
];

export function makePalette(season: Season, time: TimeOfDay): Palette {
  const p: Palette = {
    season, time,
    sun: normalize([-0.55, 0.5, 0.68]),
    shadowAlpha: 0.26,
    litWindows: 0,
    snow: false,
    forestFloor: [38, 72, 40],
    forestHill: [52, 92, 50],
    lawn: [132, 172, 96],
    lawnLight: [150, 188, 108],
    field: [86, 152, 72],
    fieldLight: [104, 168, 84],
    track: [182, 92, 70],
    paving: [226, 220, 208],
    plaza: [232, 222, 202],
    walkway: [218, 208, 188],
    road: [150, 152, 152],
    roadEdge: [206, 202, 194],
    arterial: [104, 108, 112],
    marking: [246, 246, 240],
    water: [84, 148, 196],
    waterLight: [150, 200, 230],
    cityGround: [196, 196, 190],
    cityRoof: [[206, 204, 198], [188, 190, 192], [214, 208, 196], [176, 180, 184], [198, 186, 170]],
    cityWall: [[222, 220, 214], [200, 204, 208], [226, 216, 200], [190, 194, 198], [210, 196, 180]],
    parking: [170, 172, 172],
    deciduous: GREENS,
    conifer: CONIFERS,
    blossom: GREENS,
    avenue: GREENS,
    flowers: [[226, 92, 120], [246, 200, 80], [240, 240, 236], [200, 120, 210]],
    sky: [[150, 190, 228], [214, 230, 240]],
    haze: [200, 220, 232],
  };
  switch (season) {
    case "spring":
      p.lawn = [140, 182, 98];
      p.lawnLight = [160, 196, 112];
      p.deciduous = [
        tri([58, 98, 44], [92, 140, 62], [146, 186, 98]),
        tri([50, 90, 42], [82, 128, 58], [132, 176, 90]),
        ...GREENS.slice(0, 2),
      ];
      p.blossom = [
        tri([212, 140, 166], [240, 180, 200], [252, 222, 232]),
        tri([220, 156, 178], [246, 196, 214], [255, 232, 240]),
        tri([232, 182, 198], [250, 214, 226], [255, 240, 246]),
      ];
      p.avenue = p.blossom;
      break;
    case "summer":
      p.lawn = [118, 164, 84];
      p.lawnLight = [136, 178, 96];
      break;
    case "autumn":
      p.lawn = [150, 166, 92];
      p.lawnLight = [170, 178, 104];
      p.forestFloor = [92, 70, 40];
      p.forestHill = [120, 92, 50];
      p.deciduous = [
        tri([150, 64, 30], [204, 104, 44], [236, 156, 80]),
        tri([160, 108, 26], [214, 160, 46], [244, 204, 98]),
        tri([128, 44, 32], [184, 72, 46], [224, 120, 84]),
        tri([110, 104, 44], [154, 146, 64], [196, 186, 104]),
        tri([62, 96, 46], [92, 126, 60], [136, 164, 86]),
      ];
      p.blossom = [tri([156, 60, 40], [206, 90, 56], [238, 140, 96])];
      p.avenue = [tri([176, 136, 20], [232, 190, 40], [252, 226, 110])]; // 은행나무
      break;
    case "winter":
      p.snow = true;
      p.lawn = [232, 236, 240];
      p.lawnLight = [244, 246, 250];
      p.field = [226, 232, 236];
      p.fieldLight = [238, 242, 246];
      p.forestFloor = [196, 202, 206];
      p.forestHill = [214, 220, 226];
      p.walkway = [208, 206, 202];
      p.deciduous = [
        tri([126, 118, 112], [176, 170, 166], [240, 242, 246]),
        tri([110, 102, 96], [160, 152, 146], [232, 234, 238]),
        tri([140, 134, 130], [196, 192, 190], [248, 249, 252]),
      ];
      p.conifer = [tri([28, 50, 40], [46, 76, 58], [230, 236, 240])];
      p.blossom = p.deciduous;
      p.avenue = p.deciduous;
      p.flowers = [];
      p.sky = [[170, 192, 214], [226, 234, 240]];
      break;
  }
  if (time === "dusk") {
    p.sun = normalize([-0.85, 0.3, 0.3]);
    p.shadowAlpha = 0.32;
    p.sky = [[96, 110, 168], [246, 170, 120]];
    p.haze = [236, 176, 140];
    p.litWindows = 0.18;
  } else if (time === "night") {
    p.sun = normalize([-0.3, 0.4, 0.86]); // 달빛
    p.shadowAlpha = 0.12;
    p.sky = [[10, 16, 38], [34, 46, 82]];
    p.haze = [30, 40, 70];
    p.litWindows = 0.5;
  }
  return p;
}

function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

const GRADE: Record<TimeOfDay, { mul: RGB; add: RGB }> = {
  day: { mul: [1, 1, 1], add: [0, 0, 0] },
  dusk: { mul: [1.0, 0.86, 0.76], add: [10, 0, 0] },
  night: { mul: [0.2, 0.25, 0.4], add: [2, 4, 12] },
};

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** 밝기 k(1 = 원래 색)를 곱하고 시간대 보정을 한 CSS 색 */
export function tone(p: Palette, c: RGB, k = 1, alpha = 1): string {
  const g = GRADE[p.time];
  const r = clamp255(c[0] * k * g.mul[0] + g.add[0]);
  const gg = clamp255(c[1] * k * g.mul[1] + g.add[1]);
  const b = clamp255(c[2] * k * g.mul[2] + g.add[2]);
  return alpha >= 1 ? `rgb(${r},${gg},${b})` : `rgba(${r},${gg},${b},${alpha})`;
}

/** 시간대 보정 없이 그대로 쓰는 색 (밤의 불 켜진 창문·가로등) */
export function raw(c: RGB, alpha = 1): string {
  return alpha >= 1 ? `rgb(${clamp255(c[0])},${clamp255(c[1])},${clamp255(c[2])})`
    : `rgba(${clamp255(c[0])},${clamp255(c[1])},${clamp255(c[2])},${alpha})`;
}

export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** 면의 법선으로 밝기 계수를 정한다 (확산광 + 환경광). */
export function shade(p: Palette, n: [number, number, number]): number {
  const d = n[0] * p.sun[0] + n[1] * p.sun[1] + n[2] * p.sun[2];
  return 0.68 + 0.36 * Math.max(-0.4, d);
}
