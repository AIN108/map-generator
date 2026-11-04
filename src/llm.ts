// 설정 글을 Claude로 읽어 건물 목록(목록 칸 형식)으로 바꾸는 선택 기능.
// 사용자가 넣은 자기 API 키로 브라우저에서 Anthropic API를 바로 부른다 (이 앱에는 서버가 없다).
// 결과는 parseProgram으로 다시 검사하므로, 모델이 형식을 틀려도 목록 칸에서 경고로 보인다.

import { LANDMARK_LABEL, STYLE_LABEL, TYPE_LABEL } from "./program.ts";

export const LLM_MODEL = "claude-opus-5-5";
/** 1M 토큰당 달러 (2026-10 기준 표). 표시용 어림값이다. */
const PRICE_IN = 4, PRICE_OUT = 20;
/** 보낼 수 있는 글 길이 (글자). 너무 긴 글은 잘라 보내지 않고 거절한다. */
export const MAX_PROSE_CHARS = 200_000;

/** 구조화 출력 형식: 목록 칸 글 + 확인이 필요한 점 */
export const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    program: { type: "string", description: "목록 칸 형식의 건물 목록 (한 줄에 하나)" },
    notes: { type: "array", items: { type: "string" }, description: "확인이 필요하거나 목록에 넣지 못한 점 (짧은 한국어 문장)" },
  },
  required: ["program", "notes"],
  additionalProperties: false,
} as const;

const uniq = (xs: string[]): string[] => [...new Set(xs)];

/** 시스템 지시: 목록 형식과 쓸 수 있는 말 (코드의 표에서 만들어 앱과 어긋나지 않게) */
export function systemPrompt(): string {
  const types = uniq(Object.values(TYPE_LABEL)).join("·");
  const styles = Object.values(STYLE_LABEL).join("·");
  const marks = Object.values(LANDMARK_LABEL).join("·");
  return [
    "당신은 소설·TRPG 설정 글에서 대학 캠퍼스의 시설과 위치를 찾아, 캠퍼스 조감도 생성기가 읽는 '건물 목록'으로 옮깁니다.",
    "글에 적힌 사실만 옮기고, 적혀 있지 않은 시설·층수·위치는 지어내지 않습니다. 모호하면 비워 두고 notes에 적습니다.",
    "",
    "목록 형식 (한 줄에 하나, 칸은 ' | '로 나눔):",
    "  @이름 대학 이름 (글에 있으면)",
    "  건물 이름 | 종류 | 층수 | 위치 | 외관",
    "  @상징물 이름 | 종류 | 위치",
    "- 건물 이름 뒤 칸은 순서와 상관없고, 모르는 칸은 빼도 됩니다.",
    `- 종류: ${types} 가운데 하나. 맞는 것이 없으면 빼면 이름으로 짐작합니다.`,
    "- 층수: '8층'처럼. 광장·운동장·코트에는 적지 않습니다.",
    "- 위치: 캠퍼스 기준 '남동쪽', '남동쪽 외곽', '중앙 북동쪽', '중앙', 또는 다른 건물 기준 '중앙광장 동쪽', '국제관 옆', '중앙도서관 뒤', '국제관 앞', 'A와 B 사이'.",
    "  기준 건물은 목록에 있는 이름과 똑같이 씁니다. 둘을 함께 써도 됩니다: '북동쪽 외곽, 국제관 옆'.",
    `- 외관: ${styles} 가운데 하나.`,
    "- 공식 시설로 세지 않는 곳(야외 운동장 등)은 칸에 '번호 없음'을 더합니다.",
    `- 상징물 종류: ${marks} 가운데 하나.`,
    "- 적은 순서가 번호가 되므로, 글에 번호가 있으면 그 순서를 따르고 없으면 대학본부·광장·도서관·학생회관을 먼저 둡니다.",
    "- 학과·단과대학 같은 조직, 온라인 커뮤니티, 사람, 사건은 시설이 아니므로 넣지 않습니다.",
    "- 시설은 40개까지. 넘으면 중요한 것부터 넣고 나머지는 notes에 적습니다.",
    "",
    "예:",
    "@이름 한빛대학교",
    "대학본부 | 본부 | 5층 | 중앙",
    "중앙광장 | 광장",
    "중앙도서관 | 도서관 | 8층 | 중앙광장 동쪽 | 유리",
    "종합체육관 | 체육관 | 남서쪽",
    "야외 운동장 | 운동장 | 종합체육관 뒤 | 번호 없음",
    "@상징물 소형 분수 | 분수 | 중앙광장 동쪽",
  ].join("\n");
}

