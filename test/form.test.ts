import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cloneLayout, layoutFromJSON, paintCells, setFloors, setForm, setGridSize, setShape, toCustom,
} from "../src/edit.ts";
import { formFromText, formToText, gridFromText, gridRings, gridToText, resolveForm, type FormGrid } from "../src/form.ts";
import { polygonArea } from "../src/geom.ts";
import { generateLayout, isPlace, type Building, type Layout } from "../src/layout.ts";
import { buildModel, FLOOR_H, grossArea, planMasses } from "../src/model.ts";
import { parseProgram, programToText } from "../src/program.ts";
import { generateFromProgram } from "../src/programLayout.ts";
import { generateSite } from "../src/site.ts";
import { programFromLayout } from "../src/sync.ts";

const grid = (rows: string[]): FormGrid => ({
  cols: rows[0].length, rows: rows.length, cells: rows.join("").split("").map(Number),
});
const ringArea = (r: [number, number][]): number => Math.abs(polygonArea(r));

test("칸 윤곽선: ㄱ자는 꼭짓점 6개, 가운데 빈 칸은 구멍, 꼭짓점만 닿은 칸은 따로", () => {
  const l = gridRings(grid(["11", "10"]), (v) => v > 0);
  assert.equal(l.length, 1);
  assert.equal(l[0].outer.length, 6);
  assert.equal(ringArea(l[0].outer), 3);

  const ring = gridRings(grid(["111", "101", "111"]), (v) => v > 0);
  assert.equal(ring.length, 1);
  assert.equal(ring[0].holes.length, 1);
  assert.equal(ringArea(ring[0].outer) - ringArea(ring[0].holes[0]), 8);

  const diag = gridRings(grid(["10", "01"]), (v) => v > 0);
  assert.equal(diag.length, 2);
  assert.ok(diag.every((d) => d.outer.length === 4 && d.holes.length === 0));
});

const building = (over: Partial<Building> = {}): Building => ({
  id: 1, type: "generic", name: "시험관", x: 0, y: 0, angle: 0, w: 40, d: 30, floors: 5, style: "modern", shape: "bar", variant: 0.3, ...over,
});

test("자유형 모형: 층이 다른 칸은 높이 띠로 쌓이고 연면적은 칸 넓이 × 층수의 합", () => {
  const g = grid(["3300", "3311", "0011"]);
  const b = building({ shape: "custom", w: 40, d: 30, floors: 3, form: { grid: g } });
  const cellArea = (40 / 4) * (30 / 3);
  const expect = g.cells.reduce((s, v) => s + v * cellArea, 0);
  assert.ok(Math.abs(grossArea(b) - expect) < 1e-6, `${grossArea(b)} ≠ ${expect}`);
  const m = buildModel(b);
  assert.ok(Math.abs(m.height - 3 * FLOOR_H) < 1e-6);
  const masses = planMasses(b);
  assert.deepEqual(masses.map((x) => [Math.round(x.z0 / FLOOR_H), Math.round(x.z1 / FLOOR_H)]).sort(), [[0, 1], [1, 3]].sort());
});

test("지금 모양을 자유형으로: 중정은 빈칸, 높이는 그대로", () => {
  const l: Layout = { name: "시험대학교", buildings: [building({ shape: "court", w: 48, d: 48, floors: 4 })], landmarks: [], nextId: 2 };
  const before = grossArea(l.buildings[0]);
  assert.equal(toCustom(l, 1, 6).ok, true);
  const b = l.buildings[0];
  assert.equal(b.shape, "custom");
  const g = b.form!.grid!;
  assert.deepEqual([g.cols, g.rows], [8, 8]);
  assert.equal(g.cells[3 * 8 + 3], 0, "가운데는 비어 있다");
  assert.equal(g.cells[0], 4);
  assert.equal(b.floors, 4);
  assert.ok(Math.abs(grossArea(b) - before) / before < 0.2, "연면적이 크게 달라지지 않는다");
  // 층수를 바꾸면 비율대로, 칸 수를 바꾸면 가까운 값으로
  assert.equal(paintCells(l, 1, [[0, 8]]).ok, true);
  assert.equal(b.floors, 8);
  assert.equal(setFloors(l, 1, 4).ok, true);
  assert.equal(g.cells[0], 4);
  assert.equal(g.cells[1], 2);
  assert.equal(setGridSize(l, 1, 4, 4).ok, true);
  assert.deepEqual([b.form!.grid!.cols, b.form!.grid!.rows], [4, 4]);
  // 모두 비울 수는 없다
  assert.equal(paintCells(l, 1, b.form!.grid!.cells.map((_, k) => [k, 0] as const)).ok, false);
  // 다른 모양으로 돌아가면 평면은 버린다
  assert.equal(setShape(l, 1, "bar").ok, true);
  assert.equal(b.form, undefined);
});

