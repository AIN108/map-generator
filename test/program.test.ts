import assert from "node:assert/strict";
import { test } from "node:test";
import { convexOverlap, pointInPolygon } from "../src/geom.ts";
import { footprint, numberMap } from "../src/layout.ts";
import { classifyName, extractFromProse, looksLikeProgram, parsePlace, parseProgram, programToText, nameIndex } from "../src/program.ts";
import { generateFromProgram } from "../src/programLayout.ts";

test("이름으로 종류를 짐작한다", () => {
  const cases: [string, string][] = [
    ["대학본부", "admin"], ["중앙광장", "plaza"], ["중앙도서관", "library"], ["학생회관", "union"], ["제1공학관", "eng1"],
    ["제2공학관", "eng2"], ["자연대 2호관", "sci2"], ["사회과학관", "social"], ["의대 본관", "med"], ["사범대 본관", "education"],
    ["간호대 실습동", "nursingLab"], ["간호대 강의동", "nursingLec"], ["예술대 실습동", "artsLab"], ["국제학사", "intlDorm"],
    ["학생생활관", "dorm"], ["국제교류센터", "intlCenter"], ["한빛대학교병원", "hospital"], ["야외 운동장", "field"],
    ["소프트웨어센터", "sw"], ["다산관", "generic"],
  ];
  for (const [name, type] of cases) assert.equal(classifyName(name), type, name);
});

test("위치 묘사: 방향·옆·사이·앞뒤·외곽", () => {
  const idx = nameIndex([
    { name: "대학본부", type: "admin" }, { name: "중앙광장", type: "plaza" }, { name: "국제관", type: "intl" },
    { name: "예술대 강의동", type: "artsLec" }, { name: "예술대 실습동", type: "artsLab" }, { name: "인문강의동", type: "humanities" },
  ]);
  assert.deepEqual(parsePlace("중앙광장 동쪽", idx), { ref: "중앙광장", rel: "dir", dir: "E" });
  assert.deepEqual(parsePlace("대학본부 바로 남쪽", idx), { ref: "대학본부", rel: "dir", dir: "S" });
  assert.deepEqual(parsePlace("북동쪽 외곽 국제관 인근", idx), { ref: "국제관", rel: "near", absDir: "NE", ring: "outer" });
  assert.deepEqual(parsePlace("예술대 강의동과 실습동 사이", idx), { ref: "예술대 강의동", ref2: "예술대 실습동", rel: "between" });
  assert.deepEqual(parsePlace("국제관 앞 진입광장", idx), { ref: "국제관", rel: "front" });
  assert.deepEqual(parsePlace("본관 북서측 기념정원", idx), { ref: "대학본부", rel: "dir", dir: "NW" });
  assert.deepEqual(parsePlace("캠퍼스 중앙 북동쪽", idx), { absDir: "NE", ring: "center" });
  assert.deepEqual(parsePlace("남서", idx), { absDir: "SW" });
  assert.equal(parsePlace("아무 말", idx), undefined);
  // 자기 자신은 기준이 되지 않는다
  assert.deepEqual(parsePlace("인문강의동 남쪽", idx, "인문강의동"), { absDir: "S" });
});

const SAMPLE = `@이름 가람
@크기 800x640
# 주석 줄
본관 | 본부 | 4층 | 중앙
가람광장 | 광장
해솔도서관 | 도서관 | 6층 | 가람광장 동쪽 | 유리
다산관 | 인문 | 5층 | 북서쪽 | 벽돌
율곡관 | 다산관 남쪽
제1공학관 | 8층 | 동쪽
제2공학관 | 제1공학관 동쪽
가람학사 | 기숙사 | 11층 | 남쪽 외곽
체육관 | 남서쪽
야외 운동장 | 체육관 뒤 | 번호 없음
이상한관 | 하늘을 나는
@상징물 개교 기념탑 | 기념석 | 본관 북쪽
@상징물 지혜의 책 | 책 | 해솔도서관 앞
@상징물 이름만`;

