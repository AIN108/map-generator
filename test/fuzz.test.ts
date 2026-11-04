// 무작위 편집 퍼징 (가볍게): 편집이 받아들여지면 늘 저장 왕복이 되고, 값이 유한하고, 이름이 겹치지 않아야 한다.
// 실험에서 이 방법으로 각도 누적(저장 파일을 못 읽게 됨)·건물을 지나는 길·같은 이름 건물 문제를 찾았다.

import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { BUILDING_TYPES, LANDMARK_KINDS } from "../src/catalog.ts";
import * as E from "../src/edit.ts";
import { EDIT_RULES, generateLayout, isPlace, placementContext } from "../src/layout.ts";
import { effectiveSite } from "../src/roads.ts";
import { floorPlan, floorsOf } from "../src/rooms.ts";
import { generateSite, type CampusType } from "../src/site.ts";

test("무작위 편집 뒤에도 저장 왕복·유한한 값·겹치지 않는 이름", () => {
  let s = 777;
  const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  for (const [run, type] of (["classic", "grid", "river"] as CampusType[]).entries()) {
    const seed = `fuzz-ci-${run}`;
    const site = generateSite(seed, 20, { type });
    const l = E.cloneLayout(generateLayout(site, { seed, buildings: 20, hospital: true, name: "" }));
    for (let k = 0; k < 50; k++) {
      const ctx = placementContext(effectiveSite(site, l));
      const bs = l.buildings.filter((b) => !isPlace(b));
      const b = pick(bs);
      const R = (): number => rnd() - 0.5;
      const op = pick(["move", "rotate", "rotate", "angle", "resize", "shape", "custom", "paint", "add", "type", "dup", "road", "note", "room", "landmark"]);
      switch (op) {
        case "move": E.moveBuilding(ctx, l, b.id, b.x + R() * 100, b.y + R() * 100); break;
        case "rotate": E.rotateBuilding(ctx, l, b.id, 1.2 + rnd()); break;
        case "angle": E.setAngle(ctx, l, b.id, rnd() * 1440 - 720); break;
        case "resize": E.resizeBuilding(ctx, l, b.id, b.w * (0.7 + rnd() * 0.6), b.d * (0.7 + rnd() * 0.6)); break;
        case "shape": E.setShape(l, b.id, pick(E.BUILDING_SHAPES)); break;
        case "custom": E.toCustom(l, b.id); break;
        case "paint": if (b.form?.grid) E.paintCells(l, b.id, [[Math.floor(rnd() * b.form.grid.cells.length), Math.floor(rnd() * 26)]]); break;
        case "add": E.addBuilding(ctx, l, pick(BUILDING_TYPES).id, R() * site.rx, R() * site.ry); break;
        case "type": E.setType(l, b.id, pick(BUILDING_TYPES).id); break;
        case "dup": E.duplicateBuilding(ctx, l, b.id); break;
        case "road": E.addRoad(l, "road", [[R() * site.rx, R() * site.ry], [R() * site.rx, R() * site.ry]]); break;
        case "note": E.addNote(l, R() * site.rx, R() * site.ry); break;
        case "landmark": E.addLandmark(ctx, l, pick(LANDMARK_KINDS), R() * site.rx, R() * site.ry); break;
        case "room": {
          const f = floorsOf(b);
          const no = f.length ? floorPlan(b, pick(f)).rooms.find((r) => r.no)?.no : undefined;
          if (no) E.setRoomName(l, b.id, no, `방${k}`);
          break;
        }
      }
      const where = `${type} ${k}번째 편집(${op})`;
      const back = E.layoutFromJSON(JSON.parse(JSON.stringify(l)));
      assert.ok(isDeepStrictEqual(back, E.cloneLayout(l)), `${where}: 저장 왕복이 달라짐`);
      for (const x of l.buildings) {
        assert.ok([x.x, x.y, x.angle, x.w, x.d].every(Number.isFinite), `${where}: ${x.name} 값`);
        assert.ok(Math.abs(x.angle) <= 2 * Math.PI + 1e-3, `${where}: ${x.name} 각도 ${x.angle}`);
      }
      const names = l.buildings.map((x) => x.name);
      assert.equal(new Set(names).size, names.length, `${where}: 같은 이름 건물`);
    }
  }
});

test("각도가 한 바퀴를 넘겨 저장된 예전 파일도 읽고, 건물을 지나는 길은 거절한다", () => {
  const seed = "regress";
  const site = generateSite(seed, 14);
  const l = E.cloneLayout(generateLayout(site, { seed, buildings: 14, hospital: false, name: "" }));
  const raw = JSON.parse(JSON.stringify(l));
  raw.buildings[4].angle = 9.5;
  const back = E.layoutFromJSON(raw);
  const a = back.buildings[4].angle;
  assert.ok(Math.abs(a) <= Math.PI + 1e-3 && Math.abs(Math.cos(a) - Math.cos(9.5)) < 1e-3 && Math.abs(Math.sin(a) - Math.sin(9.5)) < 1e-3, `${a}`);
  const b = l.buildings.find((x) => !isPlace(x) && x.type !== "admin")!;
  const r = E.addRoad(l, "path", [[b.x - 80, b.y], [b.x + 80, b.y]]);
  assert.equal(r.ok, false);
  assert.match(r.message, /지나갑니다/);
  // 같은 이름으로 바꾸기는 거절, 추가하는 건물은 번호를 붙인다
  const other = l.buildings.find((x) => x.id !== b.id && !isPlace(x))!;
  assert.equal(E.renameBuilding(l, b.id, other.name).ok, false);
  const ctx = placementContext(site);
  const added = E.addBuilding(ctx, l, b.type, b.x + 200, b.y, EDIT_RULES, 400);
  if (added.ok) assert.notEqual(E.findBuilding(l, added.id!)!.name, b.name);
});
