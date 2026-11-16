// 브라우저 점검: 빌드한 앱(dist)을 vite preview로 띄우고, 주요 흐름이 콘솔 오류 없이 동작하는지 본다.
// 실행: npm run test:e2e (먼저 빌드한다). CI에서는 Playwright의 Chromium을 내려받아 쓴다.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { after, before, test } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const PORT = Number(process.env.E2E_PORT ?? 4179);
const BASE = `http://127.0.0.1:${PORT}/`;
let server: ChildProcess | undefined;
let browser: Browser;

async function waitForServer(url: string, ms = 30000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // 아직 뜨지 않음
    }
    if (Date.now() - t0 > ms) throw new Error(`미리보기 서버가 ${ms}ms 안에 뜨지 않았습니다: ${url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

before(async () => {
  server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { stdio: "ignore" });
  await waitForServer(BASE);
  // 한글 내려받기 파일 이름이 'download'로 바뀌지 않도록 UTF-8 문자 설정으로 띄운다.
  browser = await chromium.launch({ env: { ...process.env, LC_ALL: "C.UTF-8", LANG: "C.UTF-8" } });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

interface Opened { ctx: BrowserContext; page: Page; errors: string[] }

async function open(hash = "#seed=e2e", opts: Parameters<Browser["newContext"]>[0] = {}): Promise<Opened> {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, ...opts });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("dialog", (d) => void d.accept());
  await page.goto(BASE + hash);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", undefined, { timeout: 30000 });
  return { ctx, page, errors };
}

const status = (p: Page): Promise<string> => p.locator("#status").innerText();

async function openInterior(page: Page, building: Record<string, unknown> = {}): Promise<void> {
  await page.setInputFiles("#importFile", {
    name: "interior-fixture.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      format: "campus-map/v1", options: { seed: "interior", buildings: 24 },
      layout: { name: "실내시험대학교", nextId: 2, landmarks: [], buildings: [{
        id: 1, type: "humanities", name: "설계관", x: 0, y: 0, angle: 0, w: 60, d: 26,
        floors: 5, style: "modern", shape: "bar", variant: 0.3, ...building,
      }] },
    })),
  });
  await page.locator("#legendList button").first().click();
  await page.selectOption("#planFloor", "2");
  await page.click("#planExpand");
}

test("실내 분할 미리보기는 적용 전 원본을 유지하고 잘못된 비율의 이유를 표시한다", async () => {
  const { ctx, page, errors } = await open();
  await openInterior(page);
  await page.selectOption("#planRoomList", "201");
  const count = await page.locator("#planRoomList option").count();
  const summary = await page.locator("#planFloorSummary").innerText();
  await page.selectOption("#planSplitAxis", "v");
  await page.fill("#planSplitRatio", "40");
  const preview = await page.locator("#planSplitPreview").innerText();
  assert.match(preview, /점선.*기존 201호:.*m².*새 호실:.*m²/);
  const expected = preview.match(/· ([\d.]+) m²/)![1];
  assert.equal(await page.locator("#planRoomList option").count(), count);
  assert.equal(await page.locator("#planFloorSummary").innerText(), summary);
  assert.equal(await page.locator("#planUndo").isEnabled(), false);
  await page.fill("#planSplitRatio", "10");
  assert.equal(await page.locator("#planSplit").isEnabled(), false);
  assert.match(await page.locator("#planSplitPreview").innerText(), /20~80%.*2m/);
  await page.fill("#planSplitRatio", "40");
  await page.click("#planSplit");
  assert.equal(await page.locator("#planRoomList option").count(), count + 1);
  assert.match(await page.locator("#planRoomNo").innerText(), new RegExp(`${expected.replace(".", "\\.")} m²`));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("100실이 넘는 층도 분할·새 호실 검색·이름·새로고침 복원을 지원한다", async () => {
  const { ctx, page, errors } = await open();
  await openInterior(page, { type: "dorm", shape: "court", w: 220, d: 160, floors: 12 });
  await page.selectOption("#planFloor", "12");
  const count = await page.locator("#planRoomList option").count();
  assert.ok(count > 100);
  await page.selectOption("#planRoomList", "1201");
  await page.selectOption("#planSplitAxis", "v");
  await page.click("#planSplit");
  assert.equal(await page.locator("#planRoomList option").count(), count + 1);
  const number = (await page.locator("#planInteriorStatus").innerText()).match(/새 호실 (12-\d+)호/)![1];
  await page.fill("#planRoomQuery", number);
  await page.selectOption("#planRoomList", number);
  await page.fill("#planRoomName", "확장 호실 실험실");
  await page.click("#planRoomSave");
  assert.match(await page.locator("#planRoomList").innerText(), /확장 호실 실험실/);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  await page.locator("#legendList button").first().click();
  await page.selectOption("#planFloor", "12");
  await page.click("#planExpand");
  await page.fill("#planRoomQuery", "확장 호실 실험실");
  assert.equal(await page.locator("#planRoomList option").count(), 1);
  assert.equal(await page.locator("#planRoomList option").first().getAttribute("value"), number);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("이전 브라우저 자동 저장의 중복 호실 이름도 층별로 복원한다", async () => {
  const { ctx, page, errors } = await open();
  await openInterior(page, { type: "dorm", shape: "court", w: 220, d: 160, floors: 12 });
  // 이전 배포본의 자동 저장 형식에는 roomNumbering이 없다.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("cmg:layout:v1")!);
    delete saved.roomNumbering;
    saved.layout.buildings[0].rooms = { "1101": "자동 저장 옛 이름" };
    localStorage.setItem("cmg:layout:v1", JSON.stringify(saved));
  });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  await page.locator("#legendList button").first().click();
  await page.selectOption("#planFloor", "1");
  await page.click("#planExpand");
  await page.fill("#planRoomQuery", "자동 저장 옛 이름");
  assert.equal(await page.locator("#planRoomList option").first().getAttribute("value"), "1-101");
  await page.selectOption("#planFloor", "11");
  await page.fill("#planRoomQuery", "자동 저장 옛 이름");
  assert.equal(await page.locator("#planRoomList option").first().getAttribute("value"), "1101");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("실내 구획: 이름·면적을 유지하며 분할·합치기·되돌리기·자동 구성을 쓴다", async () => {
  const { ctx, page, errors } = await open();
  await openInterior(page);
  const list = page.locator("#planRoomList option");
  const before = await list.count();
  const numbers = await list.evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  const area = (await page.locator("#planFloorSummary").innerText()).match(/합계 ([\d.]+)/)![1];
  await page.selectOption("#planRoomList", "201");
  await page.fill("#planRoomName", "설계 연구실");
  await page.click("#planRoomSave");
  await page.click("#planSplit");
  assert.equal(await list.count(), before + 1);
  assert.equal(await page.locator("#planRoomName").inputValue(), "설계 연구실");
  assert.match(await page.locator("#planFloorSummary").innerText(), new RegExp(`합계 ${area.replace(".", "\\.")}`));
  const after = await list.evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  const added = after.find((n) => !numbers.includes(n))!;
  await page.selectOption("#planMergeTarget", added);
  await page.click("#planMerge");
  assert.equal(await list.count(), before);
  assert.equal(await page.locator("#planRoomName").inputValue(), "설계 연구실");
  await page.click("#planUndo");
  assert.equal(await list.count(), before + 1);
  await page.locator("#planRoomList").focus();
  await page.keyboard.press("Control+Shift+Z");
  assert.equal(await list.count(), before);
  await page.click("#planInteriorReset");
  assert.match(await page.locator("#planFloorSummary").innerText(), /자동 구성/);
  assert.equal(await page.locator("#planInteriorReset").isDisabled(), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("실내 구획과 새 호실 이름은 새로고침·JSON 저장과 불러오기 후에도 남는다", async () => {
  const { ctx, page, errors } = await open();
  await openInterior(page);
  await page.selectOption("#planRoomList", "201");
  await page.selectOption("#planSplitAxis", "v");
  const before = await page.locator("#planRoomList option").count();
  await page.click("#planSplit");
  const added = await page.locator("#planRoomList option").last().getAttribute("value");
  await page.selectOption("#planRoomList", added!);
  await page.fill("#planRoomName", "새 세미나실");
  await page.click("#planRoomSave");
  await page.click("#planClose");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#exportJson")]);
  const path = (await download.path())!;
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.equal(saved.layout.buildings[0].interiors["2"].operations.length, 1);
  assert.equal(saved.layout.buildings[0].rooms[added!], "새 세미나실");
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  await page.locator("#legendList button").first().click();
  await page.selectOption("#planFloor", "2");
  assert.equal(await page.locator("#planRoomList option").count(), before + 1);
  assert.match(await page.locator("#planRoomList").innerText(), /새 세미나실/);
  await page.setInputFiles("#importFile", path);
  await page.locator("#legendList button").first().click();
  await page.selectOption("#planFloor", "2");
  assert.equal(await page.locator("#planRoomList option").count(), before + 1);
  assert.match(await page.locator("#planRoomList").innerText(), /새 세미나실/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("휴대폰 큰 평면도 창에서도 구획 편집·검색·입력 초기화가 동작한다", async () => {
  const { ctx, page, errors } = await open("#seed=e2e-interior-mobile", { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await openInterior(page);
  for (const id of ["planCanvas", "planInterior", "planRoomList", "planSplit", "planMergeTarget"]) {
    const box = (await page.locator(`#${id}`).boundingBox())!;
    assert.ok(box.x >= 0 && box.x + box.width <= 375, `${id}이 화면 밖`);
  }
  await page.selectOption("#planRoomList", "201");
  await page.selectOption("#planSplitAxis", "v");
  const before = await page.locator("#planRoomList option").count();
  await page.click("#planSplit");
  assert.equal(await page.locator("#planRoomList option").count(), before + 1);
  await page.fill("#planRoomQuery", "201");
  assert.equal(await page.locator("#planRoomList option").count(), 1);
  await page.locator("#planRoomQuery").press("Escape");
  assert.equal(await page.locator("#planRoomQuery").inputValue(), "");
  assert.equal(await page.locator("#planDialog").isVisible(), true);
  assert.equal(await page.locator("#planRoomList option").count(), before + 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("장소 검색: 번호로 고르고 이름 변경·되돌리기를 검색에 반영한다", async () => {
  const { ctx, page, errors } = await open("#seed=e2e-search");
  await page.fill("#placeQuery", "1번");
  assert.equal(await page.locator("#placeResults button").count(), 1);
  await page.locator("#placeQuery").press("Enter");
  assert.equal(await page.locator("#zoomLevel").innerText(), "240%");
  assert.equal(await page.locator("#undo").isDisabled(), true, "검색은 편집 기록을 만들지 않는다");
  await page.fill("#selName", "검색 시험 본관");
  await page.click("#selRename");
  await page.fill("#placeQuery", "검색 시험 본관");
  assert.equal(await page.locator("#placeResults button").count(), 1);
  await page.click("#undo");
  assert.equal(await page.locator("#placeResults button").count(), 0);
  assert.match(await page.locator("#placeCount").innerText(), /검색 결과가 없습니다/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("상징물을 검색해 고르면 확대된다", async () => {
  const { ctx, page, errors } = await open("#seed=e2e-search-landmark");
  await page.selectOption("#placeCategory", "landmark");
  assert.ok(await page.locator("#placeResults button").count() > 0);
  await page.locator("#placeQuery").press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#zoomLevel").innerText(), "240%");
  assert.match(await page.locator("#inspectorTitle").innerText(), /상징물/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("좁은 화면의 장소 검색과 초기화, 슬래시 입력", async () => {
  const { ctx, page, errors } = await open("#seed=e2e-search-mobile", { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await page.selectOption("#placeCategory", "building");
  for (const id of ["placeQuery", "placeCategory", "placeClear", "placeResults"]) {
    const box = (await page.locator(`#${id}`).boundingBox())!;
    assert.ok(box.x >= 0 && box.x + box.width <= 375, `${id}이 화면 밖`);
  }
  await page.locator("#map").focus();
  await page.keyboard.press("/");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "placeQuery");
  await page.locator("#placeQuery").press("/");
  assert.equal(await page.locator("#placeQuery").inputValue(), "/", "입력칸에서는 슬래시를 그대로 입력");
  await page.locator("#placeQuery").press("Escape");
  assert.equal(await page.locator("#placeCategory").inputValue(), "all");
  assert.equal(await page.locator("#placeResults").isVisible(), false);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("처음 열면 조감도와 번호 목록이 그려지고 오류가 없다", async () => {
  const { ctx, page, errors } = await open();
  assert.ok((await page.locator("#legendList button").count()) >= 10);
  // 캔버스가 비어 있지 않다 (가운데 픽셀이 바탕색 하나가 아님)
  const distinct = await page.evaluate(() => {
    const c = document.getElementById("map") as HTMLCanvasElement;
    const x = c.getContext("2d")!;
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const d = x.getImageData(Math.floor((c.width * (i + 0.5)) / 40), Math.floor(c.height / 2), 1, 1).data;
      seen.add(`${d[0]},${d[1]},${d[2]}`);
    }
    return seen.size;
  });
  assert.ok(distinct > 5, `색 ${distinct}가지`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("건물을 골라 모양·외관을 바꾸고 되돌린다, 평면도가 따라 바뀐다", async () => {
  const { ctx, page, errors } = await open();
  await page.locator("#legendList button").nth(6).click();
  assert.equal(await page.locator("#planEditor").isVisible(), true);
  const before = await page.locator("#selShape").inputValue();
  const next = before === "U" ? "L" : "U";
  await page.selectOption("#selShape", next);
  assert.match(await status(page), /바꿨습니다/);
  assert.match(await page.locator("#planSpec").innerText(), next === "U" ? /ㄷ자/ : /ㄱ자/);
  await page.click("#undo");
  assert.equal(await page.locator("#selShape").inputValue(), before);
  // 층 평면에서 실을 골라 이름 붙이기
  await page.selectOption("#planFloor", "2");
  assert.match(await page.locator("#planSpec").innerText(), /2층 호실\s+201~/);
  await page.locator("#planCanvas").scrollIntoViewIfNeeded();
  const box = (await page.locator("#planCanvas").boundingBox())!;
  search: for (let j = 1; j < 10; j++) {
    for (let i = 1; i < 10; i++) {
      await page.mouse.click(box.x + (box.width * i) / 10, box.y + (box.height * j) / 10);
      if (/호/.test(await page.locator("#planRoomNo").innerText())) break search;
    }
  }
  assert.match(await page.locator("#planRoomNo").innerText(), /^2\d\d호/);
  await page.fill("#planRoomName", "시험 연구실");
  await page.click("#planRoomSave");
  assert.match(await status(page), /시험 연구실/);
  await page.click("#formCustom").catch(() => undefined);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("편집 모드에서 건물을 끌어 옮긴다", async () => {
  const { ctx, page, errors } = await open();
  await page.keyboard.press("e");
  await page.locator("#legendList button").nth(8).click();
  await page.click("#selZoom");
  await page.waitForTimeout(400);
  // 화면 가운데 둘레에서 건물 위(손 모양 커서)를 찾는다
  const box = (await page.locator("#map").boundingBox())!;
  let at: [number, number] | undefined;
  for (let r = 0; r < 160 && !at; r += 12) {
    for (const [dx, dy] of [[0, r], [r, 0], [-r, 0], [0, -r], [r, r], [-r, r]]) {
      const x = box.x + box.width / 2 + dx, y = box.y + box.height / 2 + dy;
      await page.mouse.move(x, y);
      if (await page.locator("#mapWrap.hovering").count()) { at = [x, y]; break; }
    }
  }
  assert.ok(at, "건물을 찾지 못함");
  assert.equal(await page.locator("#undo").isDisabled(), true);
  await page.mouse.down();
  await page.mouse.move(at[0] + 30, at[1] + 12, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#undo").isDisabled(), false, `옮기지 못함: ${await status(page)}`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("메모 핀을 꽂고 제목·내용을 적는다, 다른 곳을 눌러도 쓰던 글은 원래 메모에 남는다", async () => {
  const { ctx, page, errors } = await open("#seed=e2e-note");
  await page.keyboard.press("e");
  await page.check('input[name="tool"][value="note"]');
  const box = (await page.locator("#map").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.55);
  assert.equal(await page.locator("#noteBox").isVisible(), true);
  await page.fill("#noteTitle", "집회 장소");
  await page.press("#noteTitle", "Enter");
  await page.fill("#noteText", "금요일 정오");
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4);
  assert.match(await page.locator("#noteLegend").innerText(), /메모 2/);
  assert.equal(await page.locator("#noteText").inputValue(), "", "새 메모는 비어 있다");
  // 새 메모는 제목 칸에 바로 쓸 수 있게 포커스가 간다
  assert.equal(await page.evaluate(() => document.activeElement?.id), "noteTitle");
  await page.click("#noteDelete");
  assert.match(await status(page), /메모 2.*지웠습니다/);
  await page.click("#undo");
  await page.click("#undo");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("건물 목록으로 만들고 지금 배치를 목록으로 옮긴다", async () => {
  const { ctx, page, errors } = await open();
  await page.locator("#programBox > summary").click();
  await page.fill("#programText", "@이름 시험대학교\n대학본부 | 본부\n중앙광장 | 광장\n중앙도서관 | 8층 | 중앙광장 동쪽 | 유리\n제1공학관 | 9층 | 동쪽\n제2공학관 | 제1공학관 동쪽\n체육관 | 남서쪽");
  await page.click("#programApply");
  await page.waitForTimeout(300);
  assert.match(await page.locator("#programState").innerText(), /목록 사용 중/);
  assert.match(await status(page), /시험대학교/);
  await page.click("#programFromMap");
  assert.match(await page.locator("#programText").inputValue(), /제2공학관 \|/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("편집한 배치를 링크로 보내고, 새 브라우저에서 그대로 연다", async () => {
  const { ctx, page, errors } = await open("#seed=e2e-share", { permissions: ["clipboard-read", "clipboard-write"] });
  await page.locator("#legendList button").nth(5).click();
  const style = (await page.locator("#selStyle").inputValue()) === "brick" ? "glass" : "brick";
  await page.selectOption("#selStyle", style);
  const name = await page.locator("#selName").inputValue();
  await page.click("#copyLink");
  await page.waitForTimeout(200);
  assert.match(await status(page), /담은 링크/);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(link, /&l=[A-Za-z0-9_-]+$/);
  const other = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const p2 = await other.newPage();
  await p2.goto(link);
  await p2.waitForFunction(() => document.documentElement.dataset.ready === "1");
  assert.match(await status(p2), /링크에 담긴 배치/);
  await p2.locator("#legendList button", { hasText: name }).first().click();
  assert.equal(await p2.locator("#selStyle").inputValue(), style);
  assert.deepEqual(errors, []);
  await other.close();
  await ctx.close();
});

test("판 저장·불러오기, 배치도·JSON 내보내기", async () => {
  const { ctx, page, errors } = await open("#seed=e2e-save", { acceptDownloads: true });
  await page.locator("#versionBox > summary").click();
  await page.fill("#versionName", "시험 판");
  await page.click("#versionSave");
  assert.match(await status(page), /시험 판/);
  await page.selectOption("#versionList", { index: 0 });
  await page.click("#versionLoad");
  assert.match(await status(page), /불러왔습니다/);
  const [plan] = await Promise.all([page.waitForEvent("download"), page.click("#exportPlan")]);
  assert.match(plan.suggestedFilename(), /배치도\.png$/);
  await page.selectOption("#exportFormat", "svg");
  const [svg] = await Promise.all([page.waitForEvent("download"), page.click("#exportPlan")]);
  assert.match(svg.suggestedFilename(), /배치도\.svg$/);
  await page.selectOption("#exportFormat", "png");
  const [json] = await Promise.all([page.waitForEvent("download"), page.click("#exportJson")]);
  assert.match(json.suggestedFilename(), /\.json$/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("Claude로 설정 글 읽기: 요청 형식(모델·폴백·구조화 출력)과 결과·오류 처리 (API는 흉내)", async () => {
  const { ctx, page, errors } = await open("#seed=e2e-llm");
  const seen: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  let status = 200;
  await page.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    seen.push({ headers: await req.allHeaders(), body: JSON.parse(req.postData() ?? "{}") });
    if (status !== 200) {
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }) });
      return;
    }
    const json = JSON.stringify({ program: "@이름 시험대학교\n대학본부 | 본부 | 5층 | 중앙\n중앙광장 | 광장\n제1공학관 | 공학 | 7층 | 동쪽", notes: ["층수가 없는 시설이 있습니다"] });
    const ev = (type: string, data: unknown): string => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    const body = [
      ev("message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 } } }),
      ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: json.slice(0, 40) } }),
      ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: json.slice(40) } }),
      ev("content_block_stop", { type: "content_block_stop", index: 0 }),
      ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 300 } }),
      ev("message_stop", { type: "message_stop" }),
    ].join("");
    await route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });
  await page.locator("#programBox > summary").click();
  await page.fill("#programText", "가상의 시험대학교. 대학본부는 캠퍼스 중앙의 5층 건물이다. 제1공학관은 동쪽에 있다.");
  await page.locator("#llmBox > summary").click();
  assert.match(await page.locator("#llmReport").innerText(), /보낼 글: 목록 칸의 글/);
  await page.fill("#llmKey", "sk-ant-test");
  await page.click("#llmRun");
  await page.waitForFunction(() => /완료/.test(document.getElementById("llmReport")?.textContent ?? ""), undefined, { timeout: 15000 });
  assert.match(await page.locator("#programText").inputValue(), /제1공학관 \| 공학 \| 7층 \| 동쪽/);
  assert.match(await page.locator("#programReport").innerText(), /입력 1,200·출력 300토큰[\s\S]*참고: 층수가 없는 시설/);
  const r = seen[0];
  assert.equal(r.body.model, "claude-opus-5-5");
  assert.equal(r.body.fallbacks, "default");
  assert.equal(r.body.stream, true);
  assert.deepEqual((r.body.output_config as { format: { type: string } }).format.type, "json_schema");
  assert.match(r.headers["anthropic-beta"] ?? "", /server-side-fallback-2026-07-01/);
  // 키는 SDK가 정한 인증 헤더로 (SDK 1.x: authorization Bearer, 예전: x-api-key)
  assert.ok(r.headers["authorization"] === "Bearer sk-ant-test" || r.headers["x-api-key"] === "sk-ant-test");
  assert.equal(r.headers["anthropic-dangerous-direct-browser-access"], "true");
  // 기억을 켜지 않았으면 키를 저장하지 않는다
  assert.equal(await page.evaluate(() => localStorage.getItem("cmg:anthropic-key:v1")), null);
  // 틀린 키
  status = 401;
  await page.click("#llmRun");
  await page.waitForFunction(() => document.getElementById("llmReport")?.classList.contains("error"), undefined, { timeout: 15000 });
  assert.match(await page.locator("#llmReport").innerText(), /API 키가 올바르지 않습니다/);
  assert.deepEqual(errors.filter((e) => !/401|Failed to load resource/.test(e)), []);
  await ctx.close();
});

test("편집 도우미: ] [ 로 건물 넘기기, 되돌리기 기록에서 골라 여러 단계 되돌리기, 터치로 건물 끌기", async () => {
  const { ctx, page, errors } = await open("#seed=e2e-help", { hasTouch: true });
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  assert.match(await page.locator("#inspectorTitle").innerText(), /^2번/);
  await page.keyboard.press("[");
  assert.match(await page.locator("#inspectorTitle").innerText(), /^1번/);
  await page.locator("#legendList button").nth(7).click();
  const shape0 = await page.locator("#selShape").inputValue();
  await page.selectOption("#selStyle", (await page.locator("#selStyle").inputValue()) === "brick" ? "glass" : "brick");
  await page.selectOption("#selShape", shape0 === "U" ? "L" : "U");
  assert.equal(await page.locator("#historyList option").count(), 3, "머리글 + 2단계");
  await page.selectOption("#historyList", "2");
  assert.match(await status(page), /2단계 되돌렸습니다/);
  assert.equal(await page.locator("#selShape").inputValue(), shape0);
  assert.equal(await page.locator("#undo").isDisabled(), true);
  // 터치 끌기 (편집 모드)
  await page.locator("#editMode").check();
  await page.click("#selZoom");
  await page.waitForTimeout(300);
  const box = (await page.locator("#map").boundingBox())!;
  let at: [number, number] | undefined;
  for (let r = 0; r < 200 && !at; r += 8) {
    for (const [dx, dy] of [[0, r], [r, 0], [-r, 0], [0, -r]]) {
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
      if (await page.locator("#mapWrap.hovering").count()) { at = [box.x + box.width / 2 + dx, box.y + box.height / 2 + dy]; break; }
    }
  }
  assert.ok(at);
  const cdp = await ctx.newCDPSession(page);
  const pt = (x: number, y: number) => [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(at[0], at[1]) });
  for (let k = 1; k <= 10; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(at[0] + k * 5, at[1] + k * 2) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#undo").isDisabled(), false, `터치로 옮기지 못함: ${await status(page)}`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("캠퍼스 유형·밀도를 바꾸면 새로 만들고 링크에 남는다", async () => {
  const { ctx, page, errors } = await open("#seed=e2e-type");
  await page.selectOption("#campusType", "river");
  assert.match(await status(page), /강변형/);
  assert.match(page.url(), /campus=river/);
  await page.selectOption("#density", "loose");
  assert.match(page.url(), /density=loose/);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  assert.equal(await page.locator("#campusType").inputValue(), "river");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("터치: 두 번 누르면 그 자리를 확대하고, 두 손가락으로 누르면 한 단계 축소한다", async () => {
  const { ctx, page, errors } = await open("#seed=e2e-touch", { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  const box = (await page.locator("#map").boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height * 0.2; // 하늘 쪽: 건물이 없는 자리
  await page.touchscreen.tap(cx, cy);
  await page.touchscreen.tap(cx, cy);
  await page.waitForFunction(() => document.getElementById("zoomLevel")?.textContent === "200%");
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForFunction(() => document.getElementById("zoomLevel")?.textContent === "133%");
  assert.equal(await page.locator("#undo").isDisabled(), true, "확대·축소는 편집 기록을 만들지 않는다");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("휴대폰 화면: 가로로 넘치지 않고, 건물을 고르면 선택 막대가 뜬다", async () => {
  const { ctx, page, errors } = await open("#seed=e2e", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(sw <= iw, `${sw} > ${iw}`);
  await page.locator("#legendList button").nth(3).tap();
  assert.equal(await page.locator("#selBar").isVisible(), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});
