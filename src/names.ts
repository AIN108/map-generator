import { pick, type Rng } from "./rng.ts";

// ── 대학 이름 ───────────────────────────────────────────────────────
// 순우리말, 한자어 두 음절 조합, 학문 개념어(예: 미적분) 세 가지 분위기를 섞는다.
const NATIVE = [
  "한빛", "가람", "누리", "다솜", "여울", "미르", "아라", "마루", "하늬", "새솔", "한결", "늘봄", "온새",
  "라온", "다온", "가온", "비채", "단비", "한울", "이든", "나래", "도담", "해오름", "별무리", "푸른솔",
  "새벽빛", "윤슬", "솔빛", "들꽃", "한누리", "참빛", "꽃뫼", "너울", "하람", "새길",
];
const SINO_FIRST = [
  "청", "명", "서", "성", "태", "학", "문", "정", "덕", "인", "광", "영", "해", "화", "동", "신", "창", "효",
  "지", "혜", "진", "선", "의", "예", "보", "은", "금", "송", "운", "경", "현", "주", "우", "도", "승",
];
const SINO_SECOND = [
  "운", "림", "덕", "화", "산", "원", "명", "성", "강", "정", "하", "현", "해", "진", "인", "문", "영", "주",
  "계", "람", "봉", "암", "곡", "송", "연", "학", "솔", "온", "월", "란",
];
const CONCEPT = [
  "미적분", "벡터", "행렬", "확률", "함수", "로그", "기하", "대수", "위상", "소수", "무한", "극한", "급수",
  "원주율", "황금비", "프랙털", "좌표", "방정식", "집합", "수열", "분자", "광합성", "중력", "양자",
];

/**
 * 실제 대학 이름과 똑같이 나오면 실존 학교처럼 보일 수 있어 제외한다 ('대학교'를 뗀 이름).
 * 완전한 목록은 아니며, 흔히 알려진 이름을 위주로 담았다.
 */
const REAL_UNIVERSITIES = new Set([
  "서울", "연세", "고려", "한양", "성균관", "중앙", "경희", "서강", "이화", "건국", "동국", "홍익", "국민",
  "숭실", "세종", "단국", "광운", "명지", "상명", "가천", "아주", "인하", "부산", "경북", "전남", "충남", "충북",
  "강원", "제주", "한림", "동아", "계명", "영남", "조선", "원광", "전북", "경상", "한남", "대전", "배재", "목원",
  "우송", "호서", "순천향", "한서", "선문", "청주", "서원", "한성", "서경", "삼육", "성신", "덕성", "동덕",
  "숙명", "한신", "협성", "수원", "경기", "용인", "강남", "평택", "안양", "신한", "한세", "성결", "대진", "을지",
  "가톨릭", "한밭", "금오", "한동", "울산", "창원", "경남", "인제", "동서", "신라", "부경", "동의", "고신",
  "영산", "경성", "동명", "남서울", "백석", "나사렛", "상지", "공주", "군산", "목포", "순천", "안동", "한라",
  "극동", "광주", "호남", "남부", "송원", "초당", "세한", "우석", "위덕", "대구", "경일", "대신", "경운", "동양",
  "중원", "건양", "한경", "총신", "칼빈", "그리스도", "한국", "명신", "청운", "중부", "서영", "서정", "한영",
  "동신", "동강", "광신", "한중", "선린", "경동", "유원", "가야", "탐라", "진주", "창신", "영진", "인덕", "명덕",
  "한빛", "성화", "신성", "혜전", "대원", "문경", "주성", "영동", "한려", "세명", "꽃동네", "한라", "제주한라",
  "청암", "송곡", "서해", "동주", "춘해", "대동", "동원", "경민", "계원", "백제", "신구", "한림성심", "성덕",
  "대덕", "대경", "수성", "포항", "경인", "부천", "신안산", "안산", "여주", "오산", "웅지", "장안", "학산",
  "한양여자", "명지전문", "연암", "연성", "용문", "신흥", "청강", "두원", "숭의", "배화", "서일", "인하공업",
]);

