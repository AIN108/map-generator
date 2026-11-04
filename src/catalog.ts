// 건물·장소·상징물 목록. 이름, 크기 범위, 모양, 외관, 선호 구역을 정한다.

export type Style = "brick" | "modern" | "glass" | "classic" | "concrete" | "stone" | "white";
export type Shape =
  | "bar" | "L" | "U" | "court" | "wings" | "atrium" | "stepped" | "twin" | "tower"
  | "gym" | "round" | "hospital" | "hall"
  /** 자유형: 칸마다 층수를 칠한 평면 */
  | "custom"
  | "plaza" | "field";

/** 구역: 캠퍼스 중심에서 본 방향(도, 동쪽 0·북쪽 90)과 반지름 비율로 선호 위치를 정한다. */
export type District =
  | "core" | "humanities" | "social" | "education" | "business" | "science" | "engineering" | "it"
  | "medical" | "arts" | "sports" | "dorm" | "dormEast" | "international" | "service";

export const DISTRICTS: Record<District, { angle: number; r: number }> = {
  core: { angle: 90, r: 0 },
  humanities: { angle: 172, r: 0.6 },
  social: { angle: 148, r: 0.58 },
  education: { angle: 128, r: 0.66 },
  business: { angle: 322, r: 0.5 },
  science: { angle: 32, r: 0.62 },
  engineering: { angle: 8, r: 0.72 },
  it: { angle: 350, r: 0.62 },
  medical: { angle: 312, r: 0.8 },
  arts: { angle: 238, r: 0.55 },
  sports: { angle: 212, r: 0.74 },
  dorm: { angle: 118, r: 0.8 },
  dormEast: { angle: 62, r: 0.84 },
  international: { angle: 84, r: 0.62 },
  service: { angle: 255, r: 0.42 },
};

export interface BuildingType {
  id: string;
  /** 표시 이름. '{U}'는 대학 이름으로 바뀐다. */
  name: string;
  /** 용도 설명 (정보 창) */
  use: string;
  district: District;
  w: [number, number];
  d: [number, number];
  floors: [number, number];
  shapes: Shape[];
  styles: Style[];
  /** 건물 수가 적을 때 먼저 뽑히는 정도 */
  weight: number;
  /** 병원을 넣을 때만 뽑는 건물 */
  medical?: boolean;
  /** 자동 배치에서는 뽑지 않고 목록 입력에서만 쓰는 종류 */
  manual?: boolean;
}

