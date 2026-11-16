// src/planView.ts 단위 테스트 (지금 동작을 그대로 고정한다). 캔버스는 그리기 호출만 기록한다.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { cloneLayout, findBuilding, SHAPE_KO, type EditResult } from "../src/edit.ts";
import type { Building, Layout } from "../src/layout.ts";
import { FLOOR_H } from "../src/model.ts";
import { createPlanView } from "../src/planView.ts";
import { floorPlan, floorsOf } from "../src/rooms.ts";
import { byId, fire, installDom, type RecordingContext } from "./helpers/dom.ts";

installDom();

const building: Building = {
  id: 1, type: "humanities", name: "설계관", x: 0, y: 0, angle: 0, w: 60, d: 26, floors: 5, style: "modern", shape: "bar", variant: 0.3,
};
let layout: Layout = { name: "실내시험대학교", buildings: [building], landmarks: [], nextId: 2 };
let selected = true;
const calls = { undo: 0, redo: 0, resize: [] as [number, number, number][], applied: [] as (string | undefined)[] };
const view = createPlanView({
  building: () => (selected ? findBuilding(layout, 1) : undefined),
  numberOf: () => 3,
  gridCell: () => "C4",
  apply: (edit: (l: Layout) => EditResult, mergeKey?: string) => {
    const next = cloneLayout(layout);
    const r = edit(next);
    if (r.ok) { layout = next; calls.applied.push(mergeKey); view.sync(); }
    return r.ok;
  },
  resize: (id, w, d) => { calls.resize.push([id, w, d]); },
  undo: () => { calls.undo++; },
  redo: () => { calls.redo++; },
  canUndo: () => calls.applied.length > 0,
  canRedo: () => false,
});

const editor = byId("planEditor");
const floorSelect = byId<HTMLSelectElement>("planFloor");
const roomList = byId<HTMLSelectElement>("planRoomList");
const status = byId("planInteriorStatus");
const ctx = byId<HTMLCanvasElement>("planCanvas").getContext("2d") as unknown as RecordingContext;
const specRows = (): Record<string, string> =>
  Object.fromEntries([...byId("planSpec").querySelectorAll("tr")].map((tr) => [tr.querySelector("th")!.textContent!, tr.querySelector("td")!.textContent!]));
const chooseFloor = (f: number): void => { floorSelect.value = String(f); fire(floorSelect, "change"); };
const chooseRoom = (no: string): void => { roomList.value = no; fire(roomList, "change"); };

beforeEach(() => {
  selected = true;
  view.sync();
  chooseFloor(0);
});

test("고른 건물이 없으면 편집기를 숨긴다", () => {
  selected = false;
  view.sync();
  assert.equal(editor.hidden, true);
});

test("외형: 표제란·도면 번호·창 제목·층 목록을 채우고 도면을 그린다", () => {
  assert.equal(editor.hidden, false);
  const rows = specRows();
  assert.equal(rows["모양"], SHAPE_KO.bar);
  assert.equal(rows["규모"], `지상 5층 · 높이 ${Math.round(5 * FLOOR_H)} m`);
  assert.equal(rows["바닥 상자"], "60.0 × 26.0 m");
  assert.equal(rows["배치도 칸"], "C4");
  assert.equal(byId("planSheet").textContent, "A-03");
  assert.equal(byId("planDialogTitle").textContent, "3번 설계관 평면도");
  assert.deepEqual([...floorSelect.options].map((o) => o.textContent), ["외형", ...floorsOf(building).map((f) => `${f}층`)]);
  assert.equal(byId("planRoom").hidden, true);
  assert.equal(byId("planForm").hidden, false);
  assert.ok(ctx.texts.includes("정면") && ctx.texts.includes("N") && ctx.texts.includes("60.0"), "정면·방위·치수를 그린다");
});

test("층을 고르면 호실 목록·요약·표제란의 호실 범위를 보여 준다", () => {
  chooseFloor(2);
  const rooms = floorPlan(building, 2).rooms.filter((r) => r.no);
  assert.equal(byId("planRoom").hidden, false);
  assert.equal(byId("planForm").hidden, true);
  assert.equal(roomList.options.length, rooms.length);
  assert.equal(byId("planRoomCount").textContent, `${rooms.length} / ${rooms.length}실`);
  assert.match(byId("planFloorSummary").textContent ?? "", new RegExp(`^2층 · ${rooms.length}실 · 호실 면적 합계 [\\d.]+ m² · 자동 구성$`));
  assert.match(specRows()["2층 호실"], new RegExp(`^201~2\\d\\d호 \\(${rooms.length}실\\)$`));
  assert.equal(byId<HTMLButtonElement>("planRoomSave").disabled, true);
  assert.equal(byId<HTMLButtonElement>("planSplit").disabled, true);
});

