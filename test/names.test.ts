import assert from "node:assert/strict";
import { test } from "node:test";
import { englishName, eul, isRealUniversityBase, ro, romanize, universityBase, universityName } from "../src/names.ts";
import { createRng } from "../src/rng.ts";

test("로마자 표기: 음절 대표음과 연음", () => {
  assert.equal(romanize("미적분"), "Mijeokbun");
  assert.equal(romanize("한울"), "Hanul");
  assert.equal(romanize("학원"), "Hagwon");
  assert.equal(romanize("별무리"), "Byeolmuri");
  assert.equal(romanize("달리"), "Dalli");
  assert.equal(englishName("미적분대학교"), "MIJEOKBUN UNIVERSITY");
});

test("대학 이름은 '대학교'로 끝나고 실제 대학 이름을 피한다", () => {
  const rng = createRng("names");
  for (let i = 0; i < 500; i++) {
    const name = universityName(rng);
    assert.match(name, /대학교$/);
    assert.equal(isRealUniversityBase(universityBase(name)), false, name);
  }
});

test("같은 시드는 같은 이름", () => {
  assert.equal(universityName(createRng("x")), universityName(createRng("x")));
});

test("조사: 받침 유무와 ㄹ 받침", () => {
  assert.equal(eul("도서관"), "을");
  assert.equal(eul("대학본부"), "를");
  assert.equal(ro("도서관"), "으로");
  assert.equal(ro("광장"), "으로");
  assert.equal(ro("본부"), "로");
  assert.equal(ro("교실"), "로");
  assert.equal(eul("file.json"), "을(를)");
});
