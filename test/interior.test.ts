import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneLayout, EditHistory, layoutFromJSON, mergeRooms, resetInterior, setRoomName, splitRoom } from "../src/edit.ts";
import { convexOverlap } from "../src/geom.ts";
import type { Building, Layout } from "../src/layout.ts";
import { floorPlan, hasRoom, mergeCandidates, roomArea, roomTitle } from "../src/rooms.ts";

const make = (over: Partial<Building> = {}): Layout => ({
  name: "시험대학교", nextId: 2, landmarks: [],
  buildings: [{ id: 1, type: "humanities", name: "실내설계관", x: 0, y: 0, angle: 0, w: 60, d: 26, floors: 5, style: "modern", shape: "bar", variant: 0.3, ...over }],
});
const count = (b: Building, floor = 2): number => floorPlan(b, floor).rooms.filter((r) => r.no).length;

test("호실을 나눠도 면적·다른 호실 번호·다른 층·복도·계단은 유지된다", () => {
  for (const shape of ["bar", "L", "U", "court"] as const) {
    const l = make({ shape, w: 72, d: 46 }), b = l.buildings[0];
    const before = floorPlan(b, 2), otherFloor = floorPlan(b, 3);
    const first = before.rooms.find((r) => r.no)!;
    const originalNos = before.rooms.flatMap((r) => r.no ? [r.no] : []);
    assert.equal(splitRoom(l, 1, 2, first.no!, "v", 0.5).ok, true);
    const after = floorPlan(b, 2);
    assert.equal(after.interiorState, "edited");
    assert.equal(count(b), originalNos.length + 1);
    assert.ok(originalNos.every((no) => after.rooms.some((r) => r.no === no)));
    assert.ok(Math.abs(after.rooms.reduce((s, r) => s + roomArea(r), 0) - before.rooms.reduce((s, r) => s + roomArea(r), 0)) < 1e-6);
    assert.deepEqual(after.rooms.filter((r) => !r.no), before.rooms.filter((r) => !r.no));
    assert.deepEqual(floorPlan(b, 3), otherFloor);
    const parts = after.rooms.filter((r) => r.no && (!originalNos.includes(r.no) || r.no === first.no));
    assert.equal(parts.length, 2);
    assert.equal(convexOverlap(parts[0].poly, parts[1].poly, -1e-5), false);
  }
});

test("인접한 호실을 합치면 면적과 선택한 번호·이름을 유지한다", () => {
  const l = make(), b = l.buildings[0], before = floorPlan(b, 2);
  const first = before.rooms.find((r) => r.no && mergeCandidates(before, r.no).length)!;
  const other = mergeCandidates(before, first.no!)[0];
  setRoomName(l, 1, first.no!, "설계 스튜디오");
  setRoomName(l, 1, other.no!, "옆 연구실");
  assert.equal(mergeRooms(l, 1, 2, first.no!, other.no!).ok, true);
  const merged = floorPlan(b, 2).rooms.find((r) => r.no === first.no)!;
  assert.ok(Math.abs(roomArea(merged) - roomArea(first) - roomArea(other)) < 1e-6);
  assert.equal(roomTitle(b, merged), "설계 스튜디오");
  assert.equal(hasRoom(b, other.no!), false);
  assert.equal(b.rooms?.[other.no!], undefined);
});

test("복도 건너편·동일 호실·없는 호실·잘못된 분할은 원본을 변경하지 않는다", () => {
  const l = make(), b = l.buildings[0], plan = floorPlan(b, 2);
  const first = plan.rooms.find((r) => r.no)!;
  const far = plan.rooms.find((r) => r.no && r.no !== first.no && !mergeCandidates(plan, first.no!).some((n) => n.no === r.no))!;
  const before = JSON.stringify(l);
  assert.equal(mergeRooms(l, 1, 2, first.no!, far.no!).ok, false);
  assert.equal(mergeRooms(l, 1, 2, first.no!, first.no!).ok, false);
  assert.equal(splitRoom(l, 1, 2, "999", "u").ok, false);
  for (const ratio of [NaN, Infinity, 0, 0.01, 0.99, -1]) assert.equal(splitRoom(l, 1, 2, first.no!, "u", ratio).ok, false);
  assert.equal(splitRoom(l, 1, 99, first.no!, "u").ok, false);
  assert.equal(JSON.stringify(l), before);
});

