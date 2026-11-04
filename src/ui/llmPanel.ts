// 'Claude로 설정 글 읽기' 칸: 사용자 API 키로 설정 글을 목록 형식으로 옮긴다 (선택 기능).

import { estimateCost, extractWithClaude, LLM_MODEL, MAX_PROSE_CHARS } from "../llm.ts";
import { $ } from "./dom.ts";

const KEY_STORE = "cmg:anthropic-key:v1";

export interface LlmHost {
  /** 읽을 글: 마지막으로 불러온 설정 글, 없으면 목록 칸의 글 */
  prose(): { text: string; source: string };
  /** 결과를 목록 칸에 넣고 알린다 */
  fill(programText: string, lines: string[]): void;
}

export function createLlmPanel(host: LlmHost): { refresh(): void } {
  const key = $<HTMLInputElement>("llmKey");
  const remember = $<HTMLInputElement>("llmRemember");
  const run = $<HTMLButtonElement>("llmRun");
  const cancel = $<HTMLButtonElement>("llmCancel");
  const out = $("llmReport");
  let ctrl: AbortController | undefined;
  try {
    const saved = localStorage.getItem(KEY_STORE);
    if (saved) { key.value = saved; remember.checked = true; }
  } catch {
    // 저장소를 쓸 수 없으면 기억하지 않는다
  }
  const store = (): void => {
    try {
      if (remember.checked && key.value.trim()) localStorage.setItem(KEY_STORE, key.value.trim());
      else localStorage.removeItem(KEY_STORE);
    } catch {
      // 무시
    }
  };
  remember.addEventListener("change", store);
  key.addEventListener("change", store);

  const say = (text: string, error = false): void => {
    out.textContent = text;
    out.classList.toggle("error", error);
  };
  /** 보내기 전 어림: 한국어는 대략 1.5자에 1토큰으로 친다 (실제 수는 실행 뒤에 보여 준다) */
  function refresh(): void {
    if (ctrl) return;
    const { text, source } = host.prose();
    const n = text.trim().length;
    if (!n) { say("읽을 글이 없습니다. 위 '파일 불러오기'로 설정 글을 열거나 목록 칸에 글을 붙여 넣으세요."); return; }
    const tokens = Math.round(n / 1.5);
    say(`보낼 글: ${source} ${n.toLocaleString("ko-KR")}자 (입력 약 ${tokens.toLocaleString("ko-KR")}토큰, 어림 $${estimateCost(tokens, 4000).toFixed(2)} 안팎)${n > MAX_PROSE_CHARS ? " — 너무 깁니다" : ""}`);
  }
  $("llmBox").addEventListener("toggle", refresh);

  run.addEventListener("click", () => {
    const { text, source } = host.prose();
    ctrl = new AbortController();
    run.disabled = true;
    cancel.hidden = false;
    say(`Claude(${LLM_MODEL})가 ${source}을(를) 읽는 중입니다. 글 길이에 따라 수십 초에서 몇 분 걸립니다…`);
    store();
    const t0 = performance.now();
    extractWithClaude(key.value, text, {
      signal: ctrl.signal,
      onProgress: (chars) => say(`Claude가 목록을 쓰는 중… (${chars.toLocaleString("ko-KR")}자 받음)`),
    }).then((r) => {
      const sec = Math.round((performance.now() - t0) / 1000);
      host.fill(r.program, [
        `Claude가 목록을 만들었습니다 (${sec}초, 입력 ${r.inputTokens.toLocaleString("ko-KR")}·출력 ${r.outputTokens.toLocaleString("ko-KR")}토큰, 어림 $${r.costUsd.toFixed(3)}${r.model !== LLM_MODEL ? `, ${r.model}이(가) 대신 응답` : ""}). 확인하고 '이 목록으로 생성'을 누르세요.`,
        ...r.notes.map((n) => `참고: ${n}`),
      ]);
      say("완료. 결과는 목록 칸에 들어갔습니다.");
    }).catch((err: unknown) => {
      say(err instanceof Error ? err.message : String(err), true);
    }).finally(() => {
      ctrl = undefined;
      run.disabled = false;
      cancel.hidden = true;
    });
  });
  cancel.addEventListener("click", () => ctrl?.abort());
  return { refresh };
}