test("목록 형식 읽기", () => {
  const { program, warnings } = parseProgram(SAMPLE);
  assert.equal(program.name, "가람대학교");
  assert.deepEqual(program.size, [800, 640]);
  assert.equal(program.items.length, 11);
  const lib = program.items.find((i) => i.name === "해솔도서관")!;
  assert.deepEqual(lib, { name: "해솔도서관", type: "library", floors: 6, style: "glass", place: { ref: "가람광장", rel: "dir", dir: "E" } });
  assert.equal(program.items.find((i) => i.name === "다산관")!.type, "humanities");
  assert.equal(program.items.find((i) => i.name === "야외 운동장")!.unlisted, true);
  assert.deepEqual(program.items.find((i) => i.name === "가람학사")!.place, { absDir: "S", ring: "outer" });
  assert.equal(program.landmarks.length, 2);
  assert.ok(warnings.some((w) => w.includes("하늘을 나는")), "알 수 없는 칸 경고");
  assert.ok(warnings.some((w) => w.includes("이름만")), "종류를 모르는 상징물 경고");
  assert.equal(looksLikeProgram(SAMPLE), true);
  assert.equal(looksLikeProgram("# 제목\n그냥 글입니다. 도서관은 동쪽에 있다.\n또 다른 문장."), false);
});

test("목록 → 글 → 목록이 같다", () => {
  const { program } = parseProgram(SAMPLE);
  const again = parseProgram(programToText(program)).program;
  assert.deepEqual(again, program);
});

const PROSE = `# 가람대학교 설정

## 가람대학교
가람대학교는 가상의 사립대학이다. 캠퍼스는 동서 800m, 남북 640m쯤이다.

## 인문대학
가람대학교 인문대학은 국문학과로 구성된 단과대학이다. 지상 5층 건물을 쓴다.

## 본관
**키워드:** \`본관,시계탑\`

가람대학교 본관은 캠퍼스 중앙에 자리한 지상 4층 석조 건물로 시계탑이 있다.

## 가람광장
가람광장은 본관 바로 남쪽에 있는 넓은 야외 공간이다. 동쪽에 작은 분수가 있다.

## 해솔도서관
해솔도서관은 가람광장 동쪽의 지하 1층·지상 6층 건물로 유리 커튼월이 특징이다.

## 다산관
다산관은 캠퍼스 북서쪽의 지상 5층 건물로 붉은 벽돌을 썼다.

## 제1공학관
제1공학관은 캠퍼스 동쪽의 지상 8층 건물로 은회색 금속 외관이다.

## 제2공학관
제2공학관은 제1공학관 동쪽의 지상 6층 실험동이다.

## 체육관
체육관은 남서쪽의 지상 3층 시설로 곡면 지붕이 있다. 체육관 뒤편은 야외 운동장이다.

## 가람마당
가람마당은 학생들이 쓰는 익명 온라인 커뮤니티다.

## 조형물
본관 북쪽 정원에는 개교 기념탑이 있다. 해솔도서관 앞 마당에는 ‘지혜의 책’ 조형물이 있다.

## 변경 기록
- 연못을 추가할 수도 있다. 다산관 이름을 바꿨다.
`;

test("설정 글에서 시설·위치·층수·외관·상징물을 뽑는다", () => {
  const r = extractFromProse(PROSE);
  const p = r.program;
  assert.equal(p.name, "가람대학교");
  assert.deepEqual(p.size, [800, 640]);
  const names = p.items.map((i) => i.name);
  assert.deepEqual(names, ["본관", "가람광장", "해솔도서관", "다산관", "제1공학관", "제2공학관", "체육관", "야외 운동장"]);
  const get = (n: string) => p.items.find((i) => i.name === n)!;
  assert.equal(get("본관").type, "admin");
  assert.equal(get("본관").floors, 4);
  assert.deepEqual(get("해솔도서관"), { name: "해솔도서관", type: "library", floors: 6, place: { ref: "가람광장", rel: "dir", dir: "E" }, style: "glass" });
  assert.equal(get("다산관").style, "brick");
  assert.deepEqual(get("다산관").place, { absDir: "NW" });
  assert.equal(get("제1공학관").style, "concrete");
  assert.deepEqual(get("제2공학관").place, { ref: "제1공학관", rel: "dir", dir: "E" });
  assert.deepEqual(get("야외 운동장"), { name: "야외 운동장", type: "field", unlisted: true, place: { ref: "체육관", rel: "back" } });
  const kinds = Object.fromEntries(p.landmarks.map((l) => [l.kind, l]));
  assert.deepEqual(Object.keys(kinds).sort(), ["book", "fountain", "obelisk"]);
  assert.deepEqual(kinds.fountain.place, { ref: "가람광장", rel: "dir", dir: "E" });
  assert.equal(kinds.obelisk.name, "개교 기념탑");
  assert.deepEqual(kinds.obelisk.place, { ref: "본관", rel: "dir", dir: "N" });
  assert.equal(kinds.book.name, "지혜의 책");
  assert.deepEqual(kinds.book.place, { ref: "해솔도서관", rel: "front" });
  // 뽑은 결과는 목록 형식으로 다시 읽어도 같다
  assert.deepEqual(parseProgram(programToText(p)).program, p);
});

