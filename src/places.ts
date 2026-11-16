import { buildingType, LANDMARKS } from "./catalog.ts";
import { isPlace, numberMap, type Layout } from "./layout.ts";
import { compareRoomNumbers, parseRoomNumber } from "./room-number.ts";
import type { SearchPlace } from "./search.ts";

export const PLACE_CATEGORIES = [
  { value: "building", label: "건물" }, { value: "place", label: "야외 공간" },
  { value: "landmark", label: "상징물" }, { value: "note", label: "메모" },
  { value: "room", label: "호실" },
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
    // 이름을 붙인 호실: 호실 이름으로 찾고, 고르면 그 건물을 고른다. 지금 층수보다 위층의 이름(외형을 바꾸기 전 것)은 뺀다.
    ...layout.buildings.flatMap((b) => Object.entries(b.rooms ?? {})
      .filter(([no]) => (parseRoomNumber(no)?.floor ?? Infinity) <= b.floors)
      .sort(([x], [y]) => compareRoomNumbers(x, y))
      .map(([no, title]): CampusPlace => ({
        key: `room:${b.id}:${no}`, kind: "building", id: b.id, category: "room",
        name: title, detail: `호실 · ${b.name} ${no}호 (${parseRoomNumber(no)!.floor}층)`, x: b.x, y: b.y,
      }))),
    ...(layout.notes ?? []).map((n): CampusPlace => ({
      key: `note:${n.id}`, kind: "note", id: n.id, category: "note",
      name: n.title, detail: "메모", keywords: n.text, x: n.x, y: n.y,
    })),
  ];
}
