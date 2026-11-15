import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILDING_TYPES } from "../src/catalog.ts";
import { layoutFromJSON, mergeRooms, parseSavedFile, setRoomName, splitRoom, toSavedFile } from "../src/edit.ts";
import type { Building, Layout } from "../src/layout.ts";
import { compareRoomNumbers, parseRoomNumber, roomNumber } from "../src/room-number.ts";
import { floorPlan, floorsOf, hasRoom, roomArea, splitRoomPreview } from "../src/rooms.ts";
import { decodeShare, encodeShare } from "../src/share.ts";

const make = (over: Partial<Building> = {}): Layout => ({
  name: "실험대학교", nextId: 2, landmarks: [],
  buildings: [{ id: 1, type: "dorm", name: "실험관", x: 0, y: 0, angle: 0, w: 220, d: 160,
    floors: 12, style: "modern", shape: "court", variant: 0.3, ...over }],
});
const options = { seed: "interior-experiment", buildings: 24, hospital: true, season: "spring", time: "day", view: "mid", surround: "forest" };
const area = (b: Building, floor: number): number => floorPlan(b, floor).rooms.reduce((s, r) => s + roomArea(r), 0);

test("호실 번호: 99실 경계와 1~25층을 구분하며 번호순으로 정렬한다", () => {
  for (let floor = 1; floor <= 25; floor++) for (const sequence of [1, 9, 99, 100, 101, 999, 9999]) {
    assert.deepEqual(parseRoomNumber(roomNumber(floor, sequence)), { floor, sequence });
  }
  assert.equal(roomNumber(1, 101), "1-101");
  assert.equal(roomNumber(11, 1), "1101");
  assert.deepEqual(["2-101", "1101", "299", "201", "2-100"].sort(compareRoomNumbers), ["201", "299", "2-100", "2-101", "1101"]);
  for (const no of ["001", "100", "2601", "2-099", "02-100", "2-10000", "2-100x", "3a1", "12100", "201\n"]) assert.equal(parseRoomNumber(no), undefined, no);
});

test("종류·모양·최소/최대/확장 크기의 층 평면에서 호실 번호가 겹치지 않는다", (t) => {
  let checked = 0, largest = 0;
  for (const type of BUILDING_TYPES) for (const shape of type.shapes) {
    for (const [w, d] of [[type.w[0], type.d[0]], [type.w[1], type.d[1]], [220, 160], [400, 400]]) {
      const b = make({ type: type.id, shape, w, d, style: type.styles[0] }).buildings[0];
      const numbers = new Set<string>();
      for (const floor of [1, 2, 12].filter((f) => floorsOf(b).includes(f))) {
        checked++;
        const rooms = floorPlan(b, floor).rooms.filter((r) => r.no);
        largest = Math.max(largest, rooms.length);
        for (const room of rooms) {
          assert.equal(parseRoomNumber(room.no!)?.floor, floor, `${type.id}/${shape}/${w}×${d}/${room.no}`);
          assert.equal(numbers.has(room.no!), false, room.no);
          numbers.add(room.no!);
        }
        for (const room of [rooms[0], rooms[99], rooms.at(-1)].filter((r) => r)) assert.equal(hasRoom(b, room!.no!), true);
      }
    }
  }
  assert.ok(checked > 800 && largest > 100);
  t.diagnostic(`${checked}개 층 평면, 최대 ${largest}실: 번호 중복·층 판별 오류 없음`);
});

test("큰 건물에서 128회 반복 편집 후에도 면적·번호·저장을 유지하고 한도 초과를 거부한다", () => {
  let layout = make();
  const initial = floorPlan(layout.buildings[0], 12), initialArea = area(layout.buildings[0], 12);
  const issued = new Set(initial.rooms.flatMap((r) => r.no ? [r.no] : []));
  for (let k = 0; k < 64; k++) {
    const b = layout.buildings[0];
    assert.equal(splitRoom(layout, 1, 12, "1201", "v").ok, true);
    const op = b.interiors!["12"].operations.at(-1)!;
    assert.equal(op.type, "split");
    if (op.type !== "split") return;
    assert.equal(issued.has(op.newNo), false);
    issued.add(op.newNo);
    assert.equal(setRoomName(layout, 1, op.newNo, "추가실").ok, true);
    assert.equal(mergeRooms(layout, 1, 12, "1201", op.newNo).ok, true);
    assert.equal(b.rooms?.[op.newNo], undefined);
    assert.ok(Math.abs(area(b, 12) - initialArea) < 1e-6);
    if (k % 10 === 0) layout = layoutFromJSON(JSON.parse(JSON.stringify(layout)));
  }
  assert.deepEqual(floorPlan(layout.buildings[0], 12).rooms, initial.rooms);
  const before = JSON.stringify(layout);
  assert.equal(splitRoom(layout, 1, 12, "1201", "v").ok, false);
  assert.equal(JSON.stringify(layout), before);
  assert.deepEqual(layoutFromJSON(JSON.parse(before)), layout);
});