test("분할·합치기 저장본은 같은 구획으로 복원되고 예전 파일도 읽는다", () => {
  const l = make(), b = l.buildings[0];
  assert.deepEqual(layoutFromJSON(JSON.parse(JSON.stringify(l))), l);
  assert.equal(splitRoom(l, 1, 2, "201", "v").ok, true);
  const newNo = b.interiors!["2"].operations[0];
  assert.equal(newNo.type, "split");
  if (newNo.type !== "split") return;
  setRoomName(l, 1, newNo.newNo, "추가 세미나실");
  assert.equal(mergeRooms(l, 1, 2, "202", "203").ok, true);
  const back = layoutFromJSON(JSON.parse(JSON.stringify(l)));
  assert.deepEqual(back, cloneLayout(l));
  assert.deepEqual(floorPlan(back.buildings[0], 2), floorPlan(b, 2));
});

test("되돌리기 스냅샷은 실내 구획 작업 목록을 깊게 복사한다", () => {
  const l = make();
  splitRoom(l, 1, 2, "201", "v");
  const history = new EditHistory<Layout>(60, cloneLayout);
  history.record(l, "분할 전");
  const snapshot = cloneLayout(l);
  const op = l.buildings[0].interiors!["2"].operations[0];
  if (op.type === "split") op.ratio = 0.3;
  assert.deepEqual(history.undo(l), snapshot);
});

test("외형이 달라지면 구획을 보관하고 원래 외형으로 돌아오면 복원한다", () => {
  const l = make(), b = l.buildings[0];
  splitRoom(l, 1, 2, "201", "v");
  const designed = floorPlan(b, 2);
  b.x = 120; b.y = 45; b.angle = 1.2; b.name = "옮긴 설계관";
  assert.deepEqual(floorPlan(b, 2), designed);
  b.floors = 6;
  assert.deepEqual(floorPlan(b, 2).rooms, designed.rooms, "층을 늘려도 같은 바닥 구획이면 설계를 유지한다");
  assert.equal(floorPlan(b, 2).interiorState, "edited");
  b.floors = 5;
  b.w = 70;
  assert.equal(floorPlan(b, 2).interiorState, "stale");
  assert.equal(splitRoom(l, 1, 2, "201", "v").ok, false);
  const back = layoutFromJSON(JSON.parse(JSON.stringify(l)));
  assert.deepEqual(back.buildings[0].interiors, b.interiors);
  back.buildings[0].w = 60;
  assert.deepEqual(floorPlan(back.buildings[0], 2), designed);
});

test("층 자동 구성과 되돌리기로 직접 설계·호실 이름을 복원한다", () => {
  const l = make(), b = l.buildings[0];
  splitRoom(l, 1, 2, "201", "v");
  const op = b.interiors!["2"].operations[0];
  if (op.type !== "split") return;
  setRoomName(l, 1, op.newNo, "직접 만든 실");
  splitRoom(l, 1, 3, "301", "v");
  const before = cloneLayout(l);
  assert.equal(resetInterior(l, 1, 2).ok, true);
  assert.equal(b.interiors?.["2"], undefined);
  assert.ok(b.interiors?.["3"]);
  assert.equal(b.rooms?.[op.newNo], undefined);
  assert.equal(floorPlan(before.buildings[0], 2).interiorState, "edited");
  assert.equal(before.buildings[0].rooms?.[op.newNo], "직접 만든 실");
});

test("저장 파일의 변조된 작업·중복 번호·잘못된 합치기를 거부한다", () => {
  const l = make();
  splitRoom(l, 1, 2, "201", "v");
  for (const change of [
    (o: Record<string, unknown>) => { o.ratio = 0; },
    (o: Record<string, unknown>) => { o.newNo = "202"; },
    (o: Record<string, unknown>) => { o.axis = "z"; },
    (o: Record<string, unknown>) => { o.room = "301"; },
    (o: Record<string, unknown>) => { o.type = "merge"; o.with = "201"; },
  ]) {
    const data = JSON.parse(JSON.stringify(l));
    change(data.buildings[0].interiors["2"].operations[0]);
    assert.throws(() => layoutFromJSON(data), /실내 구획/);
  }
});

test("삭제한 번호를 다음 분할에 재사용하지 않는다", () => {
  const l = make(), b = l.buildings[0];
  splitRoom(l, 1, 2, "201", "v");
  const op = b.interiors!["2"].operations[0];
  if (op.type !== "split") return;
  mergeRooms(l, 1, 2, "201", op.newNo);
  splitRoom(l, 1, 2, "201", "v");
  const next = b.interiors!["2"].operations.at(-1)!;
  assert.ok(next.type === "split" && Number(next.newNo) > Number(op.newNo));
});
