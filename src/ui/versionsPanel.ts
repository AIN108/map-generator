// '저장해 둔 판' 칸: 지금 상태를 이름 붙여 이 브라우저에 저장하고, 골라 불러오거나 지운다.

import type { SavedFile } from "../edit.ts";
import { isPlace } from "../layout.ts";
import {
  addVersion, cleanVersionName, readVersions, removeVersion, suggestVersionName, type Version, VERSIONS_KEY, writeVersions,
} from "../versions.ts";
import { $, errorText } from "./dom.ts";

export interface VersionsHost {
  /** 지금 상태 (배치가 없으면 undefined) */
  current(): { file: SavedFile; layoutJSON: string; universityName: string } | undefined;
  /** 편집한 적이 있는가 */
  edited(): boolean;
  open(file: SavedFile): void;
  status(message: string, error?: boolean): void;
}

export interface VersionsPanel {
  /** 판을 하나 더한다 (링크를 열기 전 자동 보관 등). 저장했으면 true */
  add(name: string, file: SavedFile): boolean;
}

const dateText = (at: number): string => {
  const d = new Date(at);
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

export function createVersionsPanel(host: VersionsHost): VersionsPanel {
  const list = $<HTMLSelectElement>("versionList");
  const nameInput = $<HTMLInputElement>("versionName");
  let versions: Version[] = [];
  /** 마지막으로 저장하거나 불러온 판의 배치 (그 뒤로 고친 게 없으면 불러올 때 묻지 않는다) */
  let snapshot = "";
  const store = (): Storage | undefined => {
    try {
      return localStorage;
    } catch {
      return undefined;
    }
  };

  function render(keep?: string): void {
    const prev = keep ?? list.value;
    list.replaceChildren(...versions.map((v) => {
      const opt = document.createElement("option");
      opt.value = v.name;
      const n = v.file.layout.buildings.filter((b) => !isPlace(b)).length;
      opt.textContent = `${v.name} · ${dateText(v.at)} · ${n}동${v.file.options.program ? " · 목록" : ""}`;
      return opt;
    }));
    if (versions.some((v) => v.name === prev)) list.value = prev;
    $("versionCount").textContent = String(versions.length);
    syncButtons();
  }
  function syncButtons(): void {
    const has = versions.some((v) => v.name === list.value);
    $<HTMLButtonElement>("versionLoad").disabled = !has;
    $<HTMLButtonElement>("versionDelete").disabled = !has;
  }
  function load(): void {
    const s = store();
    versions = s ? readVersions(s) : [];
    render();
  }
  function save(next: Version[]): boolean {
    const s = store();
    if (!s) {
      host.status("이 브라우저에서는 저장 공간을 쓸 수 없습니다. 'JSON 저장'을 쓰세요.", true);
      return false;
    }
    try {
      writeVersions(s, next);
    } catch {
      host.status("브라우저 저장 공간이 모자랍니다. 쓰지 않는 판을 지우거나 'JSON 저장'을 쓰세요.", true);
      return false;
    }
    versions = next;
    return true;
  }

  $("versionSave").addEventListener("click", () => {
    const cur = host.current();
    if (!cur) return;
    const name = cleanVersionName(nameInput.value) ?? suggestVersionName(versions, cur.universityName);
    if (versions.some((v) => v.name === name) && !confirm(`'${name}' 판이 이미 있습니다. 지금 상태로 바꿀까요?`)) return;
    const r = addVersion(versions, name, cur.file, Date.now());
    if (!save(r.list)) return;
    nameInput.value = "";
    snapshot = cur.layoutJSON;
    render(name);
    host.status(`'${name}' 판을 ${r.replaced ? "새로 고쳐 " : ""}저장했습니다.${r.dropped ? ` (가장 오래된 '${r.dropped}' 판은 지웠습니다)` : ""}`);
  });
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("versionSave").click(); }
  });
  list.addEventListener("change", syncButtons);
  list.addEventListener("dblclick", () => $("versionLoad").click());
  $("versionLoad").addEventListener("click", () => {
    const v = versions.find((x) => x.name === list.value);
    if (!v) return;
    const unsaved = host.edited() && host.current()?.layoutJSON !== snapshot;
    if (unsaved && !confirm(`저장하지 않은 편집은 사라집니다. '${v.name}' 판을 불러올까요?`)) return;
    try {
      host.open(v.file);
      snapshot = host.current()?.layoutJSON ?? "";
      host.status(`'${v.name}' 판을 불러왔습니다.`);
    } catch (err) {
      host.status(errorText(err), true);
    }
  });
  $("versionDelete").addEventListener("click", () => {
    const name = list.value;
    if (!versions.some((v) => v.name === name) || !confirm(`'${name}' 판을 지울까요?`)) return;
    if (!save(removeVersion(versions, name))) return;
    render();
    host.status(`'${name}' 판을 지웠습니다.`);
  });
  // 다른 탭에서 저장한 판도 보이게
  window.addEventListener("storage", (e) => {
    if (e.key === VERSIONS_KEY) load();
  });
  load();

  return {
    add(name, file) {
      const clean = cleanVersionName(name);
      if (!clean || !save(addVersion(versions, clean, file, Date.now()).list)) return false;
      render();
      return true;
    },
  };
}
