import assert from "node:assert/strict";
import { test } from "node:test";
import type { Shape } from "../src/catalog.ts";
import { FORM_SPEC, resolveForm } from "../src/form.ts";
import type { Building } from "../src/layout.ts";
import { cellAt, dragHandle, facingText, planHandles } from "../src/plan.ts";

const building = (shape: Shape, over: Partial<Building> = {}): Building => ({
  id: 1, type: "generic", name: "시험관", x: 0, y: 0, angle: 0, w: 60, d: 36, floors: 8, style: "modern", shape, variant: 0.3, ...over,
});

test("손잡이를 제자리에 두면 값이 그대로, 옮기면 그만큼 바뀐다", () => {
  for (const shape of Object.keys(FORM_SPEC) as Shape[]) {
    for (const flip of [false, true]) {
      const b = building(shape, { form: FORM_SPEC[shape]?.flip ? { flip } : undefined });
      const f = resolveForm(b);
      for (const h of planHandles(b)) {
        const r = dragHandle(b, h.key, h.u, h.v);
        if (h.key === "w") assert.equal(r.w, b.w, `${shape} 폭`);
        else if (h.key === "d") assert.equal(r.d, b.d, `${shape} 깊이`);
        else assert.ok(Math.abs((r.form?.[h.key] ?? -1) - f[h.key]) < 0.011, `${shape}${flip ? " 뒤집음" : ""} ${h.key}: ${r.form?.[h.key]} ≠ ${f[h.key]}`);
      }
    }
  }
  const b = building("U");
  const wing = planHandles(b).find((h) => h.key === "wing")!;
  const r = dragHandle(b, "wing", wing.u - 6, wing.v);
  assert.ok(r.form!.wing! > resolveForm(b).wing, "ㄷ자 날개 경계를 안쪽으로 끌면 날개가 넓어진다");
  assert.equal(dragHandle(b, "wing", 0, 0).form!.wing, FORM_SPEC.U!.wing!.hi, "범위 끝에서 멈춘다");
  assert.equal(dragHandle(b, "w", 500, 0).w, 220);
});

test("자유형 칸 찾기와 정면 방위", () => {
  const b = building("custom", { w: 40, d: 30, form: { grid: { cols: 4, rows: 3, cells: Array(12).fill(1) } } });
  assert.equal(cellAt(b, -19, -14), 0);
  assert.equal(cellAt(b, 19, 14), 11);
  assert.equal(cellAt(b, 21, 0), undefined);
  assert.equal(cellAt(building("bar"), 0, 0), undefined);
  assert.equal(facingText(0), "남");
  assert.equal(facingText(Math.PI), "북");
  assert.equal(facingText(Math.PI / 2), "서");
});
