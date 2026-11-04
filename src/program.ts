// 건물 목록 입력: 한 줄에 건물 하나를 적는 형식과, 설정 글(마크다운·텍스트)에서 그 목록을 뽑아내는 추출기.
//
// 형식 (한 줄에 하나, '#'로 시작하면 주석):
//   @이름 한빛대학교
//   @크기 700x600                       (캠퍼스 동서×남북, m)
//   대학본부 | 본부 | 5층 | 중앙
//   중앙도서관 | 8층 | 중앙광장 동쪽 | 현대
//   사범대 본관 | 6층 | 인문강의동과 사회과학관 사이 | 벽돌
//   야외 운동장 | 운동장 | 종합체육관 뒤 | 번호 없음
//   @상징물 무한의 고리 | 고리 | 중앙광장 남서쪽
// 이름 뒤 칸은 순서와 상관없이 종류·층수·위치·외관·'번호 없음'으로 알아본다.

import { formFromText, formToText, gridFromText, gridToText, type BuildingForm } from "./form.ts";
import { LANDMARKS, type LandmarkKind, type Shape, type Style } from "./catalog.ts";

export type Dir = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export const DIR_KO: Record<Dir, string> = { N: "북", NE: "북동", E: "동", SE: "남동", S: "남", SW: "남서", W: "서", NW: "북서" };
/** 동쪽 0°, 북쪽 90° */
export const DIR_ANGLE: Record<Dir, number> = { E: 0, NE: 45, N: 90, NW: 135, W: 180, SW: 225, S: 270, SE: 315 };

export type Relation = "dir" | "near" | "front" | "back" | "between" | "inside";

export interface PlaceHint {
  /** 기준 시설 이름 (또는 '정문'·'후문') */
  ref?: string;
  rel?: Relation;
  /** rel이 'dir'일 때 기준에서 본 방향 */
  dir?: Dir;
  /** rel이 'between'일 때 두 번째 기준 */
  ref2?: string;
  /** 캠퍼스 전체에서 본 방향 */
  absDir?: Dir;
  ring?: "center" | "mid" | "outer";
}

export interface ProgramItem {
  name: string;
  /** 건물 종류 (catalog의 id) */
  type: string;
  floors?: number;
  style?: Style;
  place?: PlaceHint;
  /** 그리되 번호·범례에서 뺀다 (공식 시설이 아닌 운동장 등) */
  unlisted?: boolean;
  /** 고정 좌표 (m). 있으면 위치 묘사보다 앞서고 그 자리에 그대로 놓는다. */
  at?: [number, number];
  /** 방향 (도, 0이면 정면이 남쪽) */
  angle?: number;
  /** 폭×깊이 (m) */
  size?: [number, number];
  shape?: Shape;
  /** 세부 모양 난수 (0~1, ㄱ자 방향·옥상 설비 등) */
  variant?: number;
  /** 모양 세부 조절·자유형 평면 */
  form?: BuildingForm;
}

export interface ProgramLandmark { name: string; kind: LandmarkKind; place?: PlaceHint; at?: [number, number] }

export interface Program {
  name?: string;
  /** 캠퍼스 동서·남북 크기 (m) */
  size?: [number, number];
  /** 부지를 고정한다: auto면 자동 배치와 같은 부지, buildings는 부지 크기를 정하는 건물 수 */
  site?: { auto: boolean; buildings: number };
  items: ProgramItem[];
  landmarks: ProgramLandmark[];
}

export const SHAPE_LABEL: Record<Shape, string> = {
  bar: "일자", L: "ㄱ자", U: "ㄷ자", court: "ㅁ자", wings: "본관형", atrium: "아트리움", stepped: "계단식", twin: "쌍둥이",
  tower: "탑상형", gym: "볼트지붕", round: "원형", hospital: "병원형", hall: "공연장", custom: "자유형", plaza: "광장", field: "운동장", courts: "코트",
};
const NUM = "(-?\\d+(?:\\.\\d+)?)";
const AT_RE = new RegExp(`^좌표\\s*${NUM}\\s*[, ]\\s*${NUM}$`);
const ANGLE_RE = new RegExp(`^각도\\s*${NUM}\\s*°?$`);
const SIZE_RE = new RegExp(`^크기\\s*${NUM}\\s*[x×*]\\s*${NUM}$`);
const VARIANT_RE = new RegExp(`^세부\\s*${NUM}$`);
const fix1 = (v: number): number => Math.round(v * 10) / 10;

/** 좌표·각도·크기·모양·세부·형태·평면 칸을 읽는다. 알아보면 true. */
function readGeometry(
  f: string, item: { at?: [number, number]; angle?: number; size?: [number, number]; shape?: Shape; variant?: number; form?: BuildingForm },
): boolean {
  const fm = /^형태\s+(.+)$/.exec(f);
  if (fm) {
    const form = formFromText(fm[1]);
    if (form) { item.form = { ...item.form, ...form }; return true; }
  }
  const pm = /^평면\s+(.+)$/.exec(f);
  if (pm) {
    const grid = gridFromText(pm[1]);
    if (grid) { item.form = { ...item.form, grid }; item.shape ??= "custom"; return true; }
  }
  let m = AT_RE.exec(f);
  if (m) {
    const x = Number(m[1]), y = Number(m[2]);
    if (Math.abs(x) <= 5000 && Math.abs(y) <= 5000) item.at = [fix1(x), fix1(y)];
    return true;
  }
  if ((m = ANGLE_RE.exec(f))) { item.angle = Math.round((((Number(m[1]) % 360) + 360) % 360) * 100) / 100; return true; }
  if ((m = SIZE_RE.exec(f))) {
    item.size = [fix1(Math.max(8, Math.min(220, Number(m[1])))), fix1(Math.max(8, Math.min(160, Number(m[2]))))];
    return true;
  }
  if ((m = VARIANT_RE.exec(f))) { item.variant = Math.max(0, Math.min(1, Number(m[1]))); return true; }
  const sm = /^모양\s*(.+)$/.exec(f);
  if (sm) {
    const label = sm[1].replace(/\s+/g, "");
    const hit = (Object.entries(SHAPE_LABEL) as [Shape, string][]).find(([, l]) => l === label);
    if (hit) { item.shape = hit[0]; return true; }
  }
  return false;
}

