import assert from "node:assert/strict";
import { test } from "node:test";
import { alignTo } from "../src/align.ts";
import type { Building } from "../src/layout.ts";
import { EditHistory } from "../src/edit.ts";

const b = (id: number, x: number, y: number, angle = 0, w = 40, d = 20): Building => ({
  id, type: "generic", name: `건물${id}`, x, y, angle, w, d, floors: 4, style: "modern", shape: "bar", variant: 0.3,
});

test("이웃 건물과 가운데·변이 가까우면 맞추고 안내선을 준다", () => {
  const other = b(2, 100, 0);
  // 위쪽(y)으로 1.6 m 어긋남 → 가운데선(y=0)에 맞춘다
  const r = alignTo(b(1, 0, 0), 30, 1.6, [other]);
  assert.equal(r.y, 0);
  assert.equal(r.x, 30, "x는 맞출 것이 없어 그대로");
  assert.equal(r.guides.length, 1);
  // 왼쪽 변 맞추기: 내 왼쪽 변(x-20)이 이웃 왼쪽 변(80)에 가깝다
  const r2 = alignTo(b(1, 0, 0), 101.5, 60, [other]);
  assert.equal(r2.x, 100, "가운데끼리");
  const r3 = alignTo(b(1, 0, 0, 0, 30), 96.2, 60, [other]);
  assert.equal(r3.x, 95, "왼쪽 변끼리 (80 + 15)");
  // 90° 돌린 이웃은 폭·깊이를 바꿔 본다, 비스듬하면 맞추지 않는다
  assert.equal(alignTo(b(1, 0, 0), 101, 50, [b(3, 100, 0, Math.PI / 2)]).x, 100);
  assert.equal(alignTo(b(1, 0, 0), 101, 50, [b(3, 100, 0, 0.3)]).x, 101);
  // 멀면 맞추지 않는다
  assert.equal(alignTo(b(1, 0, 0), 30, 1.6, [b(2, 900, 0)]).y, 1.6);
});

test("되돌리기 기록에 단계 설명이 따라간다", () => {
  const h = new EditHistory<number>(3, (n) => n);
  h.record(0, "가");
  h.record(1, "나");
  h.relabel("나2");
  assert.deepEqual(h.undoList, ["나2", "가"]);
  assert.equal(h.undo(2), 1);
  assert.deepEqual(h.redoList, ["나2"]);
  assert.equal(h.redo(1), 2);
  h.record(2, "다");
  h.record(3, "라");
  assert.deepEqual(h.undoList, ["라", "다", "나2"], "한도를 넘으면 오래된 것부터 빠진다");
  h.discardLast();
  assert.deepEqual(h.undoList, ["다", "나2"]);
});
