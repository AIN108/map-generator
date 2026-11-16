// 내보내기·불러오기 단추: 조감도·배치도 PNG/SVG, JSON 저장·불러오기, 설정 글 내보내기 (main.ts에서 옮김)

import type { DrawList } from "../drawlist.ts";
import { parseSavedFileText, type SavedFile } from "../edit.ts";
import { layoutToProse } from "../export.ts";
import type { Layout } from "../layout.ts";
import { eul } from "../names.ts";
import { paint, type Layers } from "../paint.ts";
import type { Scene } from "../scene.ts";
import { drawSitePlan, SITEPLAN_DEFAULTS } from "../siteplan.ts";
import { asCanvas, SvgContext } from "../svg.ts";
import type { WalkGrid } from "../walk.ts";
import { $, download, safeFileName } from "./dom.ts";

export interface ExportHost {
  /** 조감도 크기 (그리기 좌표) */
  width: number;
  height: number;
  drawList(): DrawList | undefined;
  scene(): Scene | undefined;
  layout(): Layout | undefined;
  /** 파일 이름에 쓸 시드 (배치가 없을 때) */
  seed(): string;
  layers(): Layers;
  frame(): { name: string; nameEn: string };
  /** 지금 상태의 저장 파일 (배치가 있을 때만 부른다) */
  savedFile(layout: Layout): SavedFile;
  edited(): boolean;
  /** 도보 격자 (없으면 만들어 둔다) */
  walkGrid(scene: Scene): WalkGrid;
  /** 화면을 다시 그린다 */
  redraw(): void;
  /** 저장 파일의 상태로 바꾼다 */
  openSaved(file: SavedFile): void;
  status(message: string, error?: boolean): void;
}

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function createExportPanel(host: ExportHost): void {
  const W = host.width, H = host.height;
  const setStatus = (m: string, e = false): void => host.status(m, e);

  /** 내보내기 형식·배율 */
  const exportChoice = (): { svg: boolean; k: number } => ({
    svg: $<HTMLSelectElement>("exportFormat").value === "svg",
    k: Math.max(1, Math.min(2, Number($<HTMLSelectElement>("exportScale").value) || 1)),
  });
  const kb = (n: number): string => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`);
  /** 큰 캔버스는 메모리가 모자라 못 만들 수 있다 */
  function pngFrom(width: number, height: number, draw2d: (c: CanvasRenderingContext2D) => void, name: string, label: string): void {
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const c = out.getContext("2d");
    if (!c) { setStatus("이 크기의 그림을 만들 수 없습니다. 크기를 줄여 보세요.", true); return; }
    draw2d(c);
    out.toBlob((blob) => {
      if (!blob) { setStatus("그림을 만들지 못했습니다 (메모리 부족일 수 있습니다). 크기를 줄여 보세요.", true); return; }
      download(name, blob);
      setStatus(`${label}${eul(label)} 저장했습니다 (${width}×${height}, ${kb(blob.size)}).`);
    }, "image/png");
  }
  $("exportPng").addEventListener("click", () => {
    const dl = host.drawList();
    if (!dl) return;
    const layout = host.layout();
    const { svg, k } = exportChoice();
    const base = `${safeFileName(layout?.name ?? host.seed())}_조감도`;
    if (svg) {
      const s = new SvgContext(W, H);
      paint(asCanvas(s), dl, { scale: 1, x: 0, y: 0, ratio: 1, textScale: 1 }, host.layers(), host.frame(), "all");
      const blob = new Blob([s.toString()], { type: "image/svg+xml" });
      download(`${base}.svg`, blob);
      setStatus(`조감도를 SVG로 저장했습니다 (${kb(blob.size)}). 나무가 많아 파일이 큽니다. 글꼴(Noto Sans KR)이 없는 프로그램에서는 다른 글꼴로 보입니다.`);
    } else {
      // 보고 있는 화면과 관계없이 전체를 그린다 (기본 2배 = 3200×2400)
      const r = 2 * k;
      pngFrom(Math.round(W * r), Math.round(H * r), (c) => paint(c, dl, { scale: 1, x: 0, y: 0, ratio: r, textScale: 1 }, host.layers(), host.frame(), "all"), `${base}.png`, "조감도");
    }
    // 라벨 클릭 판정이 내보내기용 배치로 덮이지 않게 화면을 다시 그린다.
    host.redraw();
  });
  $("exportPlan").addEventListener("click", () => {
    const scene = host.scene(), layout = host.layout();
    if (!scene || !layout) return;
    const o = SITEPLAN_DEFAULTS;
    const { svg, k } = exportChoice();
    const base = `${safeFileName(layout?.name ?? host.seed())}_배치도`;
    const sc = scene;
    if (svg) {
      const s = new SvgContext(o.width, o.height);
      drawSitePlan(asCanvas(s), sc, o);
      const blob = new Blob([s.toString()], { type: "image/svg+xml" });
      download(`${base}.svg`, blob);
      setStatus(`배치도를 SVG로 저장했습니다 (${kb(blob.size)}, 격자 ${o.grid} m · 큰 칸 ${o.grid * o.major} m).`);
    } else {
      pngFrom(Math.round(o.width * k), Math.round(o.height * k), (c) => { c.setTransform(k, 0, 0, k, 0, 0); drawSitePlan(c, sc, o); }, `${base}.png`, "배치도");
    }
  });
  $("exportJson").addEventListener("click", () => {
    const layout = host.layout();
    if (!layout) return;
    const file = host.savedFile(layout);
    download(`${safeFileName(layout.name)}${host.edited() ? "_편집" : ""}.json`, new Blob([JSON.stringify(file)], { type: "application/json" }));
  });
  $("importJson").addEventListener("click", () => $<HTMLInputElement>("importFile").click());
  $("exportProse").addEventListener("click", () => {
    const layout = host.layout(), scene = host.scene();
    if (!layout || !scene) return;
    const r = layoutToProse(layout, scene, host.walkGrid(scene));
    download(safeFileName(r.fileName.replace(/\.md$/, "")) + ".md", new Blob([r.text], { type: "text/markdown" }));
    setStatus("지금 배치를 설정 글(마크다운)로 저장했습니다. '파일 불러오기'로 다시 읽을 수 있습니다.");
  });
  $<HTMLInputElement>("importFile").addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    (async () => {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("파일이 너무 큽니다 (5MB 이하만 불러올 수 있습니다).");
      const parsed = parseSavedFileText(await file.text());
      // 저장 안 한 편집이 있으면 먼저 묻는다 (파일을 다 읽은 뒤라, 깨진 파일이면 묻지 않고 오류만 알린다).
      if (host.edited() && !window.confirm(`${file.name}${eul(file.name)} 불러오면 지금 편집한 배치가 사라집니다. 계속할까요?\n(필요하면 먼저 'JSON 저장'이나 '저장해 둔 판'으로 보관하세요.)`)) {
        setStatus("불러오기를 취소했습니다.");
        return;
      }
      host.openSaved(parsed);
      setStatus(`${file.name}${eul(file.name)} 불러왔습니다.${parsed.options.program ? " (건물 목록 포함)" : ""}`);
    })().catch((err) => setStatus(err instanceof Error ? err.message : String(err), true));
  });
}
