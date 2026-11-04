// 고른 건물의 평면도: 모눈 도면 위에 덩어리(층수별 농도)·치수선·방위표·축척 막대를 그리고,
// 손잡이를 끌어 크기·날개를 바꾸거나 자유형 칸을 칠한다. 작은 창(정보 창 안)과 큰 창(대화 상자)이 같은 편집기를 쓴다.

import {
  paintCells, setForm, setGridSize, SHAPE_KO, toCustom, type EditResult,
} from "./edit.ts";
import { CELL_MAX_FLOORS, FORM_SPEC, resolveForm, type RatioSpec } from "./form.ts";
import type { Building, Layout } from "./layout.ts";
import { FLOOR_H, grossArea, planMasses, type PlanMass } from "./model.ts";
import { cellAt, dragHandle, facingText, niceStep, planFit, planHandles, type Handle, type PlanFit } from "./plan.ts";

export interface PlanHost {
  /** 지금 고른 건물 (하나만 골랐고 광장·운동장이 아닐 때) */
  building(): Building | undefined;
  /** 번호 (없으면 undefined) */
  numberOf(id: number): number | undefined;
  apply(edit: (l: Layout) => EditResult, mergeKey?: string): boolean;
  /** 폭·깊이 바꾸기 (자리 검사는 호스트가 한다) */
  resize(id: number, w: number, d: number): void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 요소가 없습니다.`);
  return el as T;
};

interface Colors { paper: string; grid: string; major: string; ink: string; dim: string; lo: string; hi: string; glass: string; accent: string; empty: string }

function readColors(el: HTMLElement): Colors {
  const cs = getComputedStyle(el);
  const v = (k: string, d: string): string => cs.getPropertyValue(k).trim() || d;
  return {
    paper: v("--plan-paper", "#f7f9fb"), grid: v("--plan-grid", "#e2e9f0"), major: v("--plan-major", "#c9d6e2"),
    ink: v("--plan-ink", "#1b2a5c"), dim: v("--plan-dim", "#3d6f9e"), lo: v("--plan-lo", "#e4ecf4"), hi: v("--plan-hi", "#8ea8c3"),
    glass: v("--plan-glass", "#bfe0ec"), accent: v("--plan-accent", "#d9822b"), empty: v("--plan-empty", "rgba(61,111,158,0.08)"),
  };
}

/** "#rrggbb" 두 색 사이 */
function mix(a: string, b: string, t: number): string {
  const p = (c: string): number[] => {
    const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
    if (!m) return [128, 128, 128];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const x = p(a), y = p(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
}

/** 덩어리 안쪽의 글자 자리: 가운데에 가장 가까운 안쪽 점 (ㅁ자는 가운데가 비어 있다) */
function labelPoint(m: PlanMass): [number, number] {
  const inside = (p: [number, number], r: [number, number][]): boolean => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [u, v] of m.outer) { x0 = Math.min(x0, u); y0 = Math.min(y0, v); x1 = Math.max(x1, u); y1 = Math.max(y1, v); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let best: [number, number] = [cx, cy], bestD = Infinity;
  const N = 9;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const p: [number, number] = [x0 + ((i + 0.5) / N) * (x1 - x0), y0 + ((j + 0.5) / N) * (y1 - y0)];
      if (!inside(p, m.outer) || m.holes.some((h) => inside(p, h))) continue;
      const d = Math.hypot(p[0] - cx, p[1] - cy);
      if (d < bestD) { bestD = d; best = p; }
    }
  }
  return best;
}

const fmt1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);
const fmtArea = (v: number): string => `${Math.round(v / 10) * 10 > 0 ? (Math.round(v / 10) * 10).toLocaleString("ko-KR") : Math.round(v)} m²`;

export function createPlanView(host: PlanHost): { sync(): void } {
  const editor = $("planEditor");
  const canvas = $<HTMLCanvasElement>("planCanvas");
  const ctx = canvas.getContext("2d")!;
  const dialog = $<HTMLDialogElement>("planDialog");
  const home = editor.parentElement!;
  const homeNext = editor.nextSibling;
  const cellFloors = $<HTMLInputElement>("cellFloors");
  const cellErase = $<HTMLButtonElement>("cellErase");
  const gridCols = $<HTMLInputElement>("gridCols"), gridRows = $<HTMLInputElement>("gridRows");

  let fit: PlanFit = { s: 1, ox: 0, oy: 0 };
  let hoverHandle: Handle | undefined;
  let hoverCell: number | undefined;
  /** 끄는 동안 보여 줄 임시 건물과 손잡이 길이 */
  let preview: { b: Building; handle?: Handle; meters?: number } | undefined;
  let drag: { kind: "handle"; handle: Handle; base: Building; fit: PlanFit } | { kind: "paint"; value: number; changes: Map<number, number> } | undefined;
  let erasing = false;

  const MARGIN = (): number => (editor.classList.contains("large") ? 64 : 40);

  function size(): { cw: number; ch: number } {
    const r = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const cw = Math.max(120, Math.round(r.width)), ch = Math.max(120, Math.round(r.height));
    if (canvas.width !== Math.round(cw * ratio) || canvas.height !== Math.round(ch * ratio)) {
      canvas.width = Math.round(cw * ratio);
      canvas.height = Math.round(ch * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { cw, ch };
  }

  const toLocal = (e: { clientX: number; clientY: number }, f = fit): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left - f.ox) / f.s, (e.clientY - r.top - f.oy) / f.s];
  };
  const toScreen = (u: number, v: number, f = fit): [number, number] => [f.ox + u * f.s, f.oy + v * f.s];

  // ── 그리기 ──────────────────────────────────────────────────────────
  function draw(): void {
    const real = host.building();
    if (!real || editor.hidden) return;
    const b = preview?.b ?? real;
    const { cw, ch } = size();
    const c = readColors(editor);
    const large = editor.classList.contains("large");
    if (drag?.kind !== "handle") fit = planFit(b.w, b.d, cw, ch, MARGIN());
    else fit = drag.fit;
    const { s, ox, oy } = fit;
    const hw = b.w / 2, hd = b.d / 2;

    // 모눈
    ctx.fillStyle = c.paper;
    ctx.fillRect(0, 0, cw, ch);
    const minor = niceStep(s, large ? 10 : 8), major = minor * 5;
    for (const [step, color] of [[minor, c.grid], [major, c.major]] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const u0 = Math.floor(-ox / s / step) * step, u1 = (cw - ox) / s;
      for (let u = u0; u <= u1; u += step) { const x = Math.round(ox + u * s) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, ch); }
      const v0 = Math.floor(-oy / s / step) * step, v1 = (ch - oy) / s;
      for (let v = v0; v <= v1; v += step) { const y = Math.round(oy + v * s) + 0.5; ctx.moveTo(0, y); ctx.lineTo(cw, y); }
      ctx.stroke();
    }

    // 바닥 상자 (자리 검사에 쓰는 테두리)
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = c.dim;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - hw * s, oy - hd * s, b.w * s, b.d * s);
    ctx.setLineDash([]);

    // 덩어리: 낮은 것부터, 층수가 높을수록 진하게
    const masses = planMasses(b).sort((p, q) => p.z0 - q.z0 || p.z1 - q.z1);
    const top = Math.max(1, ...masses.map((m) => m.floors));
    const path = (m: PlanMass): void => {
      ctx.beginPath();
      for (const ring of [m.outer, ...m.holes]) {
        ring.forEach(([u, v], k) => { const [x, y] = toScreen(u, v); if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.closePath();
      }
    };
    const grid = b.shape === "custom" ? b.form?.grid : undefined;
    if (grid) {
      // 빈칸도 옅게 보여 준다 (칠할 수 있는 자리)
      const cwm = b.w / grid.cols, chm = b.d / grid.rows;
      for (let j = 0; j < grid.rows; j++) {
        for (let i = 0; i < grid.cols; i++) {
          const v = grid.cells[j * grid.cols + i];
          const [x, y] = toScreen(-hw + i * cwm, -hd + j * chm);
          ctx.fillStyle = v > 0 ? mix(c.lo, c.hi, Math.min(1, v / Math.max(top, 1))) : c.empty;
          ctx.fillRect(x, y, cwm * s + 0.5, chm * s + 0.5);
        }
      }
    } else {
      for (const m of masses) {
        path(m);
        ctx.fillStyle = m.glass ? c.glass : mix(c.lo, c.hi, Math.min(1, m.floors / top));
        ctx.fill("evenodd");
      }
    }
    for (const m of masses) {
      path(m);
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = m.z0 === 0 ? 1.8 : 1;
      if (m.z0 > 0) ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (grid) {
      const cwm = b.w / grid.cols, chm = b.d / grid.rows;
      ctx.strokeStyle = c.major;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < grid.cols; i++) { const [x] = toScreen(-hw + i * cwm, 0); ctx.moveTo(x, oy - hd * s); ctx.lineTo(x, oy + hd * s); }
      for (let j = 1; j < grid.rows; j++) { const [, y] = toScreen(0, -hd + j * chm); ctx.moveTo(ox - hw * s, y); ctx.lineTo(ox + hw * s, y); }
      ctx.stroke();
      if (cwm * s >= 15 && chm * s >= 13) {
        ctx.font = `${Math.min(13, Math.floor(Math.min(cwm, chm) * s * 0.45))}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let j = 0; j < grid.rows; j++) {
          for (let i = 0; i < grid.cols; i++) {
            const v = grid.cells[j * grid.cols + i];
            if (!v) continue;
            const [x, y] = toScreen(-hw + (i + 0.5) * cwm, -hd + (j + 0.5) * chm);
            ctx.fillStyle = v / top > 0.6 ? c.paper : c.ink;
            ctx.fillText(String(v), x, y);
          }
        }
      }
      if (hoverCell !== undefined && !drag) {
        const i = hoverCell % grid.cols, j = Math.floor(hoverCell / grid.cols);
        const [x, y] = toScreen(-hw + i * cwm, -hd + j * chm);
        ctx.strokeStyle = c.accent;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, cwm * s - 2, chm * s - 2);
      }
    } else {
      // 덩어리 층수 표시 (윗덩어리 가운데)
      ctx.font = "10.5px ui-monospace, Menlo, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const shown: [number, number][] = [];
      for (const m of [...masses].reverse()) {
        const [x, y] = toScreen(...labelPoint(m));
        if (shown.some(([px, py]) => Math.abs(px - x) < 26 && Math.abs(py - y) < 14)) continue;
        shown.push([x, y]);
        ctx.fillStyle = m.floors / top > 0.6 && !m.glass ? c.paper : c.ink;
        ctx.fillText(`${m.floors}F`, x, y);
      }
    }

    // 치수선: 위(폭), 왼쪽(깊이)
    ctx.strokeStyle = c.dim;
    ctx.fillStyle = c.dim;
    ctx.lineWidth = 1;
    const tick = (x: number, y: number): void => { ctx.moveTo(x - 3.5, y + 3.5); ctx.lineTo(x + 3.5, y - 3.5); };
    const topY = oy - hd * s - (large ? 22 : 16), leftX = ox - hw * s - (large ? 22 : 16);
    ctx.beginPath();
    ctx.moveTo(ox - hw * s, oy - hd * s - 3); ctx.lineTo(ox - hw * s, topY - 4);
    ctx.moveTo(ox + hw * s, oy - hd * s - 3); ctx.lineTo(ox + hw * s, topY - 4);
    ctx.moveTo(ox - hw * s - 4, topY); ctx.lineTo(ox + hw * s + 4, topY);
    tick(ox - hw * s, topY); tick(ox + hw * s, topY);
    ctx.moveTo(ox - hw * s - 3, oy - hd * s); ctx.lineTo(leftX - 4, oy - hd * s);
    ctx.moveTo(ox - hw * s - 3, oy + hd * s); ctx.lineTo(leftX - 4, oy + hd * s);
    ctx.moveTo(leftX, oy - hd * s - 4); ctx.lineTo(leftX, oy + hd * s + 4);
    tick(leftX, oy - hd * s); tick(leftX, oy + hd * s);
    ctx.stroke();
    ctx.font = `${large ? 12 : 10.5}px ui-monospace, Menlo, Consolas, monospace`;
    const label = (text: string, x: number, y: number, rot: number): void => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const tw = ctx.measureText(text).width + 6;
      ctx.fillStyle = c.paper;
      ctx.fillRect(-tw / 2, -7, tw, 13);
      ctx.fillStyle = c.dim;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    label(fmt1(b.w), ox, topY, 0);
    label(fmt1(b.d), leftX, oy, -Math.PI / 2);

    // 정면 표시
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    const fy = oy + hd * s + 6;
    ctx.moveTo(ox - 5, fy); ctx.lineTo(ox + 5, fy); ctx.lineTo(ox, fy + 6); ctx.closePath();
    ctx.fill();
    ctx.font = "10px 'Noto Sans KR', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("정면", ox, fy + 7);

    // 방위표: 평면도는 건물 기준으로 그리므로 북쪽이 돈다
    const nx = cw - 26, ny = 27, a = real.angle;
    const du = -Math.sin(a), dv = -Math.cos(a);
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(nx, ny, 12, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(nx + du * 11, ny + dv * 11);
    ctx.lineTo(nx - dv * 4 - du * 4, ny + du * 4 - dv * 4);
    ctx.lineTo(nx + dv * 4 - du * 4, ny - du * 4 - dv * 4);
    ctx.closePath();
    ctx.fillStyle = c.ink;
    ctx.fill();
    ctx.font = "bold 9.5px ui-monospace, Menlo, Consolas, monospace";
    ctx.textBaseline = "middle";
    ctx.fillText("N", nx + du * 19, ny + dv * 19);

    // 축척 막대
    const len = niceStep(s, large ? 70 : 46);
    const bx = 10, by = ch - 12, bw = len * s;
    ctx.fillStyle = c.ink;
    ctx.fillRect(bx, by - 3, bw / 2, 4);
    ctx.strokeStyle = c.ink;
    ctx.strokeRect(bx + 0.5, by - 2.5, bw, 4);
    ctx.font = "9.5px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`0`, bx, by - 5);
    ctx.textAlign = "right";
    ctx.fillText(`${len} m`, bx + bw, by - 5);

    // 손잡이
    for (const h of planHandles(b)) {
      const [x, y] = toScreen(h.u, h.v);
      const hot = (drag?.kind === "handle" && drag.handle.key === h.key) || (!drag && hoverHandle?.key === h.key);
      const r = hot ? 5.5 : 4;
      ctx.fillStyle = h.key === "w" || h.key === "d" ? c.paper : c.accent;
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (h.key === "w" || h.key === "d") ctx.rect(x - r, y - r, r * 2, r * 2); else ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (preview?.handle && preview.meters !== undefined) {
      const [x, y] = toScreen(preview.handle.u, preview.handle.v);
      const text = `${preview.handle.label} ${fmt1(preview.meters)} m`;
      ctx.font = "bold 11px 'Noto Sans KR', system-ui, sans-serif";
      const tw = ctx.measureText(text).width + 10;
      const tx = Math.min(cw - tw - 4, Math.max(4, x + 10)), ty = Math.max(4, y - 24);
      ctx.fillStyle = c.accent;
      ctx.fillRect(tx, ty, tw, 18);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(text, tx + 5, ty + 9);
    }
  }

  // ── 표제란 ──────────────────────────────────────────────────────────
  function renderSpec(b: Building): void {
    const masses = planMasses(b);
    const ground = masses.filter((m) => m.z0 === 0).reduce((t, m) => {
      const a = (r: [number, number][]): number => {
        let s = 0;
        for (let k = 0; k < r.length; k++) { const p = r[k], q = r[(k + 1) % r.length]; s += p[0] * q[1] - q[0] * p[1]; }
        return Math.abs(s / 2);
      };
      return t + a(m.outer) - m.holes.reduce((h, r) => h + a(r), 0);
    }, 0);
    const deg = Math.round((((b.angle * 180) / Math.PI) % 360 + 360) % 360);
    const rows: [string, string][] = [
      ["모양", SHAPE_KO[b.shape]],
      ["규모", `지상 ${b.floors}층 · 높이 ${Math.round(b.floors * FLOOR_H)} m`],
      ["바닥 상자", `${fmt1(b.w)} × ${fmt1(b.d)} m`],
      ["건축면적", fmtArea(ground)],
      ["연면적", fmtArea(grossArea(b))],
      ["정면", `${facingText(b.angle)} (${deg}°)`],
    ];
    const table = $("planSpec");
    table.replaceChildren(...rows.map(([k, v]) => {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = k;
      const td = document.createElement("td");
      td.textContent = v;
      tr.append(th, td);
      return tr;
    }));
    const no = host.numberOf(b.id);
    $("planSheet").textContent = `A-${no ? String(no).padStart(2, "0") : "00"}`;
    $("planDialogTitle").textContent = `${no ? `${no}번 ` : ""}${b.name} 평면도`;
  }

  // ── 모양 조절 칸 ────────────────────────────────────────────────────
  const ratioField = (key: "wing" | "depth", rs: RatioSpec | undefined, b: Building, value: number): void => {
    const field = $(key === "wing" ? "formWingField" : "formDepthField");
    field.hidden = !rs;
    if (!rs) return;
    const input = $<HTMLInputElement>(key === "wing" ? "formWing" : "formDepth");
    input.min = String(rs.lo);
    input.max = String(rs.hi);
    input.step = "0.01";
    if (document.activeElement !== input) input.value = String(value);
    $(key === "wing" ? "formWingLabel" : "formDepthLabel").textContent = rs.label;
    const base = rs.base === "w" ? b.w : rs.base === "d" ? b.d : Math.min(b.w, b.d);
    $(key === "wing" ? "formWingOut" : "formDepthOut").textContent = `${fmt1(Number(input.value) * base)} m`;
  };

  function syncControls(b: Building): void {
    const spec = FORM_SPEC[b.shape];
    const f = resolveForm(b);
    const custom = b.shape === "custom";
    $("planCells").hidden = !custom;
    $("planForm").hidden = false;
    ratioField("wing", spec?.wing, b, f.wing);
    ratioField("depth", spec?.depth, b, f.depth);
    $("formPodiumField").hidden = !spec?.podium || b.floors < 2;
    if (spec?.podium) {
      const p = $<HTMLInputElement>("formPodium");
      p.max = String(Math.max(1, b.floors - 1));
      if (document.activeElement !== p) p.value = String(f.podium);
      $("formPodiumOut").textContent = `${p.value}층`;
    }
    $("formFlipField").hidden = !spec?.flip;
    $<HTMLInputElement>("formFlip").checked = f.flip;
    $("formRoofField").hidden = !spec?.roof && !custom;
    $<HTMLSelectElement>("formRoof").disabled = custom;
    $<HTMLSelectElement>("formRoof").value = custom ? "flat" : f.roof ?? "";
    const tunable = !!(spec?.wing || spec?.depth || spec?.podium || spec?.flip || spec?.roof);
    $<HTMLButtonElement>("formReset").hidden = custom || !tunable;
    $<HTMLButtonElement>("formReset").disabled = !b.form || (Object.keys(b.form).length === 0);
    $<HTMLButtonElement>("formCustom").hidden = custom;
    if (custom && b.form?.grid) {
      if (document.activeElement !== gridCols) gridCols.value = String(b.form.grid.cols);
      if (document.activeElement !== gridRows) gridRows.value = String(b.form.grid.rows);
      $("planCellSize").textContent = `칸 ${fmt1(b.w / b.form.grid.cols)}×${fmt1(b.d / b.form.grid.rows)} m`;
    }
    $("planHint").textContent = custom
      ? "칸을 누르거나 끌어 붓 층수로 칠합니다. 같은 층수 칸을 누르거나 오른쪽 버튼·지우개면 비웁니다."
      : spec?.wing || spec?.depth
        ? "네모 손잡이로 폭·깊이를, 동그라미 손잡이로 날개·동 크기를 끌어 바꿉니다."
        : "네모 손잡이로 폭·깊이를 끌어 바꿉니다. '칸으로 고치기'로 평면을 직접 칠할 수 있습니다.";
  }

  function sync(): void {
    const b = host.building();
    editor.hidden = !b;
    if (!b) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!drag) preview = undefined;
    syncControls(b);
    renderSpec(b);
    draw();
  }

  // ── 끌기·칠하기 ────────────────────────────────────────────────────
  const handleAt = (b: Building, e: PointerEvent): Handle | undefined => {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    let best: Handle | undefined, bestD = 9;
    for (const h of planHandles(b)) {
      const [x, y] = toScreen(h.u, h.v);
      const d = Math.hypot(x - px, y - py);
      if (d < bestD) { best = h; bestD = d; }
    }
    return best;
  };

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    const b = host.building();
    if (!b) return;
    e.preventDefault();
    const h = handleAt(b, e);
    if (h) {
      drag = { kind: "handle", handle: h, base: { ...b, form: b.form ? { ...b.form } : undefined }, fit: { ...fit } };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    const [u, v] = toLocal(e);
    const k = cellAt(b, u, v);
    const g = b.form?.grid;
    if (k === undefined || !g) return;
    const brush = Math.max(1, Math.min(CELL_MAX_FLOORS, Math.round(Number(cellFloors.value) || 1)));
    const value = erasing || e.button === 2 || g.cells[k] === brush ? 0 : brush;
    drag = { kind: "paint", value, changes: new Map([[k, value]]) };
    preview = { b: withCells(b, drag.changes) };
    canvas.setPointerCapture(e.pointerId);
    draw();
  });
  const withCells = (b: Building, changes: Map<number, number>): Building => {
    const g = b.form!.grid!;
    const cells = [...g.cells];
    for (const [k, v] of changes) cells[k] = v;
    return { ...b, form: { ...b.form, grid: { ...g, cells } }, floors: Math.max(1, ...cells) };
  };
  canvas.addEventListener("pointermove", (e) => {
    const b = host.building();
    if (!b) return;
    if (drag?.kind === "handle") {
      const hd = drag;
      const [u, v] = toLocal(e, hd.fit);
      const r = dragHandle(hd.base, hd.handle.key, u, v);
      const pb: Building = { ...hd.base, w: r.w ?? hd.base.w, d: r.d ?? hd.base.d };
      if (r.form) pb.form = { ...(hd.base.form ?? {}), ...r.form };
      const moved = planHandles(pb).find((h) => h.key === hd.handle.key) ?? hd.handle;
      preview = { b: pb, handle: moved, meters: r.meters };
      draw();
      return;
    }
    if (drag?.kind === "paint") {
      const [u, v] = toLocal(e);
      const k = cellAt(b, u, v);
      if (k !== undefined && drag.changes.get(k) !== drag.value) {
        drag.changes.set(k, drag.value);
        preview = { b: withCells(b, drag.changes) };
        draw();
      }
      return;
    }
    const h = handleAt(b, e);
    const [u, v] = toLocal(e);
    const k = h ? undefined : cellAt(b, u, v);
    canvas.style.cursor = h ? (h.axis === "u" ? "ew-resize" : "ns-resize") : k !== undefined ? "crosshair" : "default";
    if (h?.key !== hoverHandle?.key || k !== hoverCell) {
      hoverHandle = h;
      hoverCell = k;
      draw();
    }
  });
  const finish = (commit: boolean): void => {
    const b = host.building();
    const d = drag;
    drag = undefined;
    const p = preview;
    preview = undefined;
    if (!b || !d || !commit) { draw(); return; }
    if (d.kind === "handle") {
      if (!p) { draw(); return; }
      if (d.handle.key === "w" || d.handle.key === "d") {
        if (p.b.w !== b.w || p.b.d !== b.d) host.resize(b.id, p.b.w, p.b.d); else draw();
      } else {
        const key = d.handle.key;
        const value = p.b.form?.[key];
        if (value !== undefined && value !== b.form?.[key]) host.apply((l) => setForm(l, b.id, { [key]: value }));
        else draw();
      }
      return;
    }
    const changes = [...d.changes].filter(([k, v]) => b.form?.grid?.cells[k] !== v);
    if (changes.length) host.apply((l) => paintCells(l, b.id, changes)); else draw();
  };
  canvas.addEventListener("pointerup", () => finish(true));
  canvas.addEventListener("pointercancel", () => finish(false));
  canvas.addEventListener("pointerleave", () => {
    if (!drag && (hoverHandle || hoverCell !== undefined)) { hoverHandle = undefined; hoverCell = undefined; draw(); }
  });

  // ── 조절 칸 이벤트 ─────────────────────────────────────────────────
  const current = (): Building | undefined => host.building();
  for (const key of ["wing", "depth"] as const) {
    const input = $<HTMLInputElement>(key === "wing" ? "formWing" : "formDepth");
    input.addEventListener("input", () => {
      const b = current();
      if (!b) return;
      const pb: Building = { ...b, form: { ...(b.form ?? {}), [key]: Number(input.value) } };
      preview = { b: pb };
      const rs = FORM_SPEC[b.shape]?.[key];
      if (rs) {
        const base = rs.base === "w" ? b.w : rs.base === "d" ? b.d : Math.min(b.w, b.d);
        $(key === "wing" ? "formWingOut" : "formDepthOut").textContent = `${fmt1(Number(input.value) * base)} m`;
      }
      draw();
    });
    input.addEventListener("change", () => {
      const b = current();
      preview = undefined;
      if (b) host.apply((l) => setForm(l, b.id, { [key]: Number(input.value) }), `form:${key}:${b.id}`);
    });
  }
  const podium = $<HTMLInputElement>("formPodium");
  podium.addEventListener("input", () => {
    const b = current();
    if (!b) return;
    $("formPodiumOut").textContent = `${podium.value}층`;
    preview = { b: { ...b, form: { ...(b.form ?? {}), podium: Number(podium.value) } } };
    draw();
  });
  podium.addEventListener("change", () => {
    const b = current();
    preview = undefined;
    if (b) host.apply((l) => setForm(l, b.id, { podium: Number(podium.value) }), `form:podium:${b.id}`);
  });
  $<HTMLInputElement>("formFlip").addEventListener("change", (e) => {
    const b = current();
    if (b) host.apply((l) => setForm(l, b.id, { flip: (e.target as HTMLInputElement).checked }));
  });
  $<HTMLSelectElement>("formRoof").addEventListener("change", (e) => {
    const b = current();
    const v = (e.target as HTMLSelectElement).value;
    if (b) host.apply((l) => setForm(l, b.id, { roof: v === "flat" || v === "hip" ? v : undefined }));
  });
  $("formReset").addEventListener("click", () => {
    const b = current();
    if (b) host.apply((l) => setForm(l, b.id, { wing: undefined, depth: undefined, podium: undefined, flip: undefined, roof: undefined }));
  });
  $("formCustom").addEventListener("click", () => {
    const b = current();
    if (b) host.apply((l) => toCustom(l, b.id));
  });
  cellErase.addEventListener("click", () => {
    erasing = !erasing;
    cellErase.setAttribute("aria-pressed", String(erasing));
  });
  const regrid = (): void => {
    const b = current();
    if (b) host.apply((l) => setGridSize(l, b.id, Number(gridCols.value), Number(gridRows.value)));
  };
  gridCols.addEventListener("change", regrid);
  gridRows.addEventListener("change", regrid);

  // ── 크게 보기 ──────────────────────────────────────────────────────
  $("planExpand").addEventListener("click", () => {
    if (dialog.open) { dialog.close(); return; }
    $("planDialogBody").append(editor);
    editor.classList.add("large");
    dialog.showModal();
    $("planExpand").textContent = "작게";
    requestAnimationFrame(draw);
  });
  dialog.addEventListener("close", () => {
    editor.classList.remove("large");
    home.insertBefore(editor, homeNext);
    $("planExpand").textContent = "크게";
    requestAnimationFrame(draw);
  });
  $("planClose").addEventListener("click", () => dialog.close());
  window.addEventListener("resize", () => draw());
  // 다크 모드가 바뀌면 색을 다시 읽는다
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => draw());

  return { sync };
}
