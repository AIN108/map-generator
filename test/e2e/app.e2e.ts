// 브라우저 점검: 빌드한 앱(dist)을 vite preview로 띄우고, 주요 흐름이 콘솔 오류 없이 동작하는지 본다.
// 실행: npm run test:e2e (먼저 빌드한다). CI에서는 Playwright의 Chromium을 내려받아 쓴다.

import assert from "node:assert/strict";
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

test("휴대폰 화면: 가로로 넘치지 않고, 건물을 고르면 선택 막대가 뜬다", async () => {
  const { ctx, page, errors } = await open("#seed=e2e", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(sw <= iw, `${sw} > ${iw}`);
  await page.locator("#legendList button").nth(3).tap();
  assert.equal(await page.locator("#selBar").isVisible(), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});
