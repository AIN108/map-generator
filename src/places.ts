import { buildingType, LANDMARKS } from "./catalog.ts";
import { isPlace, numberMap, type Layout } from "./layout.ts";
import type { SearchPlace } from "./search.ts";

export const PLACE_CATEGORIES = [
  { value: "building", label: "건물" }, { value: "place", label: "야외 공간" },
  { value: "landmark", label: "상징물" }, { value: "note", label: "메모" },
] as const;

export interface CampusPlace extends SearchPlace {
  kind: "building" | "landmark" | "note";
  id: number;
  x: number;
  y: number;
}

/** 이름표·번호를 숨긴 시설도 찾을 수 있다. 번호는 지도 아래 안내 목록과 같다. */
export function campusPlaces(layout: Layout): CampusPlace[] {
  const numbers = numberMap(layout.buildings);
  return [
    ...layout.buildings.map((b): CampusPlace => ({
      key: `building:${b.id}`, kind: "building", id: b.id, category: isPlace(b) ? "place" : "building",
      name: b.name, number: numbers.get(b.id), x: b.x, y: b.y,
      detail: `${isPlace(b) ? "야외 공간" : `건물 · ${b.floors}층`} · ${buildingType(b.type)?.use ?? b.type}`,
    })),
    ...layout.landmarks.map((m): CampusPlace => ({
      key: `landmark:${m.id}`, kind: "landmark", id: m.id, category: "landmark",
      name: m.name, detail: `상징물 · ${LANDMARKS[m.kind].desc}`, x: m.x, y: m.y,
    })),
    ...(layout.notes ?? []).map((n): CampusPlace => ({
      key: `note:${n.id}`, kind: "note", id: n.id, category: "note",
      name: n.title, detail: "메모", keywords: n.text, x: n.x, y: n.y,
    })),
  ];
}