export interface ParseResult { program: Program; warnings: string[] }

export const MAX_PROGRAM_ITEMS = 40;
export const MAX_PROGRAM_TEXT = 20000;

// ── 종류 ─────────────────────────────────────────────────────────────
/** 종류 칸에 쓰는 이름 (programToText가 이 말로 쓰고, 다시 읽으면 같은 종류가 된다) */
export const TYPE_LABEL: Record<string, string> = {
  admin: "본부", plaza: "광장", library: "도서관", union: "학생회관", gym: "체육관", field: "운동장", hospital: "병원",
  dorm: "기숙사", intlDorm: "국제기숙사", dorm2: "고층기숙사", eng1: "공학", eng2: "공학", eng3: "공학", sw: "소프트웨어",
  sci1: "자연과학", sci2: "자연과학", lifesci: "생명과학", humanities: "인문", social: "사회과학", education: "사범",
  business: "경영", law: "법학", intl: "국제", intlCenter: "국제교류", med: "의학", nursingLec: "간호", nursingLab: "간호실습",
  pharmacy: "약학", artsLec: "예술", artsLab: "예술실습", music: "음악", design: "디자인", auditorium: "강당", museum: "박물관",
  research: "산학협력", grad: "대학원", welfare: "복지", computing: "전산", faculty: "교수회관", lifelong: "평생교육", generic: "강의동",
  cafeteria: "식당", parking: "주차", courts: "코트",
};

const numbered = (name: string, base: string, two: string, three?: string): string =>
  /(^|[^0-9])2([^0-9]|$)|제2|2호/.test(name) ? two : three && /(^|[^0-9])3([^0-9]|$)|제3|3호/.test(name) ? three : base;

/** 이름(또는 종류 칸의 말)으로 건물 종류를 고른다. 모르는 이름은 일반 강의동. */
export function classifyName(raw: string): string {
  const n = raw.replace(/\s+/g, "");
  const rules: [RegExp, string | ((s: string) => string)][] = [
    [/테니스|농구장|배구장|풋살|코트$/, "courts"],
    [/운동장|경기장|트랙/, "field"],
    [/주차/, "parking"],
    [/식당|카페테리아|푸드코트/, "cafeteria"],
    [/광장$|^광장/, "plaza"],
    [/병원/, "hospital"],
    [/간호.*(실습|시뮬)/, "nursingLab"],
    [/간호/, "nursingLec"],
    [/약학|약대/, "pharmacy"],
    [/의대|의학|의과/, "med"],
    [/국제.*(학사|기숙|생활관)|유학생.*기숙/, "intlDorm"],
    [/고층기숙사/, "dorm2"],
    [/생활관|기숙사|학사$|사생|기숙/, "dorm"],
    [/국제교류|교류센터|국제처/, "intlCenter"],
    [/국제/, "intl"],
    [/소프트웨어|SW|IT|컴퓨터|인공지능|데이터/i, "sw"],
    [/전산|정보원/, "computing"],
    [/산학|창업|연구센터|연구동/, "research"],
    [/공학|공대/, (s) => numbered(s, "eng1", "eng2", "eng3")],
    [/생명/, "lifesci"],
    [/사회/, "social"],
    [/인문/, "humanities"],
    [/자연|과학관|이학|호관/, (s) => numbered(s, "sci1", "sci2")],
    [/예술.*실습|예대.*실습|실기|작업실/, "artsLab"],
    [/음악|연주/, "music"],
    [/디자인/, "design"],
    [/예술|미술|예대/, "artsLec"],
    [/사범|교육대|교원/, "education"],
    [/평생교육/, "lifelong"],
    [/경영|경제|상경/, "business"],
    [/법학|법대|법과/, "law"],
    [/도서관|도서/, "library"],
    [/학생회관|학생회|학관$/, "union"],
    [/체육관|체육|스포츠/, "gym"],
    [/강당|공연|아트홀|문화관/, "auditorium"],
    [/박물관|기념관/, "museum"],
    [/대학원/, "grad"],
    [/복지/, "welfare"],
    [/교수회관/, "faculty"],
    [/본부|본관|행정/, "admin"],
  ];
  for (const [re, t] of rules) if (re.test(n)) return typeof t === "string" ? t : t(n);
  return "generic";
}

/** 종류 칸의 말이면 그 종류, 아니면 undefined */
function typeFromLabel(token: string, name: string): string | undefined {
  const t = token.replace(/\s+/g, "");
  const hit = Object.entries(TYPE_LABEL).find(([, label]) => label === t);
  if (!hit) return undefined;
  if (t === "공학") return numbered(name, "eng1", "eng2", "eng3");
  if (t === "자연과학") return numbered(name, "sci1", "sci2");
  return hit[0];
}

// ── 외관 ─────────────────────────────────────────────────────────────
export const STYLE_LABEL: Record<Style, string> = {
  brick: "벽돌", stone: "석재", glass: "유리", classic: "고전", modern: "현대", concrete: "콘크리트", white: "흰색",
};

/** 외관 묘사에서 외관 종류를 고른다. 아무 단서가 없으면 undefined. */
export function styleFromText(t: string): Style | undefined {
  if (/벽돌/.test(t)) return "brick";
  if (/커튼월|유리 비중|통유리|전면 유리/.test(t)) return "glass";
  if (/흰색|하얀|백색/.test(t)) return "white";
  if (/금속|은회색|콘크리트|회색/.test(t)) return "concrete";
  if (/(석재|석조|대리석)/.test(t) && /유리/.test(t)) return "modern";
  if (/고전|시계탑|열주/.test(t) && /석조|석재/.test(t)) return "classic";
  if (/석재|석조|대리석/.test(t)) return "stone";
  if (/유리/.test(t)) return "glass";
  if (/현대|모던|밝은/.test(t)) return "modern";
  return undefined;
}

function styleFromLabel(token: string): Style | undefined {
  const t = token.replace(/\s+/g, "");
  const hit = (Object.entries(STYLE_LABEL) as [Style, string][]).find(([, label]) => label === t);
  return hit ? hit[0] : undefined;
}

