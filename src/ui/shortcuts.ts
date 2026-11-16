// 편의 단축키: 방향키로 확대한 지도 옮기기(아무것도 고르지 않았을 때), 1~7 편집 도구, { } 나무 붓 크기, ? 단축키 목록 (main.ts에서 옮김)

import { MIN_SCALE, panBy, type View } from "../view.ts";
import { $ } from "./dom.ts";
import { arrowPan, stepValue } from "./gestures.ts";
import { TOOL_KEYS, TOOL_KO, type Tool } from "./tools.ts";

export interface ShortcutHost {
  /** 조감도 크기 (그리기 좌표) */
  width: number;
  height: number;
  /** 건물·상징물을 고른 상태인가 (고르면 방향키는 그것을 옮긴다) */
  hasSelection(): boolean;
  view(): View;
  setView(next: View): void;
  editMode(): boolean;
  setEditMode(on: boolean): void;
  tool(): Tool;
  setTool(t: Tool): void;
  status(message: string): void;
  drawOverlay(): void;
}

export function installShortcutKeys(host: ShortcutHost): void {
  const W = host.width, H = host.height;
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]")) return;
    if (target.closest?.("input, textarea, select") || target.isContentEditable) return;
    if (e.key === "?") {
      e.preventDefault();
      $<HTMLDialogElement>("shortcutHelp").showModal();
      return;
    }
    // 고른 것이 있으면 방향키는 그것을 옮긴다(main.ts의 처리기). 지도·확대 단추에 포커스가 있거나 아무 데도 없을 때만 지도를 옮긴다.
    const move = arrowPan(e.key, e.shiftKey);
    const onMap = target === document.body || target === document.documentElement || !!target.closest?.("#mapWrap");
    const view = host.view();
    if (move && !host.hasSelection() && onMap && view.scale > MIN_SCALE + 1e-6) {
      e.preventDefault();
      host.setView(panBy(view, -move[0] * W, -move[1] * H, W, H));
      return;
    }
    // 숫자 키: 편집 도구. 편집 모드가 꺼져 있으면 켜고 고른다.
    const t = /^[1-7]$/.test(e.key) ? TOOL_KEYS[Number(e.key) - 1] : undefined;
    if (t) {
      e.preventDefault();
      if (!host.editMode()) host.setEditMode(true);
      host.setTool(t);
      host.status(`도구: ${TOOL_KO[t]}`);
      return;
    }
    // { } (Shift+[ ]): 나무 붓 크기. [ ]는 앞·뒤 건물 고르기에 쓴다.
    if ((e.key === "{" || e.key === "}") && host.editMode() && host.tool() === "trees") {
      e.preventDefault();
      const r = $<HTMLInputElement>("treeRadius");
      r.value = String(stepValue(Number(r.value), e.key === "}" ? 1 : -1, Number(r.min), Number(r.max), Number(r.step)));
      $("treeRadiusOut").textContent = `${r.value}m`;
      host.drawOverlay();
    }
  });
  $("shortcutHelpOpen").addEventListener("click", () => $<HTMLDialogElement>("shortcutHelp").showModal());
  $("shortcutHelpClose").addEventListener("click", () => $<HTMLDialogElement>("shortcutHelp").close());
}