/** 시드 RNG로 대학 이름('○○대학교')을 만든다. 실제 대학 이름은 피한다. */
export function universityName(rng: Rng): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    const r = rng();
    let base: string;
    if (r < 0.34) base = pick(rng, NATIVE);
    else if (r < 0.7) {
      const a = pick(rng, SINO_FIRST);
      let b = pick(rng, SINO_SECOND);
      if (b === a) b = pick(rng, SINO_SECOND);
      base = a + b;
    } else base = pick(rng, CONCEPT);
    if (!REAL_UNIVERSITIES.has(base)) return `${base}대학교`;
  }
  return "미적분대학교";
}

export const isRealUniversityBase = (base: string): boolean => REAL_UNIVERSITIES.has(base);

/** '○○대학교'·'○○대학'에서 '○○'만 뗀다. */
export function universityBase(name: string): string {
  return name.replace(/\s+/g, "").replace(/(대학교|대학|university)$/iu, "") || name;
}

// ── 로마자 표기 (국어의 로마자 표기법을 단순화) ─────────────────────
const INITIAL = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const VOWEL = [
  "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i",
];
// 받침(종성) 대표음
const FINAL = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];
// 다음 음절이 'ㅇ'으로 시작할 때 받침이 넘어가며 나는 소리 (연음)
const FINAL_LIAISON = ["", "g", "kk", "ks", "n", "nj", "nh", "d", "r", "lg", "lm", "lb", "ls", "lt", "lp", "lh", "m", "b", "bs", "s", "ss", "ng", "j", "ch", "k", "t", "p", "h"];

/**
 * 한글을 로마자로 옮긴다. 음절별 대표음 + 연음(받침 뒤 'ㅇ')·'ㄹㄹ' 정도만 반영한 단순화 버전이다.
 * 한글이 아닌 글자는 그대로 둔다. 예: 미적분 → Mijeokbun
 */
export function romanize(text: string): string {
  const chars = [...text];
  const parts = chars.map((ch) => {
    const c = ch.charCodeAt(0) - 0xac00;
    return c >= 0 && c <= 11171 ? { ini: Math.floor(c / 588), vow: Math.floor((c % 588) / 28), fin: c % 28 } : null;
  });
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const p = parts[i];
    if (!p) { out += chars[i]; continue; }
    const prev = parts[i - 1], next = parts[i + 1];
    let ini = INITIAL[p.ini];
    if (p.ini === 5 && prev && prev.fin === 8) ini = "l"; // ㄹ받침 + ㄹ → ll
    let fin = "";
    if (p.fin > 0) fin = next && next.ini === 11 && p.fin !== 21 ? FINAL_LIAISON[p.fin] : FINAL[p.fin];
    out += ini + VOWEL[p.vow] + fin;
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** 'MIJEOKBUN UNIVERSITY' 형태의 영문 표기 */
export function englishName(name: string): string {
  return `${romanize(universityBase(name)).toUpperCase()} UNIVERSITY`;
}

/** 마지막 글자 받침 유무로 조사를 고른다. 한글로 끝나지 않으면 '을(를)'처럼 둘 다 쓴다. */
function josa(word: string, withFinal: string, without: string, rieulAsWithout = false): string {
  const w = word.replace(/['"’)\]\s]+$/u, "");
  const last = w[w.length - 1] ?? "";
  // 숫자로 끝나면 읽는 소리로: 영·일·삼·육·칠·팔은 받침, 이·사·오·구는 받침 없음 (일·칠·팔은 ㄹ 받침)
  if (/[0-9]/.test(last)) {
    const fin = ({ 0: 21, 1: 8, 3: 16, 6: 1, 7: 8, 8: 8 } as Record<string, number>)[last] ?? 0;
    if (fin === 0 || (rieulAsWithout && fin === 8)) return without;
    return withFinal;
  }
  const code = w.charCodeAt(w.length - 1) - 0xac00;
  if (!(code >= 0 && code <= 11171)) return `${withFinal}(${without})`;
  const fin = code % 28;
  if (fin === 0 || (rieulAsWithout && fin === 8)) return without;
  return withFinal;
}
/** 목적격 조사 (을/를) */
export const eul = (word: string): string => josa(word, "을", "를");
/** 방향 조사 (으로/로, ㄹ 받침은 '로') */
export const ro = (word: string): string => josa(word, "으로", "로", true);
/** 주격 보조사 (은/는) */
export const eun = (word: string): string => josa(word, "은", "는");
/** 주격 조사 (이/가) */
export const iga = (word: string): string => josa(word, "이", "가");
/** 접속 조사 (과/와) */
export const gwa = (word: string): string => josa(word, "과", "와");
