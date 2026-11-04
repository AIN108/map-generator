import assert from "node:assert/strict";
import { test } from "node:test";
import { fitCamera } from "../src/camera.ts";
import { addNote, cloneLayout, deleteNote, layoutFromJSON, MAX_NOTES, moveNote, updateNote } from "../src/edit.ts";
import { layoutToProse } from "../src/export.ts";
import { generateLayout } from "../src/layout.ts";
import { deriveScene } from "../src/scene.ts";
import { generateSite } from "../src/site.ts";
import { buildWalkGrid } from "../src/walk.ts";
import { buildDrawList, computeForest } from "../src/drawlist.ts";
import { makePalette } from "../src/palette.ts";

const setup = () => {
  const seed = "notes";
  const site = generateSite(seed, 14);
  const layout = cloneLayout(generateLayout(site, { seed, buildings: 14, hospital: false, name: "" }));
  return { seed, site, layout };
};

test("메모 꽂기·고치기·옮기기·지우기, JSON 왕복·검증", () => {
  const { layout: l } = setup();
  const r = addNote(l, 10.04, -20, undefined, "blue");
  assert.equal(r.ok, true);
  const id = r.id!;
  assert.equal(l.notes![0].title, "메모 1");
  assert.equal(updateNote(l, id, { title: " 비밀 통로 ", text: "밤 11시 이후\r\n\n\n\n경비 교대\u0007", color: "purple" }).ok, true);
  assert.deepEqual({ ...l.notes![0] }, { id, x: 10, y: -20, title: "비밀 통로", text: "밤 11시 이후\n\n경비 교대", color: "purple" });
  assert.equal(updateNote(l, id, { title: "  " }).ok, false, "빈 제목은 거절");
  assert.equal(moveNote(l, id, 55.55, 12).ok, true);
  assert.equal(l.notes![0].x, 55.6);
  const back = layoutFromJSON(JSON.parse(JSON.stringify(l)));
  assert.deepEqual(back, cloneLayout(l));
  assert.throws(() => layoutFromJSON({ ...JSON.parse(JSON.stringify(l)), notes: [{ ...l.notes![0], color: "pink" }] }), /메모/);
  assert.throws(() => layoutFromJSON({ ...JSON.parse(JSON.stringify(l)), notes: [{ ...l.notes![0], text: "x".repeat(600) }] }), /메모/);
  assert.equal(deleteNote(l, id).ok, true);
  assert.equal(l.notes, undefined);
  for (let k = 0; k < MAX_NOTES; k++) addNote(l, k, k);
  assert.equal(addNote(l, 0, 0).ok, false, "개수 제한");
});

test("메모는 그리기 목록·설정 글에 들어간다", () => {
  const { seed, site, layout: l } = setup();
  addNote(l, 0, 40, "총학생회 집회", "red");
  updateNote(l, l.notes![0].id, { text: "금요일 정오" });
  const cam = fitCamera(site.boundary, "mid", 1600, 1200);
  const scene = deriveScene(site, l, seed, "forest", cam);
  const dl = buildDrawList(scene, cam, makePalette("spring", "day"), seed, computeForest(scene, cam, seed));
  assert.equal(dl.notes.length, 1);
  assert.ok(dl.notes[0].y < dl.notes[0].gy, "핀 머리는 바닥보다 위");
  const prose = layoutToProse(l, scene, buildWalkGrid(scene)).text;
  assert.match(prose, /## 메모\n\n- \*\*총학생회 집회\*\* \([^)]+\): 금요일 정오/);
});
