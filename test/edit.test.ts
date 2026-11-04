import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addBuilding, addLandmark, cleanName, cloneLayout, deleteBuilding, editRules, layoutFromJSON, moveBuilding, parseSavedFile,
  renameBuilding, renameUniversity, rotateBuilding, setFloors, toSavedFile,
} from "../src/edit.ts";
import { checkPlacement, EDIT_RULES, generateLayout, isPlace, placementContext } from "../src/layout.ts";

const round = (v: number): number => Math.round(v * 10) / 10;
import { generateSite } from "../src/site.ts";

const setup = () => {
  const site = generateSite("edit", 24);
  const layout = generateLayout(site, { seed: "edit", buildings: 24, hospital: true, name: "" });
  return { site, ctx: placementContext(site), layout };
};

test("붙여 놓기를 끄면(반경 0) 막힌 자리는 거부하고 그대로 둔다", () => {
  const { ctx, layout } = setup();
  const [a, , c] = layout.buildings;
  const before = { x: c.x, y: c.y };
  const res = moveBuilding(ctx, layout, c.id, a.x, a.y, EDIT_RULES, 0);
  assert.equal(res.ok, false);
  assert.deepEqual({ x: c.x, y: c.y }, before);
});

test("막힌 자리로 옮기면 가까운 빈자리에 붙이고, 그 자리는 검사를 통과한다", () => {
  const { ctx, layout } = setup();
  let snapped = 0;
  for (const target of layout.buildings.slice(4, 14)) {
    const l = cloneLayout(layout);
    const mover = l.buildings.find((b) => b.type !== "admin" && b.id !== target.id && !isPlace(b) && b.w < 60)!;
    const res = moveBuilding(ctx, l, mover.id, target.x, target.y);
    if (!res.ok) continue;
    snapped++;
    const moved = l.buildings.find((b) => b.id === mover.id)!;
    assert.equal(checkPlacement(ctx, l.buildings, moved, moved.id, [], EDIT_RULES), undefined, res.message);
    assert.ok(Math.hypot(moved.x - target.x, moved.y - target.y) <= 46 + Math.max(mover.w, mover.d) / 2, "반경 안");
    assert.match(res.message, /붙였습니다|옮겼습니다/);
  }
  assert.ok(snapped >= 5, `붙여 놓기 성공 ${snapped}/10`);
});

test("자유 배치면 다른 건물과 겹쳐도 놓인다 (캠퍼스 밖은 안 됨)", () => {
  const { ctx, layout } = setup();
  const [a, , c] = layout.buildings;
  assert.equal(moveBuilding(ctx, layout, c.id, a.x + 5, a.y, editRules(true)).ok, true);
  assert.equal(c.x, round(a.x + 5));
  assert.equal(moveBuilding(ctx, layout, c.id, 5000, 0, editRules(true)).ok, false);
});

test("빈자리 찾기: 순환도로 안 여러 곳에서 대부분 놓을 수 있다", () => {
  const { site, ctx, layout } = setup();
  let ok = 0, n = 0;
  for (let k = 0; k < 40; k++) {
    const x = Math.cos(k * 2.4) * site.rx * 0.5 * (0.4 + (k % 5) * 0.15), y = Math.sin(k * 2.4) * site.ry * 0.5 * (0.4 + (k % 5) * 0.15);
    const l = cloneLayout(layout);
    n++;
    const r = addBuilding(ctx, l, "museum", x, y);
    if (!r.ok) continue;
    ok++;
    const b = l.buildings[l.buildings.length - 1];
    assert.equal(checkPlacement(ctx, l.buildings, b, b.id, [], EDIT_RULES), undefined);
  }
  assert.ok(ok / n > 0.6, `추가 성공 ${ok}/${n}`);
});

test("조금 옮기기는 된다", () => {
  const { ctx, layout } = setup();
  const b = layout.buildings[0];
  const res = moveBuilding(ctx, layout, b.id, b.x + 3, b.y);
  assert.equal(res.ok, true, res.message);
});

test("캠퍼스 밖으로는 못 옮긴다", () => {
  const { ctx, layout } = setup();
  const b = layout.buildings[5];
  assert.equal(moveBuilding(ctx, layout, b.id, 5000, 0).ok, false);
});

