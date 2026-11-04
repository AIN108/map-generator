import assert from "node:assert/strict";
import { test } from "node:test";
import { generateSite } from "../src/site.ts";
import { columnName, gridCell, planOrigin } from "../src/siteplan.ts";

test("배치도 격자 칸 이름: 열은 A·B…Z·AA, 행은 1부터, 50 m마다", () => {
  assert.deepEqual([0, 1, 25, 26, 27].map(columnName), ["A", "B", "Z", "AA", "AB"]);
  const site = generateSite("plan", 20);
  const { x0, y0 } = planOrigin({ site });
  const first = gridCell({ site }, x0 + 1, y0 + 1);
  assert.match(first, /^[A-Z]1$/);
  // 50 m 동쪽·남쪽으로 가면 한 칸씩
  const a = gridCell({ site }, 0, 0), b = gridCell({ site }, 50, 50);
  const col = (s: string) => s.replace(/\d+$/, ""), row = (s: string) => Number(s.replace(/^[A-Z]+/, ""));
  assert.equal(col(b).charCodeAt(0) - col(a).charCodeAt(0), 1);
  assert.equal(row(b) - row(a), 1);
  // 조감도 크기·확대와 무관하게 같은 칸 (부지 경계로만 정한다)
  assert.equal(gridCell({ site }, 123, -45), gridCell({ site }, 123, -45, { grid: 10, major: 5 }));
});
