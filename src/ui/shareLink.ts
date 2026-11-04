// 링크 복사·링크로 받은 배치 열기. 편집한 배치·건물 목록은 줄여서 해시(&l=…)에 담는다.

import type { SavedFile } from "../edit.ts";
import { canShare, decodeShare, encodeShare, MAX_SHARE_CHARS } from "../share.ts";
import { $, errorText } from "./dom.ts";

export interface ShareHost {
  /** 지금 상태 */
  current(): SavedFile | undefined;
  /** 링크에 배치를 담아야 하는가 (편집했거나 목록을 씀) */
  hasEdits(): boolean;
  hasProgram(): boolean;
  /** 받은 배치를 연다 (그 전에 이 브라우저의 자동 저장 편집을 보관). 보관한 판 이름을 돌려준다. */
  open(file: SavedFile): string;
  /** 지금 상태로 해시를 다시 쓴다 (&l= 없이) */
  rewriteHash(): void;
  ready(): boolean;
  edited(): boolean;
  status(message: string, error?: boolean): void;
}

export interface ShareLink {
  /** 시작할 때 해시에 배치가 있으면 연다. 열었으면 true, 실패했으면 그 오류 문구를 error로 */
  openFromHash(): Promise<{ opened: boolean; error?: string }>;
}

const dataOf = (): string | null => new URLSearchParams(location.hash.slice(1)).get("l");

export function createShareLink(host: ShareHost): ShareLink {
  async function openData(data: string): Promise<{ opened: boolean; error?: string }> {
    try {
      const file = await decodeShare(data);
      const backup = host.open(file);
      host.status("링크에 담긴 배치를 열었습니다." + (backup ? ` 이 브라우저에 있던 편집은 '저장해 둔 판'의 '${backup}'에 보관했습니다.` : ""));
      return { opened: true };
    } catch (err) {
      return { opened: false, error: `링크에 담긴 배치를 열지 못했습니다: ${errorText(err)}` };
    }
  }

  $("copyLink").addEventListener("click", async () => {
    let link = location.href;
    let note = "현재 조감도 링크를 복사했습니다.";
    const file = host.current();
    if (host.hasEdits() && file) {
      if (!canShare()) {
        note = "링크를 복사했습니다. 이 브라우저는 편집한 배치를 링크에 담을 수 없으니 함께 보내려면 'JSON 저장'을 쓰세요.";
      } else {
        const data = await encodeShare(file);
        if (data.length > MAX_SHARE_CHARS) {
          note = `편집한 배치가 너무 커서(${data.length.toLocaleString("ko-KR")}자) 링크에 담지 못했습니다. 'JSON 저장'을 쓰세요.`;
        } else {
          link = `${location.href.split("#")[0]}${location.hash || "#"}&l=${data}`;
          note = `편집한 배치${host.hasProgram() ? "와 건물 목록" : ""}까지 담은 링크를 복사했습니다 (${link.length.toLocaleString("ko-KR")}자).`
            + (link.length > 8000 ? " 일부 메신저에서는 긴 링크가 잘릴 수 있습니다." : "");
        }
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      host.status(note);
    } catch {
      host.status("클립보드에 접근할 수 없습니다. 주소창의 링크를 직접 복사하세요.", true);
    }
  });

  // 이미 열린 탭에 배치 링크를 붙여 넣은 경우 (해시만 바뀌어 페이지를 다시 읽지 않는다)
  window.addEventListener("hashchange", () => {
    const data = dataOf();
    if (!data || !host.ready()) return;
    if (host.edited() && !confirm("링크에 담긴 배치를 엽니다. 지금 편집은 '저장해 둔 판'에 보관됩니다. 열까요?")) {
      host.rewriteHash();
      return;
    }
    void openData(data).then((r) => {
      if (!r.opened) { host.rewriteHash(); host.status(r.error ?? "", true); }
    });
  });

  return {
    async openFromHash() {
      const data = dataOf();
      return data ? openData(data) : { opened: false };
    },
  };
}
