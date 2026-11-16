// src/ui/place-search.ts 단위 테스트 (지금 동작을 그대로 고정한다)
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { PLACE_CATEGORIES, type CampusPlace } from "../src/places.ts";
import { createPlaceSearch } from "../src/ui/place-search.ts";
import { byId, fire, installDom } from "./helpers/dom.ts";

installDom();

const place = (id: number, name: string, category: string, number?: number, keywords?: string): CampusPlace => ({
  key: `${category}:${id}`, kind: category === "note" ? "note" : category === "landmark" ? "landmark" : "building", id, category, name,
  number, detail: category, keywords, x: id, y: id,
});
const PLACES = [
  place(1, "대학본부", "building", 1),
  place(2, "중앙도서관", "building", 2),
  place(3, "제1공학관", "building", 10),
  place(4, "중앙광장", "place"),
  place(5, "개교 기념탑", "landmark"),
  place(6, "동아리 모임", "note", undefined, "학생회관 2층 동아리방"),
];

const selected: CampusPlace[] = [];
const search = createPlaceSearch<CampusPlace>(PLACE_CATEGORIES, (p) => selected.push(p));
search.setPlaces(PLACES);

const input = byId<HTMLInputElement>("placeQuery");
const category = byId<HTMLSelectElement>("placeCategory");
const results = byId("placeResults");
const count = byId("placeCount");
const names = (): string[] => [...results.querySelectorAll("strong")].map((s) => s.textContent ?? "");
const type = (q: string): void => { input.value = q; fire(input, "input"); };

beforeEach(() => {
  selected.length = 0;
  fire(byId("placeClear"), "click");
});

test("처음에는 목록을 접고 장소 수만 알린다, 종류 목록은 '모든 종류' 뒤에 붙는다", () => {
  assert.equal(results.hidden, true);
  assert.equal(count.textContent, `${PLACES.length}곳 · 이름이나 종류로 찾아보세요.`);
  assert.deepEqual([...category.options].map((o) => o.value), ["all", ...PLACE_CATEGORIES.map((c) => c.value)]);
  assert.equal(byId<HTMLButtonElement>("placeClear").disabled, true);
});

test("검색어: 모든 낱말을 포함하는 곳, 번호는 '번'을 붙여 보여 준다", () => {
  type("중앙");
  assert.equal(results.hidden, false);
  assert.deepEqual(names(), ["2번 · 중앙도서관", "중앙광장"]);
  assert.equal(count.textContent, "2곳");
  type("동아리방");
  assert.deepEqual(names(), ["동아리 모임"], "메모 내용(keywords)으로도 찾는다");
  type("없는곳");
  assert.equal(results.hidden, true);
  assert.equal(count.textContent, "검색 결과가 없습니다. 검색어나 종류를 바꿔 보세요.");
});

test("번호 검색은 정확히 일치한다 (1로 10번을 찾지 않음)", () => {
  type("1");
  assert.deepEqual(names(), ["1번 · 대학본부"]);
  type("10번");
  assert.deepEqual(names(), ["10번 · 제1공학관"]);
});

test("종류만 골라도 목록을 펼친다", () => {
  category.value = "landmark";
  fire(category, "change");
  assert.deepEqual(names(), ["개교 기념탑"]);
  assert.equal(byId<HTMLButtonElement>("placeClear").disabled, false);
});

test("Enter는 첫 결과를 고르고, 결과 단추를 눌러도 고른다", () => {
  type("공학");
  fire(input, "keydown", { key: "Enter" });
  assert.deepEqual(selected.map((p) => p.id), [3]);
  type("중앙");
  (results.querySelectorAll("button")[1] as HTMLButtonElement).click();
  assert.deepEqual(selected.map((p) => p.id), [3, 4]);
});

test("빈 칸에서 ↓는 전체 목록을 펼치고 첫 결과로 간다", () => {
  fire(input, "keydown", { key: "ArrowDown" });
  assert.equal(names().length, PLACES.length);
  assert.equal(document.activeElement, results.querySelector("button"));
});

test("Esc와 초기화는 검색어·종류를 지우고 접는다", () => {
  type("중앙");
  category.value = "building";
  fire(category, "change");
  fire(input, "keydown", { key: "Escape" });
  assert.equal(input.value, "");
  assert.equal(category.value, "all");
  assert.equal(results.hidden, true);
});

test("'/'는 입력 칸 밖에서만 검색 칸으로 간다", () => {
  (document.activeElement as HTMLElement | null)?.blur();
  fire(document.body, "keydown", { key: "/" });
  assert.equal(document.activeElement, input);
  const name = byId<HTMLInputElement>("seed");
  name.focus();
  fire(name, "keydown", { key: "/" });
  assert.equal(document.activeElement, name);
});

test("setPlaces로 목록이 바뀌면 지금 검색어로 다시 찾는다", () => {
  type("도서관");
  search.setPlaces([...PLACES, place(7, "제2도서관", "building", 11)]);
  assert.deepEqual(names(), ["2번 · 중앙도서관", "11번 · 제2도서관"]);
  search.setPlaces(PLACES);
});
