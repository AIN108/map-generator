// UI 모듈 단위 테스트용 브라우저 흉내: index.html의 화면 요소를 happy-dom 창에 올리고 필요한 전역을 건다.
// node --test는 파일마다 따로 돌므로 테스트 파일마다 한 번 부르면 된다. 앱 스크립트(main.ts)는 실행하지 않는다.

import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

export interface Dom {
  window: Window;
  /** confirm()이 돌려줄 값과 받은 문구 */
  confirm: { answer: boolean; asked: string[] };
  /** 클립보드에 쓴 글 */
  clipboard: string[];
}

/** 그리기 호출을 기록만 하는 Canvas 2D 흉내 (happy-dom은 캔버스를 그리지 않는다) */
export interface RecordingContext {
  calls: { name: string; args: unknown[] }[];
  texts: string[];
}

export function recordingContext(): CanvasRenderingContext2D & RecordingContext {
  const rec: RecordingContext = { calls: [], texts: [] };
  const state: Record<string | symbol, unknown> = { font: "10px sans-serif", lineWidth: 1, globalAlpha: 1 };
  return new Proxy(rec as unknown as CanvasRenderingContext2D & RecordingContext, {
    get(target, key) {
      if (key === "calls" || key === "texts") return (target as unknown as RecordingContext)[key];
      if (key === "measureText") return (t: string) => ({ width: t.length * 6 });
      if (key === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (key === "getLineDash") return () => [];
      if (key in state) return state[key];
      return (...args: unknown[]) => {
        rec.calls.push({ name: String(key), args });
        if (key === "fillText") rec.texts.push(String(args[0]));
      };
    },
    set(_target, key, value) {
      state[key] = value;
      return true;
    },
  });
}

export function installDom(): Dom {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<link[^>]*>/g, "");
  const window = new Window({ url: "https://example.test/", width: 1400, height: 950 });
  window.document.write(html);
  const dom: Dom = { window, confirm: { answer: true, asked: [] }, clipboard: [] };
  const confirm = (message?: string): boolean => {
    dom.confirm.asked.push(String(message ?? ""));
    return dom.confirm.answer;
  };
  (window as unknown as { confirm: typeof confirm }).confirm = confirm;
  const contexts = new WeakMap<object, CanvasRenderingContext2D>();
  (window.HTMLCanvasElement.prototype as unknown as { getContext: (kind: string) => unknown }).getContext = function (this: object, kind: string) {
    if (kind !== "2d") return null;
    if (!contexts.has(this)) contexts.set(this, recordingContext());
    return contexts.get(this);
  };
  const g = globalThis as Record<string, unknown>;
  for (const key of [
    "document", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLSelectElement", "HTMLTextAreaElement",
    "HTMLCanvasElement", "HTMLDialogElement", "Node", "localStorage", "location", "getComputedStyle", "requestAnimationFrame",
  ] as const) {
    const v = (window as unknown as Record<string, unknown>)[key];
    g[key] = typeof v === "function" && /^[a-z]/.test(key) ? (v as (...a: unknown[]) => unknown).bind(window) : v;
  }
  g.window = window;
  g.confirm = confirm;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (s: string) => { dom.clipboard.push(s); } } },
  });
  return dom;
}

/** 이벤트를 보낸다 (input·change·click·keydown 등) */
export function fire(el: Element, type: string, init: Record<string, unknown> = {}): void {
  const w = (globalThis as unknown as { window: Window }).window;
  const Ctor = type.startsWith("key") ? w.KeyboardEvent : w.Event;
  el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, ...init }) as unknown as Event);
}

export const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 없음`);
  return el as T;
};

/** 기다리던 비동기 처리(Promise 연쇄)를 비운다 */
export const flush = async (n = 5): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