test("분할 미리보기는 원본을 바꾸지 않고 실행 결과의 면적·경계와 일치한다", () => {
  for (const axis of ["u", "v"] as const) for (const ratio of [0.2, 0.5, 0.8]) {
    const layout = make({ type: "humanities", shape: "bar", w: 60, d: 26, floors: 5 }), b = layout.buildings[0];
    const room = floorPlan(b, 2).rooms.find((r) => r.no === "201")!;
    const before = JSON.stringify(layout), preview = splitRoomPreview(room, axis, ratio);
    assert.equal(JSON.stringify(layout), before);
    const result = splitRoom(layout, 1, 2, room.no!, axis, ratio);
    assert.equal(result.ok, !!preview);
    if (!preview) continue;
    const op = b.interiors!["2"].operations.at(-1)!;
    if (op.type !== "split") assert.fail("분할 작업이어야 한다");
    const actual = floorPlan(b, 2).rooms;
    assert.deepEqual(actual.find((r) => r.no === "201")!.poly, preview.parts[0].poly);
    assert.deepEqual(actual.find((r) => r.no === op.newNo)!.poly, preview.parts[1].poly);
    assert.ok(Math.abs(roomArea(preview.parts[0]) + roomArea(preview.parts[1]) - roomArea(room)) < 1e-6);
    assert.ok(Math.abs(roomArea(preview.parts[0]) / roomArea(room) - ratio) < 1e-10);
  }
});

test("새 번호·실내 편집·이름은 압축 공유 링크로도 그대로 복원된다", async () => {
  const layout = make();
  assert.equal(splitRoom(layout, 1, 12, "1201", "v").ok, true);
  const op = layout.buildings[0].interiors!["12"].operations[0];
  if (op.type !== "split") assert.fail("분할 작업이어야 한다");
  assert.match(op.newNo, /^12-\d+$/);
  setRoomName(layout, 1, op.newNo, "설계 실험실");
  const file = toSavedFile(options, layout);
  assert.deepEqual(await decodeShare(await encodeShare(file)), file);
});

test("실제 이전 배포본의 큰 건물 구획·이름을 새 번호로 복원하고 변환을 반복하지 않는다", () => {
  const layout = make(), b = layout.buildings[0];
  // 38819b3의 동일 건물에서 얻은 작업·면적: 12층 299실, 12100호와 1299호 합치기.
  b.interiors = { "12": { base: "v1:3dbddd75", operations: [{ type: "merge", room: "12100", with: "1299" }] } };
  b.rooms = { "1101": "예전 공용 이름" };
  const file = parseSavedFile({ format: "campus-map/v1", options, layout });
  const restored = file.layout.buildings[0], plan = floorPlan(restored, 12);
  assert.equal(plan.interiorState, "edited");
  assert.equal(plan.rooms.filter((r) => r.no).length, 298);
  assert.ok(Math.abs(roomArea(plan.rooms.find((r) => r.no === "12-100")!) - 163.85084745762697) < 1e-6);
  assert.equal(hasRoom(restored, "1299"), false);
  assert.equal(restored.rooms?.["1-101"], "예전 공용 이름");
  assert.equal(restored.rooms?.["1101"], "예전 공용 이름");
  const stale = make();
  stale.buildings[0].interiors = b.interiors;
  stale.buildings[0].w = 200;
  const staleBack = layoutFromJSON(JSON.parse(JSON.stringify(stale)));
  assert.equal(floorPlan(staleBack.buildings[0], 12).interiorState, "stale");
  staleBack.buildings[0].w = 220;
  assert.equal(floorPlan(staleBack.buildings[0], 12).interiorState, "edited");
  setRoomName(file.layout, 1, "1-101", "독립된 이름");
  setRoomName(file.layout, 1, "1101", "11층 이름");
  assert.deepEqual(parseSavedFile(JSON.parse(JSON.stringify(file))), file);
  const modern = make();
  modern.buildings[0].rooms = { "1101": "11층 전용" };
  assert.equal(parseSavedFile(toSavedFile(options, modern)).layout.buildings[0].rooms?.["1-101"], undefined);
  restored.w = 200;
  assert.equal(floorPlan(restored, 12).interiorState, "stale");
  restored.w = 220;
  assert.equal(floorPlan(restored, 12).interiorState, "edited");
});
