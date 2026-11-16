import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, formatOptionsHash, parseOptionsHash, type Options } from "../src/options.ts";

test("옵션 → 해시 → 옵션 왕복 (이름·유형·밀도 포함)", () => {
  const o: Options = {
    seed: "봄1234|a:b", name: "한빛대학교", buildings: 30, hospital: false, season: "winter", time: "night", view: "high",
    surround: "city", campus: "river", density: "dense",
  };
  assert.deepEqual({ ...DEFAULTS, ...parseOptionsHash(formatOptionsHash(o)) }, o);
  assert.deepEqual({ ...DEFAULTS, ...parseOptionsHash(formatOptionsHash(DEFAULTS)) }, DEFAULTS);
});

test("해시 모양은 예전과 같다: 기본 유형·밀도와 빈 이름은 적지 않는다", () => {
  assert.equal(formatOptionsHash(DEFAULTS), "#seed=campus&n=24&hospital=1&season=spring&time=day&view=mid&surround=forest");
  assert.match(formatOptionsHash({ ...DEFAULTS, campus: "grid" }), /&campus=grid$/);
});

test("알 수 없는 값은 버리고, 건물 수는 범위로 자르고, 시드·이름은 길이를 자른다", () => {
  const p = parseOptionsHash(`#seed=${"가".repeat(50)}&name=${"나".repeat(30)}&n=99&season=monsoon&campus=moon&density=dense&hospital=0`);
  assert.equal(p.seed?.length, 40);
  assert.equal(p.name?.length, 20);
  assert.equal(p.buildings, 32);
  assert.equal(p.hospital, false);
  assert.equal(p.density, "dense");
  assert.equal("season" in p, false);
  assert.equal("campus" in p, false);
  assert.equal(parseOptionsHash("#n=3").buildings, 10);
  assert.deepEqual(parseOptionsHash(""), {});
  assert.deepEqual(parseOptionsHash("#n=abc"), {});
});

test("배치 링크 조각(&l=)이 붙어 있어도 옵션만 읽는다", () => {
  assert.deepEqual(parseOptionsHash("#seed=x&n=12&l=AAAA"), { seed: "x", buildings: 12 });
});