export const BUILDING_TYPES: BuildingType[] = [
  { id: "admin", name: "대학본부", use: "대학 행정·총장실", district: "core", w: [98, 112], d: [30, 34], floors: [4, 5], shapes: ["wings"], styles: ["classic"], weight: 100 },
  { id: "library", name: "중앙도서관", use: "학술정보원·열람실", district: "core", w: [74, 86], d: [44, 52], floors: [4, 5], shapes: ["stepped", "atrium"], styles: ["glass", "modern"], weight: 99 },
  { id: "union", name: "학생회관", use: "학생 활동·식당·편의시설", district: "core", w: [64, 76], d: [40, 48], floors: [4, 6], shapes: ["atrium", "L"], styles: ["glass", "modern"], weight: 98 },
  { id: "gym", name: "종합체육관", use: "실내 경기장·체육 시설", district: "sports", w: [80, 92], d: [52, 60], floors: [3, 3], shapes: ["gym"], styles: ["modern"], weight: 90 },
  { id: "dorm", name: "학생생활관", use: "기숙사", district: "dorm", w: [72, 90], d: [40, 52], floors: [4, 5], shapes: ["U", "court", "L"], styles: ["brick"], weight: 88 },
  { id: "eng1", name: "제1공학관", use: "공과대학", district: "engineering", w: [64, 80], d: [24, 30], floors: [5, 7], shapes: ["bar", "L"], styles: ["modern", "concrete"], weight: 86 },
  { id: "humanities", name: "인문강의동", use: "인문대학", district: "humanities", w: [56, 70], d: [22, 28], floors: [4, 5], shapes: ["bar", "L"], styles: ["brick", "stone"], weight: 85 },
  { id: "business", name: "경영관", use: "경영대학", district: "business", w: [60, 74], d: [26, 32], floors: [5, 7], shapes: ["L", "bar", "atrium"], styles: ["glass", "modern"], weight: 84 },
  { id: "sci1", name: "자연대 1호관", use: "자연과학대학", district: "science", w: [60, 74], d: [22, 28], floors: [4, 6], shapes: ["bar", "L"], styles: ["modern", "concrete"], weight: 83 },
  { id: "social", name: "사회과학관", use: "사회과학대학", district: "social", w: [56, 70], d: [22, 28], floors: [4, 5], shapes: ["bar", "L", "U"], styles: ["brick", "stone"], weight: 82 },
  { id: "law", name: "법학관", use: "법과대학·법학전문대학원", district: "business", w: [52, 64], d: [24, 30], floors: [5, 6], shapes: ["bar", "L"], styles: ["stone", "modern"], weight: 80 },
  { id: "sw", name: "소프트웨어센터", use: "소프트웨어융합대학", district: "it", w: [62, 76], d: [30, 38], floors: [5, 7], shapes: ["atrium", "L"], styles: ["glass", "modern"], weight: 79 },
  { id: "hospital", name: "{U}병원", use: "대학병원·응급의료센터", district: "medical", w: [120, 136], d: [58, 66], floors: [9, 12], shapes: ["hospital"], styles: ["white"], weight: 78, medical: true },
  { id: "intl", name: "국제관", use: "국제학부·어학원", district: "international", w: [68, 82], d: [26, 32], floors: [5, 6], shapes: ["atrium", "bar"], styles: ["glass", "modern"], weight: 77 },
  { id: "education", name: "사범대 본관", use: "사범대학", district: "education", w: [56, 68], d: [22, 28], floors: [4, 5], shapes: ["bar", "L"], styles: ["concrete", "stone"], weight: 76 },
  { id: "eng2", name: "제2공학관", use: "공과대학", district: "engineering", w: [60, 76], d: [22, 28], floors: [5, 7], shapes: ["bar", "L"], styles: ["modern", "glass"], weight: 75 },
  { id: "sci2", name: "자연대 2호관", use: "자연과학대학", district: "science", w: [58, 72], d: [22, 28], floors: [4, 6], shapes: ["bar", "L"], styles: ["modern", "concrete"], weight: 74 },
  { id: "artsLec", name: "예술대 강의동", use: "예술대학", district: "arts", w: [56, 68], d: [26, 32], floors: [3, 4], shapes: ["L", "bar"], styles: ["brick", "stone"], weight: 73 },
  { id: "artsLab", name: "예술대 실습동", use: "예술대학 실기실·공연장", district: "arts", w: [40, 48], d: [40, 48], floors: [2, 3], shapes: ["round"], styles: ["brick"], weight: 72 },
  { id: "med", name: "의대 본관", use: "의과대학", district: "medical", w: [56, 70], d: [24, 30], floors: [6, 8], shapes: ["bar", "L"], styles: ["white", "modern"], weight: 71, medical: true },
  { id: "intlCenter", name: "국제교류센터", use: "국제교류처·게스트하우스", district: "service", w: [44, 54], d: [26, 32], floors: [7, 9], shapes: ["tower"], styles: ["brick"], weight: 70 },
  { id: "nursingLec", name: "간호대 강의동", use: "간호대학", district: "medical", w: [50, 60], d: [22, 26], floors: [4, 5], shapes: ["bar"], styles: ["white", "modern"], weight: 69, medical: true },
  { id: "nursingLab", name: "간호대 실습동", use: "간호대학 실습실", district: "medical", w: [44, 54], d: [22, 26], floors: [4, 5], shapes: ["bar", "L"], styles: ["white"], weight: 68, medical: true },
  { id: "intlDorm", name: "국제학사", use: "외국인 유학생 기숙사", district: "dorm", w: [60, 76], d: [36, 46], floors: [4, 5], shapes: ["L", "U"], styles: ["brick"], weight: 67 },
  { id: "dorm2", name: "제2생활관", use: "고층 기숙사", district: "dormEast", w: [66, 78], d: [24, 28], floors: [12, 15], shapes: ["twin"], styles: ["concrete", "modern"], weight: 66 },
  { id: "auditorium", name: "대강당", use: "공연·입학식·행사", district: "service", w: [56, 66], d: [40, 46], floors: [3, 3], shapes: ["hall"], styles: ["stone", "modern"], weight: 64 },
  { id: "research", name: "산학협력관", use: "산학협력단·창업보육센터", district: "it", w: [52, 64], d: [22, 26], floors: [6, 8], shapes: ["bar"], styles: ["glass"], weight: 62 },
  { id: "museum", name: "대학박물관", use: "박물관·기록관", district: "service", w: [44, 54], d: [30, 36], floors: [2, 3], shapes: ["bar", "court"], styles: ["stone"], weight: 60 },
  { id: "lifesci", name: "생명과학관", use: "생명과학부", district: "science", w: [56, 68], d: [22, 26], floors: [5, 6], shapes: ["bar", "L"], styles: ["modern", "white"], weight: 58 },
  { id: "music", name: "음악관", use: "음악대학·연주홀", district: "arts", w: [50, 60], d: [28, 34], floors: [3, 4], shapes: ["hall", "L"], styles: ["stone", "brick"], weight: 56 },
  { id: "eng3", name: "제3공학관", use: "공과대학", district: "engineering", w: [58, 72], d: [22, 26], floors: [5, 7], shapes: ["bar"], styles: ["concrete", "modern"], weight: 55 },
  { id: "pharmacy", name: "약학관", use: "약학대학", district: "medical", w: [50, 60], d: [22, 26], floors: [5, 6], shapes: ["bar"], styles: ["white", "modern"], weight: 54, medical: true },
  { id: "grad", name: "대학원동", use: "일반대학원", district: "social", w: [50, 62], d: [22, 26], floors: [5, 6], shapes: ["bar", "L"], styles: ["stone", "concrete"], weight: 52 },
  { id: "design", name: "디자인관", use: "디자인대학", district: "arts", w: [50, 62], d: [24, 30], floors: [4, 5], shapes: ["L", "bar"], styles: ["glass", "concrete"], weight: 50 },
  { id: "welfare", name: "학생복지관", use: "식당·서점·보건소", district: "social", w: [48, 58], d: [28, 34], floors: [3, 4], shapes: ["bar", "atrium"], styles: ["modern"], weight: 48 },
  { id: "computing", name: "정보전산원", use: "전산·데이터센터", district: "it", w: [44, 54], d: [22, 26], floors: [4, 5], shapes: ["bar"], styles: ["concrete"], weight: 46 },
  { id: "faculty", name: "교수회관", use: "교수 연구실·회의실", district: "education", w: [44, 54], d: [22, 26], floors: [4, 5], shapes: ["bar"], styles: ["brick"], weight: 44 },
  { id: "lifelong", name: "평생교육원", use: "평생교육·사회교육", district: "humanities", w: [44, 54], d: [22, 26], floors: [4, 5], shapes: ["bar", "L"], styles: ["concrete", "brick"], weight: 42 },
  { id: "generic", name: "강의동", use: "강의·연구", district: "service", w: [50, 64], d: [22, 28], floors: [4, 6], shapes: ["bar", "L"], styles: ["modern", "brick"], weight: 0, manual: true },
];

