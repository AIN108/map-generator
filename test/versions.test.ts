import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneLayout, moveBuilding, toSavedFile } from "../src/edit.ts";
import { generateLayout, placementContext } from "../src/layout.ts";
import { generateSite } from "../src/site.ts";
import {
  addVersion, cleanVersionName, MAX_VERSIONS, readVersions, removeVersion, suggestVersionName, VERSIONS_KEY, writeVersions,
} from "../src/versions.ts";

class MemoryStore {
  data = new Map<string, string>();
  quota = Infinity;
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void {
    if (v.length > this.quota) throw new Error("QuotaExceededError");
    this.data.set(k, v);
  }
}

const sample = () => {
  const seed = "versions";
  const site = generateSite(seed, 14);
  const layout = generateLayout(site, { seed, buildings: 14, hospital: false, name: "" });
  const options = { seed, buildings: 14, hospital: false, season: "autumn", time: "dusk", view: "high", surround: "city" };
  return { site, layout, options };
};

test("판을 저장했다 다시 읽으면 배치·보기 설정이 그대로", () => {
  const { site, layout, options } = sample();
  const store = new MemoryStore();
  const edited = cloneLayout(layout);
  const b = edited.buildings.find((x) => x.type !== "admin" && x.type !== "plaza")!;
  moveBuilding(placementContext(site), edited, b.id, b.x + 12, b.y);
  let list = addVersion([], "1안", toSavedFile(options, layout), 1000).list;
  list = addVersion(list, "2안 옮김", toSavedFile({ ...options, program: "본관 | 본부" }, edited), 2000).list;
  writeVersions(store, list);
  const back = readVersions(store);
  assert.deepEqual(back.map((v) => v.name), ["2안 옮김", "1안"], "최근 것이 앞");
  assert.deepEqual(back[0].file.layout, cloneLayout(edited));
  assert.deepEqual(back[1].file.layout, cloneLayout(layout));
  assert.equal(back[0].file.options.season, "autumn");
  assert.equal(back[0].file.options.program, "본관 | 본부");
  assert.equal(back[1].file.options.program, undefined);
});

test("같은 이름은 바꾸고, 개수가 넘치면 가장 오래된 판을 뺀다", () => {
  const { layout, options } = sample();
  const file = toSavedFile(options, layout);
  let list = addVersion([], "가", file, 1).list;
  const r = addVersion(list, "  가  ", file, 2);
  assert.equal(r.replaced, true);
  assert.equal(r.list.length, 1);
  assert.equal(r.list[0].at, 2);
  list = r.list;
  for (let i = 0; i < MAX_VERSIONS; i++) list = addVersion(list, `판 ${i}`, file, 10 + i).list;
  assert.equal(list.length, MAX_VERSIONS);
  assert.ok(!list.some((v) => v.name === "가"), "가장 오래된 판이 빠진다");
  assert.equal(removeVersion(list, "판 3").length, MAX_VERSIONS - 1);
  assert.throws(() => addVersion(list, "   ", file, 99), /이름/);
  assert.equal(cleanVersionName("a\n\tb"), "a b");
  assert.equal(suggestVersionName(addVersion([], "가람대학교 1", file, 1).list, "가람대학교"), "가람대학교 2");
});

test("깨진 저장 내용은 건너뛰고, 저장 공간이 모자라면 예외", () => {
  const { layout, options } = sample();
  const store = new MemoryStore();
  store.setItem(VERSIONS_KEY, "{not json");
  assert.deepEqual(readVersions(store), []);
  const good = { name: "좋은 판", at: 5, file: toSavedFile(options, layout) };
  store.setItem(VERSIONS_KEY, JSON.stringify([
    { name: "형식 틀림", at: 1, file: { format: "other/v9", options, layout } },
    { name: "", at: 1, file: good.file },
    good,
    { name: "건물 깨짐", at: 2, file: { ...good.file, layout: { ...good.file.layout, buildings: [{ id: "x" }] } } },
  ]));
  assert.deepEqual(readVersions(store).map((v) => v.name), ["좋은 판"]);
  store.quota = 100;
  assert.throws(() => writeVersions(store, [good]), /Quota/);
});
