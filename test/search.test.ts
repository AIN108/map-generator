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
