// 지금 배치를 설정 글(마크다운)로 내보낸다. 위치·층수·외관·도보 시간을 문장으로 적어,
// 소설·TRPG 설정에 붙여 쓰거나 '파일 불러오기'로 다시 읽을 수 있게 한다 (추출기가 알아보는 문장 꼴).

import { buildingType, type Style } from "./catalog.ts";
import { isPlace, numberMap, type Building, type Layout } from "./layout.ts";
import { eun, iga } from "./names.ts";
import { DIR_KO, type Dir } from "./program.ts";
import { entrance, type Scene } from "./scene.ts";
import { placeFromPosition } from "./sync.ts";
import { minutesText, pathTo, walkField, type WalkGrid } from "./walk.ts";

/** 추출기가 외관을 다시 알아보는 말 */
const STYLE_WORD: Record<Style, string> = {
  brick: "붉은 벽돌", stone: "석재", glass: "유리 커튼월", classic: "고전풍 석조", modern: "밝은 석재와 유리를 쓴 현대식",
  concrete: "은회색 콘크리트", white: "흰색 패널",
};

const DIRS8: Dir[] = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"];
function dirFrom(dx: number, dy: number): Dir {
  const deg = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
  return DIRS8[Math.round(deg / 45) % 8];
}

/** 캠퍼스 기준 위치 말 (예: '캠퍼스 남동쪽 외곽', '캠퍼스 중앙 북동쪽') */
function campusPhrase(scene: Scene, x: number, y: number): string {
  const h = placeFromPosition(scene.site, x, y);
  if (!h) return "캠퍼스";
  if (!h.absDir) return "캠퍼스 중앙";
  const d = `${DIR_KO[h.absDir]}쪽`;
  return h.ring === "center" ? `캠퍼스 중앙 ${d}` : h.ring === "outer" ? `캠퍼스 ${d} 외곽` : `캠퍼스 ${d}`;
}

/** 가장 가까운 이웃 건물 기준 위치 말 (예: '중앙광장 남동쪽') */
function neighborPhrase(layout: Layout, b: { x: number; y: number; id?: number }, maxDist = 130): string | undefined {
  let best: Building | undefined, bestD = Infinity;
  for (const o of layout.buildings) {
    if (o.id === b.id || o.unlisted) continue;
    const d = Math.hypot(o.x - b.x, o.y - b.y) - Math.max(o.w, o.d) / 2;
    if (d < bestD) { bestD = d; best = o; }
  }
  if (!best || bestD > maxDist) return undefined;
  return `${best.name} ${DIR_KO[dirFrom(b.x - best.x, b.y - best.y)]}쪽`;
}

export interface ProseResult { text: string; fileName: string }

