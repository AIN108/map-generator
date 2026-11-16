// 편집 도구: 종류, 도구 안내 문구, 숫자 키 순서와 이름 (main.ts에서 옮김)

export type Tool = "select" | "addBuilding" | "addLandmark" | "erase" | "drawRoad" | "trees" | "note";
export const TOOL_HINTS: Record<Tool, string> = {
  note: "지도를 누르면 그 자리에 메모 핀을 꽂습니다. 핀을 누르면 정보 창에서 제목·내용·색을 고치고, 선택·이동 도구로 끌어 옮깁니다.",
  drawRoad: "누를 때마다 길에 점을 찍습니다. 두 번 누르거나 Enter로 끝내고, Backspace로 마지막 점을 지우고, Esc로 취소합니다. 지도는 끌어서 움직입니다.",
  trees: "누르거나 끌어서 칠한 곳에 나무를 심거나 벱니다. 지도는 Space를 누른 채 끌거나 오른쪽 버튼으로 움직입니다.",
  select: "건물·상징물을 끌어서 옮깁니다. 막힌 자리에 놓으면 가장 가까운 빈자리에 붙고, 초록 상자가 놓일 자리입니다. 빈 곳을 끌면 지도가 움직입니다. R로 돌리고 Delete로 지웁니다.",
  addBuilding: "누른 자리에 고른 건물을 놓습니다. 마우스를 올리면 놓일 자리가 초록 상자로 보입니다 (막혔으면 가까운 빈자리). 끌면 지도가 움직입니다.",
  addLandmark: "누른 자리에 고른 상징물을 놓습니다. 막혔으면 가까운 빈자리에 놓습니다.",
  erase: "누른 건물·상징물을 지웁니다(건물을 지우면 뒤 번호가 당겨짐). 건물이 없는 곳의 도로·산책로를 누르면 그 길을 지웁니다.",
};

/** 숫자 키 1~7의 도구 순서 (화면의 도구 목록 순서) */
export const TOOL_KEYS: Tool[] = ["select", "addBuilding", "addLandmark", "drawRoad", "trees", "note", "erase"];
export const TOOL_KO: Record<Tool, string> = {
  select: "선택·이동", addBuilding: "건물 추가", addLandmark: "상징물 추가", drawRoad: "길 그리기", trees: "나무", note: "메모 핀", erase: "지우기",
};