// ── 상징물 ───────────────────────────────────────────────────────────
export const LANDMARK_LABEL: Record<LandmarkKind, string> = {
  fountain: "분수", obelisk: "기념석", loop: "고리", globe: "지구본", book: "책", curve: "곡선", garden: "조각정원",
  emblem: "문장", statue: "동상", bell: "종", pond: "연못",
};

export function landmarkKindFrom(text: string): LandmarkKind | undefined {
  const t = text.replace(/\s+/g, "");
  if (/뫼비우스|무한의고리|고리/.test(t)) return "loop";
  if (/세계의구|지구본|지구의|구형조형/.test(t)) return "globe";
  if (/곡선|나선|파동/.test(t)) return "curve";
  if (/조각정원|조각공원/.test(t)) return "garden";
  if (/문장/.test(t)) return "emblem";
  if (/기념석|기념탑|기념비|이념비|오벨리스크/.test(t)) return "obelisk";
  if (/분수/.test(t)) return "fountain";
  if (/동상|흉상/.test(t)) return "statue";
  if (/연못|호수/.test(t)) return "pond";
  if (/종각|의종$|^종$/.test(t)) return "bell";
  if (/책/.test(t)) return "book";
  return undefined;
}

// ── 위치 ─────────────────────────────────────────────────────────────
const DIR_WORDS: [RegExp, Dir][] = [
  [/북동|동북/, "NE"], [/북서|서북/, "NW"], [/남동|동남/, "SE"], [/남서|서남/, "SW"],
  [/북/, "N"], [/남/, "S"], [/동/, "E"], [/서/, "W"],
];
const DIR_RE = /(북동|동북|북서|서북|남동|동남|남서|서남|북|남|동|서)(쪽|측|편)/g;

function dirOf(word: string): Dir | undefined {
  for (const [re, d] of DIR_WORDS) if (re.test(word)) return d;
  return undefined;
}

/** 위치 묘사에 나오는 기준 이름과 그 별칭 */
export interface NameIndex { names: string[]; aliases: Map<string, string> }

export function nameIndex(items: readonly Pick<ProgramItem, "name" | "type">[]): NameIndex {
  const aliases = new Map<string, string>();
  const add = (alias: string, name: string): void => { if (!aliases.has(alias)) aliases.set(alias, name); };
  for (const it of items) {
    add(it.name, it.name);
    if (it.type === "admin") { add("본관", it.name); add("본부", it.name); add("대학본부", it.name); }
    if (it.type === "plaza") add("광장", it.name);
    if (it.type === "hospital") { add("대학병원", it.name); add("병원", it.name); }
    if (it.type === "library") add("도서관", it.name);
    if (it.type === "gym") add("체육관", it.name);
  }
  add("정문", "정문");
  add("후문", "후문");
  return { names: items.map((i) => i.name), aliases };
}

/** 구역 이름 → 그 구역을 대표하는 종류 (상징물 위치용) */
const ZONES: [RegExp, string[]][] = [
  [/자연과학구역|자연대 구역/, ["sci1", "sci2", "lifesci"]],
  [/공학구역|공대 구역/, ["eng1", "eng2", "eng3", "sw"]],
  [/인문구역/, ["humanities", "social", "education"]],
  [/체육구역|운동시설 구역/, ["gym", "field"]],
  [/주거구역|기숙사 구역/, ["dorm", "intlDorm", "dorm2"]],
  [/예술구역/, ["artsLec", "artsLab"]],
  [/의료구역|병원 구역/, ["hospital", "med"]],
];

/**
 * 위치 묘사를 읽는다. 예: "중앙광장 동쪽", "남동쪽 간호대 강의동 옆", "인문강의동과 사회과학관 사이", "북동쪽 외곽 국제관 인근".
 * self는 자기 자신을 기준으로 잡지 않도록 뺀다. zoneItems를 주면 '자연과학구역' 같은 말도 기준으로 쓴다.
 */