export interface LlmResult {
  program: string;
  notes: string[];
  inputTokens: number;
  outputTokens: number;
  /** 어림 비용 (달러) */
  costUsd: number;
  /** 응답한 모델 (거절로 다른 모델이 이어받았으면 그 모델) */
  model: string;
}

/** 모델의 JSON 응답을 꺼내 검사한다 */
export function parseLlmOutput(text: string): { program: string; notes: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Claude의 응답을 읽지 못했습니다 (형식이 올바르지 않음). 다시 시도해 보세요.");
  }
  const o = raw as Record<string, unknown>;
  if (!o || typeof o.program !== "string") throw new Error("Claude의 응답에 목록이 없습니다.");
  const notes = Array.isArray(o.notes) ? o.notes.filter((n): n is string => typeof n === "string").slice(0, 20) : [];
  return { program: o.program.trim(), notes };
}

export const estimateCost = (inputTokens: number, outputTokens: number): number =>
  (inputTokens * PRICE_IN + outputTokens * PRICE_OUT) / 1_000_000;

/** API 오류를 알아듣기 쉬운 말로 */
export function describeError(err: unknown, mod?: typeof import("@anthropic-ai/sdk")): string {
  const A = mod?.default;
  if (A) {
    if (err instanceof A.APIUserAbortError) return "취소했습니다.";
    if (err instanceof A.AuthenticationError) return "API 키가 올바르지 않습니다. Anthropic Console에서 키를 확인하세요.";
    if (err instanceof A.PermissionDeniedError) return "이 키로는 이 모델을 쓸 수 없습니다 (권한 없음).";
    if (err instanceof A.RateLimitError) return "요청이 너무 많거나 한도를 넘었습니다. 잠시 뒤에 다시 시도하세요.";
    if (err instanceof A.BadRequestError) return `요청이 거절되었습니다: ${err.message}`;
    if (err instanceof A.APIConnectionError) return "Anthropic API에 연결하지 못했습니다 (네트워크·차단 확인).";
    if (err instanceof A.APIError) return `Anthropic API 오류 (${err.status ?? "?"}): ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export interface LlmOptions {
  signal?: AbortSignal;
  /** 받은 글자 수 (진행 표시) */
  onProgress?: (chars: number) => void;
}

/** 설정 글을 Claude로 읽어 목록 칸 글로 바꾼다. */
export async function extractWithClaude(apiKey: string, prose: string, opts: LlmOptions = {}): Promise<LlmResult> {
  const key = apiKey.trim();
  if (!key) throw new Error("API 키를 넣어 주세요.");
  const text = prose.trim();
  if (!text) throw new Error("읽을 설정 글이 없습니다. 파일을 불러오거나 목록 칸에 글을 붙여 넣으세요.");
  if (text.length > MAX_PROSE_CHARS) throw new Error(`글이 너무 깁니다 (${MAX_PROSE_CHARS.toLocaleString("ko-KR")}자까지). 시설이 나오는 부분만 골라 넣으세요.`);
  const mod = await import("@anthropic-ai/sdk");
  try {
    // 이 앱에는 서버가 없어 브라우저에서 바로 부른다. 키는 사용자 자신의 것이고 Anthropic으로만 간다.
    const client = new mod.default({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 });
    const stream = client.beta.messages.stream({
      model: LLM_MODEL,
      max_tokens: 32000,
      // 안전 분류기가 거절하면 서버가 알맞은 모델로 다시 돌린다
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
      system: systemPrompt(),
      messages: [{ role: "user", content: `다음 설정 글에서 캠퍼스 시설을 찾아 건물 목록으로 옮겨 주세요.\n\n<setting>\n${text}\n</setting>` }],
    }, { signal: opts.signal });
    let received = 0;
    stream.on("text", (delta) => { received += delta.length; opts.onProgress?.(received); });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("Claude가 이 글의 처리를 거절했습니다. 시설 묘사만 남기고 다시 시도해 보세요.");
    if (msg.stop_reason === "max_tokens") throw new Error("응답이 너무 길어 잘렸습니다. 글을 나눠서 읽혀 보세요.");
    const out = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const parsed = parseLlmOutput(out);
    const inputTokens = msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
    return { ...parsed, inputTokens, outputTokens: msg.usage.output_tokens, costUsd: estimateCost(inputTokens, msg.usage.output_tokens), model: msg.model };
  } catch (err) {
    throw new Error(describeError(err, mod));
  }
}