test("세부 조절 값은 범위 안으로 잘리고, 모양에 없는 값은 거절", () => {
  const l: Layout = { name: "시험대학교", buildings: [building({ shape: "L" })], landmarks: [], nextId: 2 };
  assert.equal(setForm(l, 1, { wing: 0.9, flip: true, roof: "hip" }).ok, true);
  const b = l.buildings[0];
  assert.deepEqual(b.form, { wing: 0.6, flip: true, roof: "hip" });
  assert.equal(resolveForm(b).depth, 0.55, "정하지 않은 값은 기본값");
  assert.equal(setForm(l, 1, { podium: 2 }).ok, false, "ㄱ자에는 저층부가 없다");
  assert.equal(setForm(l, 1, { wing: undefined }).ok, true);
  assert.deepEqual(b.form, { flip: true, roof: "hip" });
  // 날개 폭을 넓히면 ㄱ자 앞 날개 바닥이 넓어진다
  const narrow = grossArea({ ...b, form: { wing: 0.2 } }), wide = grossArea({ ...b, form: { wing: 0.5 } });
  assert.ok(wide > narrow);
});

test("모양 값은 JSON에 저장·검증되고, 복사본을 고쳐도 원본은 그대로", () => {
  const seed = "form-json";
  const site = generateSite(seed, 14);
  const layout = generateLayout(site, { seed, buildings: 14, hospital: false, name: "" });
  const l = cloneLayout(layout);
  const a = l.buildings.find((b) => !isPlace(b) && b.type !== "admin")!;
  toCustom(l, a.id);
  const back = layoutFromJSON(JSON.parse(JSON.stringify(l)));
  assert.deepEqual(back, cloneLayout(l));
  const copy = cloneLayout(l);
  copy.buildings.find((b) => b.id === a.id)!.form!.grid!.cells[0] = 9;
  assert.notEqual(l.buildings.find((b) => b.id === a.id)!.form!.grid!.cells[0], 9, "깊은 복사");
  const bad = JSON.parse(JSON.stringify(l));
  bad.buildings.find((b: Building) => b.id === a.id).form.grid.cells = [1, 2];
  assert.throws(() => layoutFromJSON(bad), /평면/);
  const noGrid = JSON.parse(JSON.stringify(l));
  delete noGrid.buildings.find((b: Building) => b.id === a.id).form;
  assert.throws(() => layoutFromJSON(noGrid), /평면/);
});

test("목록 글의 형태·평면 칸이 왕복된다", () => {
  assert.deepEqual(formFromText(formToText({ wing: 0.35, depth: 0.6, flip: true, podium: 3, roof: "flat" })), {
    wing: 0.35, depth: 0.6, flip: true, podium: 3, roof: "flat",
  });
  const g = grid(["3300", "3311", "0011"]);
  assert.equal(gridToText(g), "4x3 3300/3311/0011");
  assert.deepEqual(gridFromText(gridToText(g)), g);
  assert.equal(gridFromText("4x3 3300/3311"), undefined, "줄 수가 다르면 거절");

  const seed = "form-sync";
  const site = generateSite(seed, 14);
  const layout = generateLayout(site, { seed, buildings: 14, hospital: false, name: "" });
  const l = cloneLayout(layout);
  const bs = l.buildings.filter((b) => !isPlace(b) && b.type !== "admin");
  toCustom(l, bs[0].id);
  paintCells(l, bs[0].id, [[0, 0], [1, 9]]);
  setShape(l, bs[1].id, "U");
  setForm(l, bs[1].id, { wing: 0.2, depth: 0.6, roof: "hip" });
  const text = programToText(programFromLayout(l, site, undefined, { pinAll: true, site: { auto: true, buildings: 14 } }));
  assert.match(text, /모양 자유형 \| [^\n]*평면 \d+x\d+ /);
  assert.match(text, /형태 날개20 깊이60 경사지붕/);
  const parsed = parseProgram(text);
  assert.deepEqual(parsed.warnings, []);
  const again = generateFromProgram(seed, parsed.program).layout;
  const by = (n: string) => again.buildings.find((b) => b.name === n)!;
  assert.equal(by(bs[0].name).shape, "custom");
  assert.deepEqual(by(bs[0].name).form, l.buildings.find((b) => b.id === bs[0].id)!.form);
  assert.equal(by(bs[0].name).floors, 9);
  assert.deepEqual(by(bs[1].name).form, { wing: 0.2, depth: 0.6, roof: "hip" });
});
