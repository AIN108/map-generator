import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILDING_TYPES, type Shape } from "../src/catalog.ts";
import { cloneLayout, layoutFromJSON, setRoomName, toCustom } from "../src/edit.ts";
import { polygonArea } from "../src/geom.ts";
import type { Building, Layout } from "../src/layout.ts";
import { decompose, floorMasses, floorPlan, floorsOf, hasRoom, roomTitle } from "../src/rooms.ts";

const building = (shape: Shape, over: Partial<Building> = {}): Building => ({
  id: 1, type: "humanities", name: "시험관", x: 0, y: 0, angle: 0, w: 60, d: 26, floors: 5, style: "modern", shape, variant: 0.3, ...over,
});
const area = (p: [number, number][]): number => Math.abs(polygonArea(p));
const floorArea = (b: Building, f: number): number =>
  floorMasses(b, f).reduce((s, m) => s + area(m.outer) - m.holes.reduce((h, r) => h + area(r), 0), 0);

const SHAPES: [Shape, Partial<Building>][] = [
  ["bar", {}], ["L", {}], ["U", { w: 72, d: 46 }], ["court", { w: 60, d: 60 }], ["wings", { type: "admin", w: 104, d: 32 }],
  ["atrium", { w: 70, d: 40 }], ["stepped", { w: 80, d: 48, type: "library" }], ["twin", { type: "dorm2", floors: 12 }],
  ["tower", { floors: 9, w: 48, d: 30 }], ["hospital", { type: "hospital", w: 128, d: 62, floors: 10 }],
];

test("층 평면: 실·복도가 바닥 안에 겹치지 않게 들어가고 바닥 대부분을 채운다, 호실 번호는 겹치지 않는다", () => {
  for (const [shape, over] of SHAPES) {
    const b = building(shape, over);
    const nos = new Set<string>();
    for (const f of floorsOf(b)) {
      const plan = floorPlan(b, f);
      const fa = floorArea(b, f);
      const used = plan.rooms.filter((r) => r.kind !== "void").reduce((s, r) => s + area(r.poly), 0);
      assert.ok(used <= fa * 1.01 + 1, `${shape} ${f}층: 실 넓이 ${used.toFixed(0)} > 바닥 ${fa.toFixed(0)}`);
      assert.ok(used >= fa * 0.85, `${shape} ${f}층: 실이 바닥의 ${(used / fa * 100).toFixed(0)}%만 채움`);
      for (const r of plan.rooms) {
        if (!r.no) continue;
        assert.ok(!nos.has(r.no), `${shape}: ${r.no} 중복`);
        nos.add(r.no);
        assert.ok(r.no.startsWith(String(f)), `${r.no}는 ${f}층`);
      }
      const numbered = plan.rooms.filter((r) => r.no);
      assert.ok(numbered.length >= 1, `${shape} ${f}층에 호실이 없음`);
    }
  }
});

test("직사각형 나누기: ㄷ자는 3동, ㅁ자는 4동, ㄱ자는 2동", () => {
  const count = (shape: Shape, over: Partial<Building> = {}): number => decompose(floorMasses(building(shape, over), 1)).length;
  assert.equal(count("bar"), 1);
  assert.equal(count("L"), 2);
  assert.equal(count("U", { w: 72, d: 46 }), 3);
  assert.equal(count("court", { w: 60, d: 60 }), 4);
});

test("특수 모양·자유형·종류별 이름, 1층 로비", () => {
  const gym = floorPlan(building("gym", { type: "gym", w: 86, d: 56, floors: 3 }), 1);
  assert.ok(gym.rooms.some((r) => r.label === "경기장"));
  const hall = floorPlan(building("hall", { type: "auditorium", w: 60, d: 44, floors: 3 }), 1);
  assert.ok(hall.rooms.some((r) => r.label === "객석") && hall.rooms.some((r) => r.label === "무대"));
  const dorm = floorPlan(building("bar", { type: "dorm" }), 3);
  assert.ok(dorm.rooms.filter((r) => r.label === "호실").length >= 10, "기숙사는 작은 방이 많다");
  const lab = floorPlan(building("bar", { type: "eng1" }), 3);
  assert.ok(lab.rooms.some((r) => r.label === "실험실"));
  assert.ok(floorPlan(building("bar"), 1).rooms.some((r) => r.kind === "lobby"), "1층 정면 가운데 로비");
  const l: Layout = { name: "시험대학교", buildings: [building("court", { w: 48, d: 48, floors: 4 })], landmarks: [], nextId: 2 };
  toCustom(l, 1);
  const custom = floorPlan(l.buildings[0], 2);
  assert.ok(custom.rooms.filter((r) => r.no).length >= 4);
});

test("호실 이름 붙이기·지우기·저장 검증", () => {
  const l: Layout = { name: "시험대학교", buildings: [building("bar")], landmarks: [], nextId: 2 };
  const b = l.buildings[0];
  const room = floorPlan(b, 3).rooms.find((r) => r.no)!;
  assert.equal(hasRoom(b, room.no!), true);
  assert.equal(hasRoom(b, "999"), false);
  assert.equal(setRoomName(l, 1, room.no!, "  수학과  사무실 ").ok, true);
  assert.equal(roomTitle(b, room), "수학과 사무실");
  const back = layoutFromJSON(JSON.parse(JSON.stringify(l)));
  assert.deepEqual(back, cloneLayout(l));
  assert.throws(() => layoutFromJSON({ ...JSON.parse(JSON.stringify(l)), buildings: [{ ...b, rooms: { "3a1": "x" } }] }), /호실/);
  assert.equal(setRoomName(l, 1, room.no!, "").ok, true);
  assert.equal(b.rooms, undefined);
  assert.equal(setRoomName(l, 1, "12", "x").ok, false);
});

test("모든 건물 종류의 기본 크기로 층 평면이 만들어진다", () => {
  for (const t of BUILDING_TYPES) {
    for (const shape of t.shapes) {
      const b = building(shape, { type: t.id, w: (t.w[0] + t.w[1]) / 2, d: (t.d[0] + t.d[1]) / 2, floors: t.floors[1] });
      for (const f of floorsOf(b)) assert.ok(floorPlan(b, f).rooms.length > 0, `${t.id}/${shape} ${f}층`);
    }
  }
});