export function parsePlace(
  phrase: string, idx: NameIndex, self?: string, zoneItems?: readonly Pick<ProgramItem, "name" | "type">[],
): PlaceHint | undefined {
  const text = phrase.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  interface Hit { name: string; start: number; end: number }
  const hits: Hit[] = [];
  const taken: boolean[] = new Array(text.length).fill(false);
  const keys = [...idx.aliases.keys()].sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const target = idx.aliases.get(key)!;
    if (target === self) continue;
    let from = 0;
    for (;;) {
      const i = text.indexOf(key, from);
      if (i < 0) break;
      from = i + key.length;
      if (taken.slice(i, i + key.length).some(Boolean)) continue;
      // '광장'이 '진입광장'처럼 다른 말의 일부면 기준으로 보지 않는다.
      if (key.length <= 3 && i > 0 && /[가-힣]/.test(text[i - 1]) && key !== target) continue;
      for (let k = i; k < i + key.length; k++) taken[k] = true;
      hits.push({ name: target, start: i, end: i + key.length });
    }
  }
  if (zoneItems) {
    for (const [re, types] of ZONES) {
      const m = re.exec(text);
      if (!m || taken[m.index]) continue;
      const it = zoneItems.find((z) => types.includes(z.type) && z.name !== self);
      if (it) hits.push({ name: it.name, start: m.index, end: m.index + m[0].length });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const dirs: { d: Dir; start: number; end: number }[] = [];
  for (const m of text.matchAll(DIR_RE)) {
    if (taken[m.index!]) continue;
    const d = dirOf(m[1]);
    if (d) dirs.push({ d, start: m.index!, end: m.index! + m[0].length });
  }
  // 'X 동'·'남동 외곽'처럼 쪽·측 없이 쓴 방향 (목록 형식에서 흔하다)
  for (const m of text.matchAll(/(?:^|\s)(북동|동북|북서|서북|남동|동남|남서|서남|북|남|동|서)(?=\s|,|$)/g)) {
    const start = m.index! + m[0].indexOf(m[1]);
    if (taken[start] || dirs.some((x) => x.start === start)) continue;
    const d = dirOf(m[1]);
    if (d) dirs.push({ d, start, end: start + m[1].length });
  }
  dirs.sort((a, b) => a.start - b.start);
  const hint: PlaceHint = {};
  const rest = text.split("").map((c, i) => (taken[i] ? " " : c)).join("");
  if (/외곽|가장자리|변두리|바깥쪽/.test(rest)) hint.ring = "outer";
  else if (/중앙|중심|가운데|한가운데/.test(rest)) hint.ring = "center";

  // 'A 강의동과 실습동 사이'처럼 두 번째 이름을 줄여 쓰면 첫 이름의 앞부분을 붙여 찾는다.
  if (hits.length === 1 && /사이/.test(text)) {
    const h = hits[0];
    const m = /^\s*(과|와|및|,)\s*([가-힣A-Za-z0-9]+)\s*(의\s*)?사이/.exec(text.slice(h.end));
    if (m) {
      const short = m[2];
      const prefix = h.name.includes(" ") ? h.name.slice(0, h.name.lastIndexOf(" ") + 1) : "";
      const full = idx.aliases.get(short) ?? idx.aliases.get(prefix + short)
        ?? idx.names.find((n) => n !== h.name && n !== self && n.endsWith(short));
      if (full && full !== self) hits.push({ name: full, start: h.end, end: h.end + m[0].length });
    }
  }
  if (hits.length >= 2 && /사이/.test(text)) {
    hint.ref = hits[0].name;
    hint.ref2 = hits[1].name;
    hint.rel = "between";
  } else if (hits.length) {
    // 관계가 붙은 기준을 고른다 (없으면 첫 기준)
    let chosen = hits[0];
    let rel: Relation = "near";
    let relDir: Dir | undefined;
    for (const h of hits) {
      const after = text.slice(h.end, h.end + 8);
      const d = dirs.find((x) => x.start >= h.end && x.start - h.end <= 4);
      if (d) { chosen = h; rel = "dir"; relDir = d.d; break; }
      if (/^\s*(바로\s*)?(옆|인근|근처|가까|맞은편|곁)/.test(after)) { chosen = h; rel = "near"; break; }
      if (/^\s*(바로\s*)?(앞|정면)/.test(after)) { chosen = h; rel = "front"; break; }
      if (/^\s*(바로\s*)?(뒤|뒤편|뒤쪽|후면)/.test(after)) { chosen = h; rel = "back"; break; }
      if (/^\s*(안쪽|안|내부)/.test(after)) { chosen = h; rel = "inside"; break; }
    }
    hint.ref = chosen.name;
    hint.rel = rel;
    if (relDir) hint.dir = relDir;
    const abs = dirs.find((x) => !(x.start >= chosen.end && x.start - chosen.end <= 4));
    if (abs) hint.absDir = abs.d;
  } else if (dirs.length) {
    hint.absDir = dirs[0].d;
  }
  if (!hint.ref && !hint.absDir && !hint.ring) return undefined;
  return hint;
}

export function placeToText(p: PlaceHint | undefined): string {
  if (!p) return "";
  const parts: string[] = [];
  if (p.absDir || p.ring) {
    const d = p.absDir ? `${DIR_KO[p.absDir]}쪽` : "";
    parts.push(p.ring === "center" ? `중앙 ${d}`.trim() : p.ring === "outer" ? `${d} 외곽`.trim() : d);
  }
  if (p.ref) {
    switch (p.rel) {
      case "dir": parts.push(`${p.ref} ${p.dir ? DIR_KO[p.dir] + "쪽" : "옆"}`); break;
      case "front": parts.push(`${p.ref} 앞`); break;
      case "back": parts.push(`${p.ref} 뒤`); break;
      case "between": parts.push(`${p.ref}${josaWa(p.ref)} ${p.ref2} 사이`); break;
      case "inside": parts.push(`${p.ref} 안쪽`); break;
      default: parts.push(`${p.ref} 옆`);
    }
  }
  return parts.filter(Boolean).join(", ");
}

function josaWa(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (!(code >= 0 && code <= 11171)) return "와(과)";
  return code % 28 === 0 ? "와" : "과";
}

// ── 목록 형식 읽기·쓰기 ──────────────────────────────────────────────
const clean = (s: string, max = 24): string =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** 목록 형식 텍스트를 읽는다. 알아보지 못한 칸은 경고로 알려 주고 건너뛴다. */
export function parseProgram(text: string): ParseResult {
  const warnings: string[] = [];
  const program: Program = { items: [], landmarks: [] };
  const lines = text.slice(0, MAX_PROGRAM_TEXT).split(/\r?\n/);
  const rawItems: { fields: string[]; line: number }[] = [];
  const rawLandmarks: { fields: string[]; line: number }[] = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("//")) return;
    if (t.startsWith("@")) {
      const m = /^@(\S+)\s*(.*)$/.exec(t)!;
      const key = m[1], val = m[2].trim();
      if (key === "이름" || key === "대학") {
        const n = clean(val, 20);
        if (n) program.name = /(대학교|대학|university)$/iu.test(n) ? n : `${n}대학교`;
      } else if (key === "크기") {
        const s = /(\d{2,4})\s*[x×*,]\s*(\d{2,4})/.exec(val);
        if (s) {
          const w = Math.min(1400, Math.max(300, Number(s[1]))), h = Math.min(1200, Math.max(250, Number(s[2])));
          program.size = [w, h];
        } else warnings.push(`${i + 1}줄: 크기는 '700x600'처럼 적어 주세요.`);
      } else if (key === "부지") {
        const m = /^(자동\s*)?(\d{1,2})$/.exec(val);
        if (m) program.site = { auto: !!m[1], buildings: Math.max(6, Math.min(40, Number(m[2]))) };
        else warnings.push(`${i + 1}줄: 부지는 '@부지 25'나 '@부지 자동 24'처럼 적어 주세요.`);
      } else if (key === "상징물") {
        rawLandmarks.push({ fields: val.split("|").map((f) => f.trim()), line: i + 1 });
      } else warnings.push(`${i + 1}줄: 알 수 없는 설정 '@${key}'`);
      return;
    }
    rawItems.push({ fields: t.split("|").map((f) => f.trim()), line: i + 1 });
  });
  if (rawItems.length > MAX_PROGRAM_ITEMS) {
    warnings.push(`건물은 ${MAX_PROGRAM_ITEMS}개까지 읽습니다 (${rawItems.length - MAX_PROGRAM_ITEMS}개 건너뜀).`);
    rawItems.length = MAX_PROGRAM_ITEMS;
  }
  // 1차: 이름과 종류를 먼저 정해야 위치 묘사의 기준 이름을 알아볼 수 있다.
  const seen = new Set<string>();
  const firstPass = rawItems.map(({ fields, line }) => {
    let name = clean(fields[0] ?? "");
    if (!name) return undefined;
    if (seen.has(name)) {
      warnings.push(`${line}줄: '${name}'이(가) 이미 있어 이름 뒤에 번호를 붙였습니다.`);
      let k = 2;
      while (seen.has(`${name} ${k}`)) k++;
      name = `${name} ${k}`;
    }
    seen.add(name);
    const typeField = fields.slice(1).map((f) => typeFromLabel(f, name)).find(Boolean);
    return { name, type: typeField ?? classifyName(name), fields: fields.slice(1), line };
  }).filter((x): x is NonNullable<typeof x> => !!x);
  const idx = nameIndex(firstPass);
  for (const it of firstPass) {
    const item: ProgramItem = { name: it.name, type: it.type };
    for (const f of it.fields) {
      if (!f) continue;
      if (typeFromLabel(f, it.name)) continue;
      const fl = /^(?:지상\s*)?(\d{1,2})\s*층$/.exec(f);
      if (fl) { item.floors = Math.max(1, Math.min(25, Number(fl[1]))); continue; }
      if (/^번호\s*없음$|^번호없음$/.test(f)) { item.unlisted = true; continue; }
      if (readGeometry(f, item)) continue;
      const st = styleFromLabel(f);
      if (st) { item.style = st; continue; }
      const place = parsePlace(f, idx, it.name);
      if (place) { item.place = mergePlace(item.place, place); continue; }
      const st2 = styleFromText(f);
      if (st2) { item.style = st2; continue; }
      warnings.push(`${it.line}줄: '${f}'을(를) 알아보지 못해 건너뜁니다.`);
    }
    program.items.push(item);
  }
  for (const { fields, line } of rawLandmarks) {
    const name = clean(fields[0] ?? "");
    if (!name) continue;
    let kind = fields.slice(1).map((f) => (Object.entries(LANDMARK_LABEL) as [LandmarkKind, string][]).find(([, l]) => l === f.replace(/\s+/g, ""))?.[0]).find(Boolean);
    kind ??= landmarkKindFrom(name);
    if (!kind) { warnings.push(`${line}줄: '${name}'의 상징물 종류를 알 수 없습니다 (분수·기념석·고리·지구본·책·곡선·조각정원·문장·동상·종·연못).`); continue; }
    const lm: ProgramLandmark = { name, kind };
    for (const f of fields.slice(1)) {
      if (!f || (Object.values(LANDMARK_LABEL) as string[]).includes(f.replace(/\s+/g, ""))) continue;
      if (readGeometry(f, lm)) continue;
      const place = parsePlace(f, idx, undefined, program.items);
      if (place) lm.place = mergePlace(lm.place, place);
      else warnings.push(`${line}줄: '${f}'을(를) 알아보지 못해 건너뜁니다.`);
    }
    program.landmarks.push(lm);
  }
  // 기준으로 쓴 이름이 목록에 없으면 알려 준다.
  for (const it of [...program.items, ...program.landmarks]) {
    for (const r of [it.place?.ref, it.place?.ref2]) {
      if (r && r !== "정문" && r !== "후문" && !idx.names.includes(r)) warnings.push(`'${it.name}'의 기준 '${r}'이(가) 목록에 없습니다.`);
    }
  }
  return { program, warnings };
}