test("호실 검색은 번호·이름으로 거른다", () => {
  chooseFloor(2);
  const q = byId<HTMLInputElement>("planRoomQuery");
  q.value = "201호";
  fire(q, "input");
  assert.deepEqual([...roomList.options].map((o) => o.value), ["201"]);
  q.value = "없는 이름";
  fire(q, "input");
  assert.match(byId("planRoomCount").textContent ?? "", /^0 \/ \d+실 · 검색 결과 없음$/);
  fire(q, "keydown", { key: "Escape" });
  assert.equal(q.value, "");
});

test("호실을 골라 이름을 붙이면(Enter) 저장하고 결과를 알린다", () => {
  chooseFloor(2);
  chooseRoom("201");
  assert.match(byId("planRoomNo").textContent ?? "", /^201호 · /);
  assert.equal(byId<HTMLButtonElement>("planRoomSave").disabled, false);
  const name = byId<HTMLInputElement>("planRoomName");
  name.value = "수학과 사무실";
  fire(name, "keydown", { key: "Enter" });
  assert.equal(findBuilding(layout, 1)!.rooms?.["201"], "수학과 사무실");
  assert.equal(status.textContent, "설계관 201호를 '수학과 사무실'로 이름 붙였습니다.");
  assert.equal(specRows()["이름 붙인 호실"], "1곳");
});

test("분할: 고른 호실의 미리보기를 보여 주고, 실행하면 새 호실을 만든다", () => {
  chooseFloor(2);
  chooseRoom("202");
  assert.equal(byId<HTMLButtonElement>("planSplit").disabled, false);
  assert.match(byId("planSplitPreview").textContent ?? "", /^분할 미리보기 · 점선이 새 벽입니다\. 기존 202호: /);
  const before = floorPlan(findBuilding(layout, 1)!, 2).rooms.filter((r) => r.no).length;
  fire(byId("planSplit"), "click");
  assert.match(status.textContent ?? "", /^설계관 202호를 나눴습니다 \(새 호실 2\d\d호\)\.$/);
  assert.equal(floorPlan(findBuilding(layout, 1)!, 2).rooms.filter((r) => r.no).length, before + 1);
  assert.match(byId("planFloorSummary").textContent ?? "", /직접 구획$/);
  assert.equal(byId<HTMLButtonElement>("planInteriorReset").disabled, false);
  fire(byId("planInteriorReset"), "click");
  assert.equal(status.textContent, "설계관 2층의 구획을 자동 구성으로 바꿨습니다.");
});

test("되돌리기 단추는 호스트의 undo를 부르고, 편집기 안 Ctrl+Z·Y도 같다 (글 칸에서는 아님)", () => {
  const u0 = calls.undo, r0 = calls.redo;
  fire(byId("planUndo"), "click");
  assert.equal(calls.undo, u0 + 1);
  assert.equal(status.textContent, "되돌렸습니다.");
  fire(editor, "keydown", { key: "z", ctrlKey: true });
  fire(editor, "keydown", { key: "y", ctrlKey: true });
  fire(editor, "keydown", { key: "Z", ctrlKey: true, shiftKey: true });
  assert.equal(calls.undo, u0 + 2);
  assert.equal(calls.redo, r0 + 2);
  fire(byId("planRoomName"), "keydown", { key: "z", ctrlKey: true });
  assert.equal(calls.undo, u0 + 2, "글 칸에서는 지도 되돌리기를 쓰지 않는다");
});

test("크게 보기: 대화 상자로 옮겼다가 닫으면 원래 자리로 돌아온다", () => {
  const home = editor.parentElement;
  fire(byId("planExpand"), "click");
  assert.equal(byId<HTMLDialogElement>("planDialog").open, true);
  assert.equal(editor.parentElement, byId("planDialogBody"));
  assert.equal(editor.classList.contains("large"), true);
  assert.equal(byId("planExpand").textContent, "작게");
  fire(byId("planClose"), "click");
  assert.equal(byId<HTMLDialogElement>("planDialog").open, false);
  assert.equal(editor.parentElement, home);
  assert.equal(editor.classList.contains("large"), false);
  assert.equal(byId("planExpand").textContent, "크게");
});
