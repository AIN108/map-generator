// 메모 핀 정보 창: 고른 메모의 제목·내용·색을 고치고 지운다.

import { deleteNote, findNote, updateNote, type EditResult } from "../edit.ts";
import { NOTE_COLORS, type Layout, type NoteColor } from "../layout.ts";
import { $ } from "./dom.ts";

export interface NoteHost {
  layout(): Layout | undefined;
  selected(): number | undefined;
  apply(edit: (l: Layout) => EditResult, mergeKey?: string): boolean;
  /** 메모 자리 설명 (배치도 칸·가까운 건물) */
  where(x: number, y: number): string;
  close(): void;
}

export function createNotePanel(host: NoteHost): { sync(): void } {
  const box = $("noteBox");
  const title = $<HTMLInputElement>("noteTitle");
  const text = $<HTMLTextAreaElement>("noteText");
  const color = $<HTMLSelectElement>("noteColor");
  color.replaceChildren(...(Object.keys(NOTE_COLORS) as NoteColor[]).map((c) => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = NOTE_COLORS[c].ko;
    return o;
  }));
  const current = (): number | undefined => host.selected();
  /** 칸에 보여 주고 있는 메모, 글을 쓰기 시작한 메모 (다른 메모를 고르면 쓰던 글은 원래 메모에 반영한다) */
  let shownId: number | undefined;
  let editingId: number | undefined;

  function sync(): void {
    const l = host.layout(), id = current();
    let force = false;
    if (id !== shownId) {
      shownId = id;
      force = true;
      const a = document.activeElement;
      // 쓰던 칸을 떠나게 해 change가 원래 메모로 먼저 들어가게 한다
      if (a instanceof HTMLElement && box.contains(a)) a.blur();
    }
    const n = l && id !== undefined ? findNote(l, id) : undefined;
    box.hidden = !n;
    if (!n) return;
    $("noteLegend").textContent = `메모 · ${n.title}`;
    if (force || document.activeElement !== title) title.value = n.title;
    if (force || document.activeElement !== text) text.value = n.text ?? "";
    color.value = n.color;
    box.style.setProperty("--note-color", NOTE_COLORS[n.color].fill);
    $("noteWhere").textContent = host.where(n.x, n.y);
  }

  for (const el of [title, text]) el.addEventListener("focus", () => { editingId = current(); });
  const target = (): number | undefined => editingId ?? current();
  title.addEventListener("change", () => {
    const id = target();
    if (id !== undefined) host.apply((l) => updateNote(l, id, { title: title.value }));
  });
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } });
  text.addEventListener("change", () => {
    const id = target();
    if (id !== undefined) host.apply((l) => updateNote(l, id, { text: text.value }), `note-text:${id}`);
  });
  color.addEventListener("change", () => {
    const id = current();
    if (id !== undefined) host.apply((l) => updateNote(l, id, { color: color.value as NoteColor }));
  });
  $("noteDelete").addEventListener("click", () => {
    const id = current();
    if (id !== undefined && host.apply((l) => deleteNote(l, id))) host.close();
  });
  $("noteClose").addEventListener("click", () => host.close());
  return { sync };
}