function mergePlace(a: PlaceHint | undefined, b: PlaceHint): PlaceHint {
  if (!a) return b;
  return {
    ref: a.ref ?? b.ref, rel: a.ref ? a.rel : b.rel, dir: a.ref ? a.dir : b.dir, ref2: a.ref2 ?? b.ref2,
    absDir: a.absDir ?? b.absDir, ring: a.ring ?? b.ring,
  };
}

export function programToText(p: Program, header?: string): string {
  const out: string[] = [];
  if (header) for (const h of header.split("\n")) out.push(`# ${h}`);
  if (p.name) out.push(`@이름 ${p.name}`);
  if (p.size) out.push(`@크기 ${p.size[0]}x${p.size[1]}`);
  if (p.site) out.push(`@부지 ${p.site.auto ? "자동 " : ""}${p.site.buildings}`);
  for (const it of p.items) {
    const f = [it.name, TYPE_LABEL[it.type] ?? "강의동"];
    if (it.floors) f.push(`${it.floors}층`);
    const place = placeToText(it.place);
    if (place) f.push(place);
    if (it.style) f.push(STYLE_LABEL[it.style]);
    if (it.unlisted) f.push("번호 없음");
    if (it.at) f.push(`좌표 ${it.at[0]},${it.at[1]}`);
    if (it.angle !== undefined) f.push(`각도 ${it.angle}`);
    if (it.size) f.push(`크기 ${it.size[0]}x${it.size[1]}`);
    if (it.shape) f.push(`모양 ${SHAPE_LABEL[it.shape]}`);
    if (it.variant !== undefined) f.push(`세부 ${Math.round(it.variant * 1000) / 1000}`);
    const ft = formToText(it.form);
    if (ft) f.push(`형태 ${ft}`);
    if (it.form?.grid && it.shape === "custom") f.push(`평면 ${gridToText(it.form.grid)}`);
    out.push(f.join(" | "));
  }
  for (const lm of p.landmarks) {
    const f = [lm.name, LANDMARK_LABEL[lm.kind]];
    const place = placeToText(lm.place);
    if (place) f.push(place);
    if (lm.at) f.push(`좌표 ${lm.at[0]},${lm.at[1]}`);
    out.push(`@상징물 ${f.join(" | ")}`);
  }
  return out.join("\n");
}

// ── 설정 글에서 뽑기 ─────────────────────────────────────────────────
const FACILITY_SUFFIX = /(관|동|센터|학사|병원|본부|광장|도서관|체육관|회관|생활관|기숙사|강당|박물관|연구소|호관|타워|홀)$/;
const SKIP_SECTION = /변경|기록|되돌릴|목차|부록|메모|참고|todo/i;

interface Section { title: string; body: string[] }

