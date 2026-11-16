import assert from "node:assert/strict";
import { test } from "node:test";
import { generateLayout } from "../src/layout.ts";
import { campusPlaces } from "../src/places.ts";
import { searchPlaces } from "../src/search.ts";
import { generateSite } from "../src/site.ts";

const layout = generateLayout(generateSite("장소 검색", 18), { seed: "장소 검색", buildings: 18, hospital: true, name: "" });

test("안내 번호는 정확히 일치하고 층수나 다른 번호와 혼동하지 않는다", () => {
  const places = campusPlaces(layout);
  for (const q of ["1", "1번", "１번"]) {
    const found = searchPlaces(places, q);
    assert.equal(found.length, 1);
    assert.equal(found[0].number, 1);
    assert.equal(found[0].id, layout.buildings[0].id);
  }
  assert.equal(searchPlaces(places, "999번").length, 0);
});

test("번호 없는 야외 시설과 숨긴 이름표도 찾으며 안내 번호를 밀지 않는다", () => {
  const changed = structuredClone(layout);
  changed.buildings[1].unlisted = true;
  changed.buildings[2].labelHidden = true;
  const places = campusPlaces(changed);
  const outdoor = searchPlaces(places, changed.buildings[1].name, "place");
  assert.equal(outdoor[0].number, undefined);
  assert.equal(outdoor[0].kind, "building");
  assert.equal(searchPlaces(places, "2번")[0].id, changed.buildings[2].id);
  assert.ok(searchPlaces(places, changed.buildings[2].name).some((p) => p.id === changed.buildings[2].id));
});

test("메모 내용과 상징물 이름도 검색하되 종류 필터를 지킨다", () => {
  const changed = { ...layout, notes: [{ id: 999, x: 12, y: 34, title: "약속 장소", text: "금요일 정오 동아리 312호 모임", color: "blue" as const }] };
  const places = campusPlaces(changed);
  const note = searchPlaces(places, "정오 금요일", "note");
  assert.equal(note.length, 1);
  assert.equal(note[0].key, "note:999");
  assert.equal(note[0].x, 12);
  assert.equal(searchPlaces(places, "정오", "building").length, 0);
  assert.equal(searchPlaces(places, "312", "note").length, 1);
  const landmark = layout.landmarks[0];
  assert.equal(searchPlaces(places, landmark.name, "landmark")[0].id, landmark.id);
});

test("이름·배치·번호를 고친 결과를 새 검색에 반영하고 데이터를 바꾸지 않는다", () => {
  const changed = structuredClone(layout);
  changed.buildings.shift();
  changed.buildings[0].name = "West Library";
  changed.buildings[0].x = 123;
  const before = JSON.stringify(changed);
  const found = searchPlaces(campusPlaces(changed), "  ＷＥＳＴ    library  ");
  assert.equal(found.length, 1);
  assert.equal(found[0].number, 1);
  assert.equal(found[0].x, 123);
  assert.equal(searchPlaces(campusPlaces(changed), "존재하지 않는 장소").length, 0);
  assert.equal(JSON.stringify(changed), before);
});

test("이름 붙인 호실을 호실 이름·건물 이름·호실 번호로 찾고, 고르면 그 건물을 가리킨다", () => {
  const changed = structuredClone(layout);
  const b = changed.buildings.find((x) => !x.unlisted && x.floors >= 3)!;
  b.rooms = { "301": "물리학과 사무실", "105": "수학과 세미나실", "99-101": "깨진 번호" };
  const other = changed.buildings.find((x) => x !== b)!;
  other.rooms = { [`${other.floors + 1}01`]: "사라진 층의 방" };
  const places = campusPlaces(changed);
  const rooms = places.filter((p) => p.category === "room");
  assert.deepEqual(rooms.map((p) => p.name), ["수학과 세미나실", "물리학과 사무실"], "번호 순, 없는 층·깨진 번호는 뺀다");
  for (const p of rooms) {
    assert.equal(p.kind, "building");
    assert.equal(p.id, b.id);
    assert.equal(p.number, undefined, "건물 안내 번호 검색과 섞이지 않는다");
    assert.deepEqual([p.x, p.y], [b.x, b.y]);
  }
  assert.equal(rooms[1].detail, `호실 · ${b.name} 301호 (3층)`);
  assert.deepEqual(rooms.map((p) => p.room), [{ floor: 1, no: "105" }, { floor: 3, no: "301" }], "고르면 평면도를 열 층·호실");
  assert.ok(places.filter((p) => p.category !== "room").every((p) => p.room === undefined));
  assert.deepEqual(searchPlaces(places, "물리학과").map((p) => p.key), [`room:${b.id}:301`]);
  assert.deepEqual(searchPlaces(places, `${b.name} 105호`, "room").map((p) => p.name), ["수학과 세미나실"]);
  assert.equal(searchPlaces(places, "세미나실", "building").length, 0, "종류 필터를 지킨다");
  assert.equal(searchPlaces(campusPlaces(layout), "물리학과").length, 0, "이름이 없으면 결과도 없다");
});
