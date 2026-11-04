// 화면 요소 찾기와 파일 내려받기 (여러 UI 모듈이 같이 쓴다)

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 요소가 없습니다.`);
  return el as T;
};

export function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 파일 이름에 쓸 수 없는 글자를 밑줄로 */
export const safeFileName = (s: string): string => s.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40) || "campus";

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