function sections(text: string): Section[] {
  const out: Section[] = [{ title: "", body: [] }];
  for (const line of text.split(/\r?\n/)) {
    const h = /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
    if (h) { out.push({ title: h[1].replace(/^\d+\s*[.)]\s*/, "").replace(/[*_`]/g, "").trim(), body: [] }); continue; }
    out[out.length - 1].body.push(line);
  }
  return out;
}

/** 표·메타데이터 줄을 빼고 문장만 남긴다. */
function prose(lines: string[]): string {
  return lines
    .filter((l) => {
      const t = l.trim();
      return t && !t.startsWith("|") && !/^\*\*[^*]+:\*\*/.test(t) && !t.startsWith("```") && !/^[-*]\s*(상태|키워드|본문 글자 수)\s*:/.test(t);
    })
    .map((l) => l.replace(/^\s*[-*>]\s+/, "").replace(/[*_`]/g, ""))
    .join("\n");
}

const sentencesOf = (t: string): string[] => t.split(/(?<=[.!?。])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

/** 문장에서 '{이름}은/는 ... 의 지하·지상' 앞의 위치 묘사를 떼어 낸다. */
function locationPhrase(sentence: string, name: string): string | undefined {
  const i = sentence.indexOf(name);
  if (i < 0) return undefined;
  // 'A동과 B동은 동쪽 언덕 위에 있다'처럼 함께 쓴 주어는 건너뛴다.
  let rest = sentence.slice(i + name.length).replace(/^(과|와|및)\s*\S+?(은|는|이|가)\s+/, "").replace(/^(은|는|이|가)\s*/, "");
  const cut = /(의\s*(지하|지상|\d)|에\s*(있|자리|위치|세워|들어|놓)|\s(지하|지상)\s*\d|\d+\s*층)/.exec(rest);
  if (cut) rest = rest.slice(0, cut.index);
  else {
    const c2 = /[.。]/.exec(rest);
    if (c2) rest = rest.slice(0, c2.index);
  }
  rest = rest.trim();
  return rest.length > 0 && rest.length <= 60 ? rest : undefined;
}

/** 상징물이 나오는 문장에서 '... 에는'·'... 에' 앞의 위치 묘사 */
function landmarkPhrase(sentence: string, at: number, univ?: string): string | undefined {
  const before = sentence.slice(0, at);
  const m = /(.*?)(에는|에|의\s)\s/.exec(before);
  if (!m) return undefined;
  let p = m[1];
  if (univ) p = p.replace(univ, "");
  p = p.replace(/^(또한|그리고|한편|그 밖에|이 밖에)\s*/, "").trim();
  return p && p.length <= 50 ? p : undefined;
}

// ── 제목 없는 글: 문장 속 건물 이름 ─────────────────────────────────
/** '…관'·'…센터'·'…동' 같은 건물 이름 뒤에 조사·문장부호가 오는 말 */
const SENT_NAME = /(?<![가-힣A-Za-z0-9])([가-힣A-Za-z0-9]{0,10}?(?:관|센터|학사|병원|기숙사|강당|연구소|타워|홀|(?:강의|연구|실습|실험|교육|행정|학생|[A-Z]|\d{1,2})동))(?=[은는이가을를의에와과도로으및만까부처랑,.·:;!?)'"’”\s]|$)/g;
/** 두 글자여도 건물인 이름 */
const SENT_SHORT_OK = /^(본관|별관|신관|구관|강당|병원)$/;
/** 건물이 아닌 말: 두 글자 '○관'(기관·상관…), 홀로 쓰인 접미사, 사람·생각을 뜻하는 '…관' */
const SENT_NOT = /^(?:[가-힣]관|학사|센터|홀|타워|회관|\d{1,2}동)$|(?:세계|가치|인생|국가|직업|윤리|종교|경찰|소방|사령|지휘|감독|시험|외교|담당|조사|수사|검사|보좌|통역|교도|파견|연락|감찰|참모|영사|대사|수도|자문|공무|심사|면접|감시|관찰|수습|관리|사무|참사|서기|이사|부사|하사|혈|배)관$/;
const SENT_MAX = 40;
/** 'A동' 앞에 붙일 수 있는 건물 이름 말 */
const SENT_NAME_WORD = /(?:기숙사|생활관|학사|관|센터|연구소|병원|아파트)$/;

function sentenceFacilities(src: string): ProgramItem[] {
  const sents = sentencesOf(prose(src.split(/\r?\n/).filter((l) => !/^#{1,6}\s/.test(l))));
  // 이름과 그 이름이 나온 문장들 (처음 나온 순서)
  const mentions = new Map<string, number[]>();
  /** 앞말을 붙인 이름 → 글에 실제로 쓰인 말 ('기숙사 B동' → 'B동') */
  const raw = new Map<string, string>();
  const posOf = (sent: string, name: string): number => {
    const i = sent.indexOf(name);
    return i >= 0 || !raw.has(name) ? i : sent.indexOf(raw.get(name)!);
  };
  sents.forEach((sent, si) => {
    for (const m of sent.matchAll(SENT_NAME)) {
      let name = m[1];
      // 'A동'·'3동'만 있으면 앞말을 붙인다: '기숙사 A동', '기숙사 A동과 B동'
      if (/^(?:[A-Z]|\d{1,2})동$/.test(name)) {
        const before = sent.slice(0, m.index);
        const w = /([가-힣]{2,8})\s+(?:[A-Z]|\d{1,2})동\s*(?:과|와|및|,)\s*$/.exec(before) ?? /([가-힣]{2,8})\s+$/.exec(before);
        if (w && SENT_NAME_WORD.test(w[1])) { name = `${w[1]} ${name}`; raw.set(name, m[1]); }
      }
      if (name.length < 2 || (!SENT_SHORT_OK.test(name) && SENT_NOT.test(name)) || /대학교?관$/.test(name)) continue;
      const list = mentions.get(name);
      if (list) { if (list[list.length - 1] !== si) list.push(si); } else if (mentions.size < SENT_MAX) mentions.set(name, [si]);
    }
  });
  const items: ProgramItem[] = [...mentions.keys()].map((name) => ({ name, type: classifyName(name) }));
  const idx = nameIndex(items);
  const names = [...mentions.keys()];
  /** 이 문장에서 at 앞에 마지막으로 나온 다른 건물 (없으면 앞 문장의 마지막 건물) */
  const previousName = (si: number, at: number, self: string): string | undefined => {
    for (let k = si; k >= Math.max(0, si - 1); k--) {
      const sent = sents[k];
      let best: string | undefined, bestAt = -1;
      for (const n of names) {
        if (n === self) continue;
        const i = k === si ? sent.lastIndexOf(n, at - 1) : sent.lastIndexOf(n);
        if (i > bestAt && (k !== si || i + n.length <= at)) { best = n; bestAt = i; }
      }
      if (best) return best;
    }
    return undefined;
  };
  items.forEach((item) => {
    const where = mentions.get(item.name)!;
    for (const si of where) {
      const place = sentencePlace(sents[si], item.name, raw.get(item.name) ?? item.name, idx, items, (at) => previousName(si, at, item.name));
      if (place) { item.place = place; break; }
    }
    // 층수: 건물 높이를 말할 때만 ('5층짜리 인문관', '인문관은 지상 5층 건물'). '3층 강의실'은 건물 안 자리다.
    const outdoor = item.type === "plaza" || item.type === "field" || item.type === "courts";
    for (const si of where) {
      if (outdoor) break;
      const sent = sents[si], at = posOf(sent, item.name);
      if (at < 0) continue;
      const after = /^[^.]{0,30}?(?:지상\s*(\d{1,2})\s*층|(\d{1,2})\s*층\s*(?:짜리|건물|높이|규모|으로|이다|이며|이고))/.exec(sent.slice(at + (sent.includes(item.name) ? item.name : raw.get(item.name)!).length));
      const before = /(?:지상\s*)?(\d{1,2})\s*층\s*(?:짜리|규모|높이)\s*(?:의\s*)?[^.,]{0,14}$/.exec(sent.slice(0, at));
      const n = after ? Number(after[1] ?? after[2]) : before ? Number(before[1]) : 0;
      if (n) { item.floors = Math.max(1, Math.min(25, n)); break; }
    }
    if (item.type !== "admin" && item.type !== "plaza") {
      // 외관: 이름 바로 앞 꾸밈말('붉은 벽돌의 인문관')과 이름 뒤 문장
      const sent = sents[where[0]], at = Math.max(0, posOf(sent, item.name));
      const near = sent.slice(Math.max(0, at - 16), at) + sent.slice(at);
      const st = styleFromText(near.replace(/지하\s*\d+층|지상\s*\d+층/g, ""));
      if (st) item.style = st;
    }
  });
  return items;
}

/** 문장에서 이름 앞 마디('캠퍼스 북쪽에는', '그 옆으로')나 뒤 마디('…은 도서관 동쪽에 있다')로 위치를 읽는다. */
function sentencePlace(
  sent: string, name: string, written: string, idx: NameIndex, items: readonly ProgramItem[], previous: (at: number) => string | undefined,
): PlaceHint | undefined {
  // 글에 이름이 그대로 있으면 그것을, 앞말을 붙인 이름이면 글에 쓰인 말을 찾는다.
  const word = sent.includes(name) ? name : written;
  const at = sent.indexOf(word);
  if (at < 0) return undefined;
  const seg = sent.slice(0, at).split(/[,，]|(?:있고|있으며|이고|이며|하고|하며|지만|는데|었고|였고|었으며|였으며)\s/).pop()!.trim();
  const pron = /^(?:그|이|그곳|그 건물)\s*(?:바로\s*)?(옆|앞|뒤|뒤편|뒤쪽|맞은편|건너편|근처|인근|곁)/.exec(seg);
  if (pron) {
    const ref = previous(at);
    if (ref) return { ref, rel: pron[1] === "앞" ? "front" : pron[1].startsWith("뒤") ? "back" : "near" };
  }
  const phrase = seg.replace(/\s*(에는|에선|에서는|에|으로는|으로|로는|로|의)\s*$/, "").trim();
  // 'A동과 B동은 …'처럼 앞말이 함께 쓴 주어면 위치가 아니다.
  if (phrase && phrase.length <= 50 && !/(?:과|와|및)$/.test(seg)) {
    const p = parsePlace(phrase, idx, name, items);
    if (p) return p;
  }
  const lp = locationPhrase(sent, word);
  return lp ? parsePlace(lp, idx, name, items) : undefined;
}

/**
 * 설정 글(마크다운·텍스트)에서 시설 목록을 뽑는다. 제목(#)이 시설 이름이고 본문에 층수·'건물'·'야외 공간' 같은
 * 말이 있는 절을 시설로 보고, 첫 문장에서 위치·층수·외관을 읽는다. 상징물은 이름표(따옴표) 또는 '분수'·'기념석'
 * 같은 말과 그 문장의 '…에는' 앞 위치로 찾는다. 결과는 사람이 고쳐 쓸 수 있도록 목록 형식으로 돌려준다.
 */
export function extractFromProse(text: string): ParseResult & { found: { items: number; landmarks: number } } {
  const warnings: string[] = [];
  const src = text.slice(0, 400000);
  const secs = sections(src).filter((s) => !SKIP_SECTION.test(s.title));

  // 대학 이름: 가장 자주 나오는 '○○대학교'
  const counts = new Map<string, number>();
  for (const m of src.matchAll(/([가-힣]{1,8}대학교)(?!병원)/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  const univ = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];

  // 시설 절
  interface Fac { name: string; body: string }
  const facs: Fac[] = [];
  for (const s of secs) {
    const title = s.title.replace(/\s*\(.*\)$/, "").trim();
    if (!title || title.length > 16) continue;
    if (/[과와]\s/.test(title) || / 및 /.test(title)) continue; // '도서관과 정원' 같은 묶음 절
    if (!FACILITY_SUFFIX.test(title)) continue;
    if (/(대학|대학원|대학교)$/.test(title)) continue; // 단과대학은 조직
    const body = prose(s.body);
    if (!/지상\s*\d+\s*층|\d+\s*층\s*(건물|시설)|건물로|시설로|야외\s*(공간|시설)|건물이다|시설이다/.test(body)) continue;
    if (/온라인|커뮤니티|게시판/.test(body.slice(0, 80))) continue;
    if (facs.some((f) => f.name === title)) continue;
    facs.push({ name: title, body });
  }
  const items: ProgramItem[] = facs.map((f) => ({ name: f.name, type: classifyName(f.name) }));
  let idx = nameIndex(items);
  facs.forEach((f, i) => {
    const item = items[i];
    const sents = sentencesOf(f.body);
    const first = sents.find((s) => s.includes(f.name)) ?? sents[0] ?? "";
    const fl = /지상\s*(\d{1,2})\s*층/.exec(first) ?? /(\d{1,2})\s*층\s*(건물|시설|규모)/.exec(f.body);
    if (fl && item.type !== "plaza" && item.type !== "field" && item.type !== "courts") item.floors = Math.max(1, Math.min(25, Number(fl[1])));
    const lp = locationPhrase(first, f.name);
    if (lp) {
      const place = parsePlace(lp, idx, f.name);
      if (place) item.place = place;
    }
    if (item.type !== "admin" && item.type !== "plaza") {
      const looks = first.slice(first.indexOf(f.name));
      const st = styleFromText(looks.replace(/지하\s*\d+층|지상\s*\d+층/g, ""));
      if (st) item.style = st;
    }
  });
  // 제목이 없는 글(소설·서술)은 문장 속 건물 이름으로 찾는다.
  if (!items.length) {
    items.push(...sentenceFacilities(src));
    idx = nameIndex(items);
    if (items.length) warnings.push(`제목이 시설 이름인 절이 없어 문장 속 건물 이름 ${items.length}개를 찾았습니다. 빠지거나 잘못 잡힌 것은 목록에서 고치세요.`);
  }
  if (!items.length) warnings.push("시설을 찾지 못했습니다. 제목(#)에 건물 이름을 쓰고 본문에 층수나 '건물'을 적은 글이면 알아볼 수 있습니다.");

  // 공식 시설은 아니지만 본문에 나오는 운동장
  if (!items.some((i) => i.type === "field")) {
    const m = /(야외\s*운동장|대운동장|운동장)/.exec(src);
    const gym = items.find((i) => i.type === "gym");
    if (m) {
      const near = gym ? new RegExp(`${gym.name}[^.]{0,40}(뒤편|뒤쪽|후면)`).test(src) || /체육관\s*뒤편/.test(src) : false;
      items.push({
        name: m[1].replace(/\s+/g, " "), type: "field", unlisted: true,
        place: gym ? { ref: gym.name, rel: near ? "back" : "near" } : undefined,
      });
    }
  }

  // 상징물
  const known = new Map<string, LandmarkKind>();
  for (const k of Object.keys(LANDMARKS) as LandmarkKind[]) for (const n of LANDMARKS[k].names) known.set(n, k);
  interface Mention { kind: LandmarkKind; name: string; known: boolean; place?: PlaceHint; order: number }
  const mentions: Mention[] = [];
  let order = 0;
  for (const s of secs) {
    const body = prose(s.body);
    const ownerName = facs.find((f) => f.name === s.title.replace(/\s*\(.*\)$/, "").trim())?.name;
    for (const sent of sentencesOf(body)) {
      if (/없다|없으며|존재하지 않|생성되지는 않/.test(sent) && !/[‘'"“]/.test(sent)) continue;
      const found: { kind: LandmarkKind; name: string; at: number; known: boolean }[] = [];
      for (const m of sent.matchAll(/[‘'"“]([^’'"”]{2,14})[’'"”]/g)) {
        const kind = landmarkKindFrom(m[1]);
        if (kind) found.push({ kind, name: m[1].trim(), at: m.index!, known: true });
      }
      for (const [n, kind] of known) {
        const at = sent.indexOf(n);
        if (at >= 0 && !found.some((f) => f.kind === kind)) found.push({ kind, name: n, at, known: true });
      }
      const loose: [RegExp, LandmarkKind][] = [
        [/분수/, "fountain"], [/기념석|기념탑|기념비/, "obelisk"], [/문장 기념물/, "emblem"], [/조각정원/, "garden"],
        [/동상/, "statue"], [/연못/, "pond"],
      ];
      for (const [re, kind] of loose) {
        const m = re.exec(sent);
        if (m && !found.some((f) => f.kind === kind)) found.push({ kind, name: LANDMARKS[kind].names[0], at: m.index, known: false });
      }
      for (const f of found) {
        const phrase = landmarkPhrase(sent, f.at, univ);
        let place = phrase ? parsePlace(phrase, idx, undefined, items) : undefined;
        // 시설 절 안에서 기준 없이 '동쪽에'라고 하면 그 시설을 기준으로 본다.
        if (place && !place.ref && ownerName && place.absDir && place.ring !== "outer") {
          place = { ref: ownerName, rel: "dir", dir: place.absDir };
        }
        mentions.push({ kind: f.kind, name: f.name, known: f.known, place, order: order++ });
      }
    }
  }
  const landmarks: ProgramLandmark[] = [];
  for (const kind of Object.keys(LANDMARKS) as LandmarkKind[]) {
    const ms = mentions.filter((m) => m.kind === kind);
    if (!ms.length) continue;
    // 이름이 분명한 언급 → 위치가 있는 언급 → 먼저 나온 언급 순으로 고른다.
    const best = [...ms].sort((a, b) => Number(b.known) - Number(a.known) || Number(!!b.place) - Number(!!a.place) || a.order - b.order)[0];
    const placed = best.place ? best : ms.find((m) => m.place) ?? best;
    landmarks.push({ name: best.name, kind, place: placed.place });
  }
  const m = /동서\s*(\d{3,4})\s*m[^.\n]{0,16}남북\s*(\d{3,4})\s*m/.exec(src);
  const program: Program = { name: univ, size: m ? [Number(m[1]), Number(m[2])] : undefined, items, landmarks };
  return { program, warnings, found: { items: items.length, landmarks: landmarks.length } };
}

/** 글이 목록 형식인지 (대부분의 줄이 '|'를 쓰거나 '@'로 시작) */
export function looksLikeProgram(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return false;
  const structured = lines.filter((l) => l.startsWith("@") || /^[^|]{1,24}\|/.test(l)).length;
  return structured / lines.length > 0.6;
}
