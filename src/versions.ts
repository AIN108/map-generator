// 이름 붙여 저장해 둔 판 (이 브라우저의 localStorage에만 남는다).
// 저장 형식은 JSON 파일과 같은 SavedFile이라, 읽을 때도 파일을 불러올 때와 같은 검증을 거친다.

import { parseSavedFile, type SavedFile } from "./edit.ts";

export const VERSIONS_KEY = "cmg:versions:v1";
export const MAX_VERSIONS = 20;
export const MAX_VERSION_NAME = 40;

export interface Version {
  name: string;
  /** 저장한 때 (ms) */
  at: number;
  file: SavedFile;
}

type Store = Pick<Storage, "getItem" | "setItem">;

/** 판 이름을 다듬는다 (앞뒤 공백·줄바꿈 제거, 길이 제한). 비면 undefined. */
export function cleanVersionName(name: string): string | undefined {
  const s = name.replace(/\s+/g, " ").trim().slice(0, MAX_VERSION_NAME);
  return s || undefined;
}

/** 저장된 판 목록 (최근 것이 앞). 깨진 항목은 건너뛴다. */
export function readVersions(store: Store): Version[] {
  let raw: unknown;
  try {
    raw = JSON.parse(store.getItem(VERSIONS_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Version[] = [];
  for (const v of raw.slice(0, MAX_VERSIONS)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const name = typeof o.name === "string" ? cleanVersionName(o.name) : undefined;
    const at = typeof o.at === "number" && Number.isFinite(o.at) ? o.at : 0;
    if (!name) continue;
    try {
      out.push({ name, at, file: parseSavedFile(o.file) });
    } catch {
      // 형식이 바뀌었거나 손상된 항목
    }
  }
  return out;
}

/** 목록을 저장한다. 저장 공간이 모자라면 예외를 그대로 던진다. */
export function writeVersions(store: Store, list: readonly Version[]): void {
  store.setItem(VERSIONS_KEY, JSON.stringify(list.slice(0, MAX_VERSIONS)));
}

/**
 * 판을 맨 앞에 더한 새 목록. 같은 이름이 있으면 그 판을 바꾼다.
 * 개수가 넘치면 가장 오래된 판부터 뺀다.
 */
export function addVersion(list: readonly Version[], name: string, file: SavedFile, now: number): { list: Version[]; replaced: boolean; dropped?: string } {
  const clean = cleanVersionName(name);
  if (!clean) throw new Error("판 이름을 적어 주세요.");
  const replaced = list.some((v) => v.name === clean);
  const rest = list.filter((v) => v.name !== clean);
  const next = [{ name: clean, at: now, file }, ...rest];
  const dropped = next.length > MAX_VERSIONS ? next[next.length - 1].name : undefined;
  return { list: next.slice(0, MAX_VERSIONS), replaced, dropped };
}

export function removeVersion(list: readonly Version[], name: string): Version[] {
  return list.filter((v) => v.name !== name);
}

/** 같은 이름이 없도록 기본 이름을 만든다 ("가람대학교 1", "가람대학교 2" …) */
export function suggestVersionName(list: readonly Version[], base: string): string {
  const stem = (cleanVersionName(base) ?? "판").slice(0, MAX_VERSION_NAME - 4);
  const names = new Set(list.map((v) => v.name));
  for (let i = 1; ; i++) {
    const n = `${stem} ${i}`;
    if (!names.has(n)) return n;
  }
}