test("이름 정리: 공백·제어 문자 제거, 길이 제한, 빈 이름 거부", () => {
  assert.equal(cleanName("  새\u0007 이름  "), "새 이름");
  assert.equal(cleanName("가".repeat(50))!.length, 24);
  assert.equal(cleanName("   "), undefined);
  const { layout } = setup();
  assert.equal(renameBuilding(layout, layout.buildings[0].id, " ").ok, false);
  assert.equal(renameBuilding(layout, layout.buildings[0].id, "본관").ok, true);
  assert.equal(layout.buildings[0].name, "본관");
});

test("층수는 1~25로 자르고, 광장은 층수가 없다", () => {
  const { layout } = setup();
  const b = layout.buildings[0];
  setFloors(layout, b.id, 99);
  assert.equal(b.floors, 25);
  setFloors(layout, b.id, -3);
  assert.equal(b.floors, 1);
  assert.equal(setFloors(layout, layout.buildings[1].id, 3).ok, false);
  assert.equal(setFloors(layout, b.id, Number.NaN).ok, false);
});

test("지우면 뒤 번호가 당겨진다", () => {
  const { layout } = setup();
  const third = layout.buildings[3];
  deleteBuilding(layout, layout.buildings[2].id);
  assert.equal(layout.buildings[2], third);
});

test("빈 땅에 건물·상징물 추가, 새 id는 겹치지 않는다", () => {
  const { ctx, layout } = setup();
  let added: number | undefined;
  // 빈자리를 찾을 때까지 격자로 시도한다.
  outer: for (let y = -200; y <= 200; y += 20) {
    for (let x = -300; x <= 300; x += 20) {
      const r = addBuilding(ctx, layout, "museum", x, y);
      if (r.ok) { added = r.id; break outer; }
    }
  }
  assert.ok(added !== undefined, "빈자리가 없음");
  const ids = new Set([...layout.buildings.map((b) => b.id), ...layout.landmarks.map((m) => m.id)]);
  assert.equal(ids.size, layout.buildings.length + layout.landmarks.length);
  assert.equal(addBuilding(ctx, layout, "nope", 0, 0).ok, false);
  const lm = addLandmark(ctx, layout, "statue", 5000, 5000);
  assert.equal(lm.ok, false);
});

test("회전은 겹침을 검사한다", () => {
  const { ctx, layout } = setup();
  const b = layout.buildings[0];
  const before = b.angle;
  const res = rotateBuilding(ctx, layout, b.id, Math.PI / 2);
  if (!res.ok) assert.equal(b.angle, before);
});

test("대학 이름을 바꾸면 병원 이름도 따라 바뀐다", () => {
  const { layout } = setup();
  const hospital = layout.buildings.find((b) => b.type === "hospital");
  assert.ok(hospital);
  renameUniversity(layout, "미적분");
  assert.equal(layout.name, "미적분대학교");
  assert.equal(hospital.name, "미적분대학교병원");
});

test("JSON 저장 → 불러오기는 같은 배치", () => {
  const { layout } = setup();
  const file = toSavedFile({ seed: "edit", buildings: 24, hospital: true, season: "spring", time: "day", view: "mid", surround: "forest" }, layout);
  const parsed = parseSavedFile(JSON.parse(JSON.stringify(file)));
  assert.deepEqual(parsed.layout, cloneLayout(layout));
  assert.equal(parsed.options.seed, "edit");
});

test("잘못된 JSON은 거부한다", () => {
  const { layout } = setup();
  const good = JSON.parse(JSON.stringify(layout));
  assert.throws(() => parseSavedFile({ format: "other" }));
  assert.throws(() => layoutFromJSON({ ...good, buildings: [{ ...good.buildings[0], x: "1" }] }));
  assert.throws(() => layoutFromJSON({ ...good, buildings: [{ ...good.buildings[0], type: "castle" }] }));
  assert.throws(() => layoutFromJSON({ ...good, buildings: [good.buildings[0], good.buildings[0]] }), /id/);
  assert.throws(() => layoutFromJSON({ ...good, landmarks: [{ ...good.landmarks[0], kind: "ufo" }] }));
  assert.throws(() => layoutFromJSON({ ...good, buildings: new Array(100).fill(good.buildings[0]) }));
  // nextId가 기존 id보다 작으면 올려 잡는다
  const fixed = layoutFromJSON({ ...good, nextId: 1 });
  assert.ok(fixed.nextId > Math.max(...fixed.buildings.map((b) => b.id), ...fixed.landmarks.map((m) => m.id)));
});
