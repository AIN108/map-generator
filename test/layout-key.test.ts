import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutKeyOf, parseLayoutKey, type LayoutKeyParts } from "../src/layout-key.ts";
import { CAMPUS_TYPES, DENSITIES } from "../src/site.ts";

const DEF = { buildings: 24, hospital: true };

/** 바꾸기 전 main.ts의 key 만들기 (이미 저장된 자동 저장본은 이 모양이다) */
const oldKey = (k: LayoutKeyParts): string =>
  (k.program ? `${k.seed}|${k.program}` : `${k.seed}|${k.buildings}|${k.hospital ? 1 : 0}`)
  + (k.campus === "classic" && k.density === "normal" ? "" : `|${k.campus}:${k.density}`);

const SEEDS = ["campus", "봄1234", "a|b", "a:b", "x|24|1", "x|p1", "grid:dense", "s|12|0|river:loose", "|", ":", "끝|", "줄\n바꿈", " 공백 "];

function* cases(): Generator<LayoutKeyParts> {
  for (const seed of SEEDS) {
    for (const campus of CAMPUS_TYPES) {
      for (const density of DENSITIES) {
        yield { seed, buildings: 24, hospital: true, campus, density };
        yield { seed, buildings: 10, hospital: false, campus, density };
        yield { seed, program: "p1x9z", buildings: DEF.buildings, hospital: DEF.hospital, campus, density };
      }
    }
  }
}

test("key 모양은 예전과 글자 하나까지 같다 (이미 저장된 자동 저장본을 그대로 알아본다)", () => {
  for (const k of cases()) assert.equal(layoutKeyOf(k), oldKey(k));
});

test("시드에 | · : 가 있어도 key를 되읽으면 원래 값", () => {
  for (const k of cases()) {
    const key = layoutKeyOf(k);
    assert.deepEqual(parseLayoutKey(key, DEF), { ...k, program: k.program }, key);
  }
});

test("예전 해석이 틀리던 예: 시드의 | 와 : 를 옵션으로 읽지 않는다", () => {
  assert.deepEqual(parseLayoutKey("a|b|24|1", DEF), { seed: "a|b", program: undefined, buildings: 24, hospital: true, campus: "classic", density: "normal" });
  assert.deepEqual(parseLayoutKey("grid:dense|12|0|river:loose", DEF),
    { seed: "grid:dense", program: undefined, buildings: 12, hospital: false, campus: "river", density: "loose" });
  assert.deepEqual(parseLayoutKey("a:b|pq1", DEF), { seed: "a:b", program: "pq1", buildings: 24, hospital: true, campus: "classic", density: "normal" });
});

test("모양이 맞지 않는 key는 undefined", () => {
  for (const bad of ["", "seed", "|24|1", "seed|24", "seed|24|2", "seed|auto", "seed|P1", "seed|24|1|castle:dense", "seed|24|1|grid:"]) {
    assert.equal(parseLayoutKey(bad, DEF), undefined, bad);
  }
});