test("목록으로 배치: 방향과 기준 관계를 따르고 겹치지 않는다", () => {
  const { program } = parseProgram(SAMPLE);
  const a = generateFromProgram("seed-1", program);
  const b = generateFromProgram("seed-1", program);
  assert.deepEqual(a.layout, b.layout, "같은 시드·목록이면 같은 배치");
  const { site, layout } = a;
  const by = (n: string) => layout.buildings.find((x) => x.name === n)!;
  const plaza = by("가람광장");
  assert.equal(by("본관").type, "admin");
  assert.ok(by("해솔도서관").x > plaza.x + 40, "광장 동쪽");
  assert.ok(Math.abs(by("해솔도서관").y - plaza.y) < 60, "광장 옆");
  assert.ok(by("다산관").x < 0 && by("다산관").y < 0, "북서쪽");
  assert.ok(by("율곡관").y > by("다산관").y, "다산관 남쪽");
  assert.ok(by("제1공학관").x > 0, "동쪽");
  assert.ok(by("제2공학관").x > by("제1공학관").x, "제1공학관 동쪽");
  assert.ok(by("가람학사").y > 0, "남쪽");
  assert.ok(by("체육관").x < 0 && by("체육관").y > 0, "남서쪽");
  assert.ok(Math.hypot(by("야외 운동장").x - by("체육관").x, by("야외 운동장").y - by("체육관").y) < 220, "체육관 가까이");
  // 번호: 목록 순서, 번호 없는 시설은 빠진다
  const numbers = numberMap(layout.buildings);
  assert.equal(numbers.get(by("본관").id), 1);
  assert.equal(numbers.get(by("가람광장").id), 2);
  assert.equal(numbers.get(by("야외 운동장").id), undefined);
  assert.equal(numbers.size, 10);
  // 겹침 없음, 순환도로 안
  const polys = layout.buildings.map(footprint);
  for (let i = 0; i < polys.length; i++) {
    for (const p of polys[i]) assert.ok(pointInPolygon(p, site.ring), `${layout.buildings[i].name} 밖`);
    for (let j = i + 1; j < polys.length; j++) assert.ok(!convexOverlap(polys[i], polys[j], 1), `${layout.buildings[i].name}↔${layout.buildings[j].name}`);
  }
  // 상징물
  const tower = layout.landmarks.find((l) => l.kind === "obelisk")!;
  assert.ok(tower.y < by("본관").y, "본관 북쪽");
  assert.equal(layout.name, "가람대학교");
});

test("서로를 기준으로 삼는 목록도 끝까지 놓는다", () => {
  const { program } = parseProgram(`대학본부 | 본부\n중앙광장 | 광장\nA동 | 남동쪽, B동 옆\nB동 | 남동쪽, A동 옆`);
  const { layout, warnings } = generateFromProgram("cycle", program);
  assert.equal(layout.buildings.length, 4);
  assert.deepEqual(warnings, []);
  const a = layout.buildings.find((x) => x.name === "A동")!, b = layout.buildings.find((x) => x.name === "B동")!;
  assert.ok(a.x > 0 && b.x > 0 && a.y > 0 && b.y > 0, "둘 다 남동쪽");
});
