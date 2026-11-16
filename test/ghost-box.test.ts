import assert from "node:assert/strict";
import { test } from "node:test";
import { fitCamera } from "../src/camera.ts";
import { generateSite } from "../src/site.ts";
import { drawGhostBox } from "../src/ui/ghostBox.ts";
import { recordingContext } from "./helpers/dom.ts";

const cam = fitCamera(generateSite("ghost", 12).boundary, "mid", 1600, 1200);
const box = { w: 40, d: 20, floors: 5, shape: "bar" as const };
const count = (c: ReturnType<typeof recordingContext>, name: string): number => c.calls.filter((k) => k.name === name).length;

test("놓을 수 있는 자리: 바닥을 칠하고 바닥·지붕 테두리와 네 모서리 기둥을 그린다", () => {
  const c = recordingContext();
  drawGhostBox(c, cam, 2, box, 0, 0, 0, true);
  assert.equal(count(c, "fill"), 1);
  assert.equal(count(c, "stroke"), 1);
  assert.equal(count(c, "closePath"), 2, "바닥과 지붕");
  assert.equal(count(c, "lineTo"), 3 + 3 + 3 + 4, "바닥 채우기 3 + 바닥·지붕 테두리 3씩 + 기둥 4");
  assert.equal(c.lineWidth, 1, "굵기 2를 배율 2로 나눔");
  assert.equal(c.strokeStyle, "rgba(60,200,120,0.95)");
});

test("막힌 자리는 빨강, 흐린 상자는 칠하지 않고 바닥만 점선으로", () => {
  const red = recordingContext();
  drawGhostBox(red, cam, 1, box, 0, 0, 0, false);
  assert.equal(red.strokeStyle, "rgba(230,60,60,0.95)");
  const faint = recordingContext();
  drawGhostBox(faint, cam, 1, box, 0, 0, 0, true, true);
  assert.equal(count(faint, "fill"), 0);
  assert.equal(count(faint, "closePath"), 1);
  assert.deepEqual(faint.calls.find((k) => k.name === "setLineDash")!.args[0], [5, 4]);
  assert.equal(faint.lineWidth, 1.5);
});
