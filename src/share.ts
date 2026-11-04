// 편집한 배치를 링크에 담는다: 저장 파일(JSON)을 deflate로 줄여 base64url로 해시(#…&l=)에 붙인다.
// 받는 쪽은 JSON 파일을 불러올 때와 같은 검증(parseSavedFile)을 거친다.

import { parseSavedFile, type SavedFile } from "./edit.ts";

/** 링크에 담을 수 있는 최대 길이 (글자). 이보다 길면 JSON 파일을 쓰게 한다. */
export const MAX_SHARE_CHARS = 60000;
/** 풀었을 때 최대 크기 (압축 폭탄 방지) */
const MAX_JSON_BYTES = 2 * 1024 * 1024;

export const canShare = (): boolean => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  writer.write(data as unknown as BufferSource).catch(() => undefined);
  writer.close().catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new Error("링크의 배치가 너무 큽니다.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromBase64Url = (s: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("링크의 배치 값이 올바르지 않습니다.");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** 저장 파일 → 링크 조각 (base64url) */
export async function encodeShare(file: SavedFile): Promise<string> {
  if (!canShare()) throw new Error("이 브라우저는 링크 압축을 지원하지 않습니다. 'JSON 저장'을 쓰세요.");
  const json = new TextEncoder().encode(JSON.stringify(file));
  return toBase64Url(await pipe(json, new CompressionStream("deflate-raw")));
}

/** 링크 조각 → 검증한 저장 파일 */
export async function decodeShare(s: string): Promise<SavedFile> {
  if (!canShare()) throw new Error("이 브라우저는 링크에 담긴 배치를 풀 수 없습니다.");
  if (s.length > MAX_SHARE_CHARS * 2) throw new Error("링크의 배치가 너무 큽니다.");
  let raw: Uint8Array;
  try {
    raw = await pipe(fromBase64Url(s), new DecompressionStream("deflate-raw"), MAX_JSON_BYTES);
  } catch (e) {
    throw e instanceof Error && /너무 큽니다|올바르지/.test(e.message) ? e : new Error("링크의 배치가 손상되었습니다 (일부가 잘렸을 수 있습니다).");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error("링크의 배치가 손상되었습니다.");
  }
  return parseSavedFile(parsed);
}