export const PLACE_TYPES: BuildingType[] = [
  { id: "plaza", name: "중앙광장", use: "광장·행사 공간", district: "core", w: [126, 126], d: [84, 84], floors: [0, 0], shapes: ["plaza"], styles: ["stone"], weight: 100 },
  { id: "field", name: "대운동장", use: "육상 트랙·축구장", district: "sports", w: [156, 156], d: [92, 92], floors: [0, 0], shapes: ["field"], styles: ["modern"], weight: 89 },
];

const TYPE_MAP = new Map([...BUILDING_TYPES, ...PLACE_TYPES].map((t) => [t.id, t]));
export const buildingType = (id: string): BuildingType | undefined => TYPE_MAP.get(id);

export const STYLE_KO: Record<Style, string> = {
  brick: "붉은 벽돌", modern: "현대식 콘크리트·유리", glass: "유리 커튼월", classic: "고전주의 석조",
  concrete: "노출 콘크리트", stone: "석재 마감", white: "흰색 패널",
};

export type LandmarkKind =
  | "fountain" | "obelisk" | "loop" | "globe" | "book" | "curve" | "garden" | "emblem" | "statue" | "bell" | "pond";

export const LANDMARKS: Record<LandmarkKind, { names: string[]; desc: string }> = {
  fountain: { names: ["소형 분수", "희망의 분수", "중앙 분수"], desc: "광장의 원형 분수" },
  obelisk: { names: ["대학 역사 기념석", "개교 기념탑", "건학 이념비"], desc: "개교와 역사를 기리는 기념석" },
  loop: { names: ["무한의 고리", "뫼비우스의 띠"], desc: "무한을 형상화한 금속 조형물" },
  globe: { names: ["세계의 구", "지구의 조형물"], desc: "국제 교류를 상징하는 구형 조형물" },
  book: { names: ["지식의 책", "펼친 책 조형물"], desc: "펼친 책 모양의 휴식 쉼터" },
  curve: { names: ["수학적 곡선", "나선의 길"], desc: "곡선을 따라 걷는 조형 산책로" },
  garden: { names: ["야외 조각정원", "예술의 뜰"], desc: "학생 작품을 전시하는 정원" },
  emblem: { names: ["대학 문장 기념물"], desc: "정문 앞 바닥의 대학 문장" },
  statue: { names: ["설립자 동상", "개척자상"], desc: "대학을 세운 사람을 기리는 동상" },
  bell: { names: ["평화의 종", "화합의 종"], desc: "종각에 걸린 기념 종" },
  pond: { names: ["거울 연못", "사색의 연못"], desc: "산책로가 둘러싼 연못" },
};

export const LANDMARK_KINDS = Object.keys(LANDMARKS) as LandmarkKind[];
