import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneLayout, deleteBuilding, moveBuilding, renameBuilding } from "../src/edit.ts";
import { generateLayout, placementContext, type Building } from "../src/layout.ts";
import { parseProgram, programToText } from "../src/program.ts";
import { generateFromProgram } from "../src/programLayout.ts";
import { generateSite } from "../src/site.ts";
import { programFromLayout } from "../src/sync.ts";

/** 두 방향의 차이 (라디안, 0~π). 목록에는 0.1° 단위로 적으므로 아주 작은 차이는 같은 방향이다. */
const angleGap = (a: number, b: number): number => Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
const shape = (b: Building) => ({
  name: b.name, type: b.type, x: b.x, y: b.y, w: b.w, d: b.d, floors: b.floors, style: b.style, shape: b.shape,
  variant: b.variant, unlisted: !!b.unlisted,
});
const sameAngles = (a: Building[], b: Building[]): void => {
  a.forEach((x, i) => assert.ok(angleGap(x.angle, b[i].angle) < 0.003, `${x.name} 방향 ${x.angle} ≠ ${b[i].angle}`));
};

test("자동 배치를 목록으로 옮겨 다시 만들면 같은 배치", () => {
  const seed = "sync-auto";
  const site = generateSite(seed, 22);
  const layout = generateLayout(site, { seed, buildings: 22, hospital: true, name: "" });
  const p = programFromLayout(layout, site, undefined, { pinAll: true, site: { auto: true, buildings: 22 } });
  const text = programToText(p);
  const parsed = parseProgram(text);
  assert.deepEqual(parsed.warnings, []);
  const again = generateFromProgram(seed, parsed.program);
  assert.deepEqual(again.warnings, []);
  assert.deepEqual(again.site.ring, site.ring, "같은 부지");
  assert.deepEqual(again.layout.buildings.map(shape), layout.buildings.map(shape));
  sameAngles(again.layout.buildings, layout.buildings);
  assert.deepEqual(again.layout.landmarks.map((m) => [m.kind, m.name, m.x, m.y]), layout.landmarks.map((m) => [m.kind, m.name, m.x, m.y]));
  assert.equal(again.layout.name, layout.name);
});

const SAMPLE = `@이름 가람
대학본부 | 본부
중앙광장 | 광장
다산관 | 인문 | 5층 | 북서쪽 | 벽돌
율곡관 | 다산관 남쪽
제1공학관 | 8층 | 동쪽
제2공학관 | 제1공학관 동쪽
체육관 | 남서쪽
야외 운동장 | 체육관 뒤 | 번호 없음`;

test("목록 모드에서 고친 내용이 목록에 반영되고, 다시 적용해도 손으로 옮긴 자리는 그대로", () => {
  const seed = "sync-prog";
  const first = generateFromProgram(seed, parseProgram(SAMPLE).program);
  const base = parseProgram(SAMPLE).program;
  const l = cloneLayout(first.layout);
  const ctx = placementContext(first.site);
  const by = (n: string) => l.buildings.find((b) => b.name === n)!;
  assert.equal(renameBuilding(l, by("다산관").id, "새다산관").ok, true);
  const eng2 = by("제2공학관");
  const res = moveBuilding(ctx, l, eng2.id, eng2.x - 30, eng2.y + 20);
  assert.equal(res.ok, true, res.message);
  assert.equal(deleteBuilding(l, by("체육관").id).ok, true);

  const synced = programFromLayout(l, first.site, base);
  const text = programToText(synced);
  assert.match(text, /율곡관 \| [^\n]*새다산관 남쪽/, "기준 이름이 따라 바뀐다");
  assert.match(text, /제2공학관 \|[^\n]*좌표 /, "옮긴 건물은 좌표로 고정");
  assert.doesNotMatch(text, /^체육관 \|/m, "지운 건물은 빠진다");
  assert.doesNotMatch(text, /운동장[^\n]*체육관/, "지운 건물을 기준으로 삼던 줄은 기준이 빠진다");
  assert.match(text, /@부지 /, "부지 크기를 고정한다");

  const parsed = parseProgram(text);
  assert.deepEqual(parsed.warnings, []);
  const again = generateFromProgram(seed, parsed.program);
  assert.deepEqual(again.site.ring, first.site.ring, "건물을 지워도 부지는 그대로");
  const moved = again.layout.buildings.find((b) => b.name === "제2공학관")!;
  const now = l.buildings.find((b) => b.name === "제2공학관")!;
  assert.deepEqual([moved.x, moved.y, moved.w, moved.d], [now.x, now.y, now.w, now.d]);
  assert.ok(angleGap(moved.angle, now.angle) < 0.003);
  assert.ok(again.layout.buildings.some((b) => b.name === "새다산관"));
  assert.ok(!again.layout.buildings.some((b) => b.name === "체육관"));
});
