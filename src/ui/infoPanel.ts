// 정보 창(마우스를 올리거나 고른 건물·상징물의 요약)과 지도 아래 번호 목록 (main.ts에서 옮김)

import { buildingType, STYLE_KO } from "../catalog.ts";
import { findBuilding, findLandmark } from "../edit.ts";
import { isPlace, numberMap, type Layout } from "../layout.ts";
import { FLOOR_H, grossArea } from "../model.ts";
import { eul } from "../names.ts";
import { LANDMARK_DESC } from "../paint.ts";
import type { Site } from "../site.ts";
import { gridCell } from "../siteplan.ts";

export type InfoPick = { kind: "building" | "landmark"; id: number };

/**
 * 정보 창에 적을 [항목, 값] 줄. gridSite는 배치도 칸을 셀 부지 (부지가 아직 없으면 undefined).
 */
export function infoRows(layout: Layout | undefined, gridSite: Site | undefined, p: InfoPick | undefined): [string, string][] {
  const rows: [string, string][] = [];
  if (!p || !layout) {
    rows.push(["안내", "건물에 마우스를 올리거나 눌러 보세요."]);
  } else if (p.kind === "building") {
    const b = findBuilding(layout, p.id);
    if (b) {
      const no = numberMap(layout.buildings).get(b.id);
      const t = buildingType(b.type);
      rows.push(["번호", no ? `${no}번` : "번호 없음"], ["이름", b.name]);
      if (t) rows.push(["용도", t.use]);
      if (gridSite) rows.push(["배치도 칸", gridCell({ site: gridSite }, b.x, b.y)]);
      if (isPlace(b)) {
        rows.push(["크기", `${Math.round(b.w)} × ${Math.round(b.d)} m`]);
      } else {
        const area = Math.round(grossArea(b) / 10) * 10;
        rows.push(
          ["층수", `지상 ${b.floors}층 (높이 약 ${Math.round(b.floors * FLOOR_H)} m)`],
          ["바닥", `${Math.round(b.w)} × ${Math.round(b.d)} m`],
          ["연면적", `약 ${area.toLocaleString("ko-KR")} m²`],
          ["외관", STYLE_KO[b.style]],
        );
      }
    }
  } else {
    const m = findLandmark(layout, p.id);
    if (m) rows.push(["상징물", m.name], ["설명", LANDMARK_DESC(m.kind)]);
  }
  return rows;
}

/** 정보 창(dl)에 줄을 채운다 */
export function renderInfo(el: HTMLElement, rows: [string, string][]): void {
  el.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    return [dt, dd];
  }));
}

/** 지도 아래 번호 목록: 번호 있는 건물마다 단추. 누르면 onPick(건물 id) */
export function renderLegend(el: HTMLElement, layout: Layout, selected: InfoPick | undefined, onPick: (id: number) => void): void {
  const numbers = numberMap(layout.buildings);
  el.replaceChildren(...layout.buildings.filter((b) => numbers.has(b.id)).map((b) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const no = document.createElement("b");
    no.textContent = String(numbers.get(b.id));
    const name = document.createElement("span");
    name.textContent = b.name;
    btn.append(no, name);
    btn.title = `${b.name}${eul(b.name)} 고르고 확대`;
    if (selected?.kind === "building" && selected.id === b.id) btn.setAttribute("aria-current", "true");
    btn.addEventListener("click", () => onPick(b.id));
    return btn;
  }));
}