export function layoutToProse(layout: Layout, scene: Scene, grid: WalkGrid): ProseResult {
  const site = scene.site;
  const numbers = numberMap(layout.buildings);
  const listed = layout.buildings.filter((b) => numbers.has(b.id));
  const plaza = layout.buildings.find((b) => b.shape === "plaza");
  const admin = layout.buildings.find((b) => b.type === "admin");
  const gate: [number, number] = [0, site.gateS[1] - 4];
  const fromGate = walkField(grid, gate);
  const plazaPt: [number, number] | undefined = plaza ? [plaza.x, plaza.y] : undefined;
  const fromPlaza = plazaPt ? walkField(grid, plazaPt) : undefined;
  const target = (b: Building): [number, number] => (isPlace(b) ? [b.x, b.y] : entrance(b, 4));
  const walkText = (field: ReturnType<typeof walkField> | undefined, from: [number, number] | undefined, b: Building): string => {
    if (!field || !from || (from === plazaPt && b === plaza)) return "-";
    const p = pathTo(grid, field, target(b), from);
    return p ? `${Math.round(p.meters / 10) * 10}m · ${minutesText(p.minutes)}` : "-";
  };

  const out: string[] = [];
  out.push(`# ${layout.name} 캠퍼스 배치`, "");
  out.push("> 캠퍼스 조감도 생성기에서 내보낸 글입니다. 위치·층수·도보 시간은 지금 지도 기준입니다.", "");

  // ── 개요 ──
  out.push("## 캠퍼스 배치", "");
  const zoneOrder: (Dir | "C")[] = ["C", "N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const zones = new Map<Dir | "C", string[]>();
  for (const b of listed) {
    const h = placeFromPosition(site, b.x, b.y);
    const z: Dir | "C" = !h?.absDir || (h.ring === "center" && Math.hypot(b.x / site.rx, b.y / site.ry) < 0.22) ? "C" : h.absDir;
    if (!zones.has(z)) zones.set(z, []);
    zones.get(z)!.push(b.name);
  }
  const zoneText = zoneOrder.filter((z) => zones.has(z)).map((z) => {
    const names = zones.get(z)!.join("·");
    return z === "C" ? `캠퍼스 중앙에는 ${names}${iga(names)} 있다.` : `${DIR_KO[z]}쪽에는 ${names}${iga(names)} 있다.`;
  });
  out.push([
    `${layout.name}${eun(layout.name)} 동서 약 ${Math.round((site.rx * 2) / 10) * 10}m, 남북 약 ${Math.round((site.ry * 2) / 10) * 10}m 넓이의 캠퍼스다.`,
    "정문은 남쪽, 후문은 북쪽에 있고 외곽을 순환도로가 두른다.",
    ...zoneText,
  ].join(" "), "");
  out.push(`공식 시설은 ${listed.length}개다. 걸어서 가는 시간은 분속 80m 기준이다.`, "");
  out.push(`| 번호 | 시설 | 정문에서 | ${plaza ? `${plaza.name}에서` : "-"} |`, "|---|---|---|---|");
  for (const b of listed) out.push(`| ${numbers.get(b.id)} | ${b.name} | ${walkText(fromGate, gate, b)} | ${walkText(fromPlaza, plazaPt, b)} |`);
  out.push("");

  // ── 시설마다 ──
  for (const b of listed) {
    const no = numbers.get(b.id)!;
    out.push(`## ${String(no).padStart(2, "0")}. ${b.name}`, "");
    const t = buildingType(b.type);
    let loc: string;
    if (b === admin) loc = "캠퍼스 중앙";
    else if (b === plaza && admin) loc = `캠퍼스 중앙, ${admin.name} 바로 남쪽`;
    else {
      const near = neighborPhrase(layout, b);
      loc = near ? `${campusPhrase(scene, b.x, b.y)}, ${near}` : campusPhrase(scene, b.x, b.y);
    }
    const sents: string[] = [];
    if (b.shape === "plaza") sents.push(`${b.name}${eun(b.name)} ${loc}에 있는 넓은 야외 공간이다.`);
    else if (b.shape === "field") sents.push(`${b.name}${eun(b.name)} ${loc}에 있는 야외 운동장이다.`);
    else {
      sents.push(`${b.name}${eun(b.name)} ${loc}의 지상 ${b.floors}층 ${b.type === "admin" ? "고전풍 석조" : STYLE_WORD[b.style]} 건물이다.`);
      if (t) sents.push(`${t.use} 용도로 쓴다.`);
      sents.push(`바닥은 약 ${Math.round(b.w)}×${Math.round(b.d)}m다.`);
    }
    const g = walkText(fromGate, gate, b), p = plaza && b !== plaza ? walkText(fromPlaza, plazaPt, b) : "-";
    if (g !== "-") sents.push(`정문에서 걸어서 ${g.split(" · ")[1]}${p !== "-" ? `, ${plaza!.name}에서 ${p.split(" · ")[1]}` : ""} 걸린다.`);
    out.push(sents.join(" "), "");
    // 이름 붙인 호실
    const rooms = Object.entries(b.rooms ?? {}).sort((x, y) => Number(x[0]) - Number(y[0]));
    if (rooms.length) out.push(...rooms.map(([no, name]) => `- ${no}호: ${name}`), "");
  }
  // 번호 없는 시설
  for (const b of layout.buildings.filter((x) => x.unlisted)) {
    const near = neighborPhrase(layout, b, 200);
    out.push(`${b.name}${eun(b.name)} ${near ?? campusPhrase(scene, b.x, b.y)}에 있다. 공식 시설로 세지 않는다.`, "");
  }

  // ── 상징물 ──
  if (layout.landmarks.length) {
    out.push("## 상징물", "");
    const lines = layout.landmarks.map((m) => {
      const near = m.kind === "emblem" ? "정문 안쪽 진입광장" : neighborPhrase(layout, m, 160) ?? campusPhrase(scene, m.x, m.y);
      return `${near}에는 ‘${m.name}’${iga(m.name)} 있다.`;
    });
    out.push(lines.join(" "), "");
  }
  // ── 메모 ──
  if (layout.notes?.length) {
    out.push("## 메모", "");
    for (const n of layout.notes) {
      const near = neighborPhrase(layout, n, 120) ?? campusPhrase(scene, n.x, n.y);
      out.push(`- **${n.title}** (${near}): ${n.text ? n.text.replace(/\n+/g, " ") : "내용 없음"}`);
    }
    out.push("");
  }
  return { text: out.join("\n"), fileName: `${layout.name}_캠퍼스배치.md` };
}
