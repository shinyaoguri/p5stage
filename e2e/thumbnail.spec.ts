/**
 * サムネイル (Phase 4-4 / ADR 0019)。
 *
 * ここでしか確かめられないのは、**画素が別オリジンの iframe を越えて運ばれること**。
 * 撮るのは実行環境 (preview)、受け取るのは本体 (web)、配るのは配信ホスト
 * (assets) — 3 つのオリジンをまたぐので、単体テストでは形しか見られない。
 *
 * 確認は画素で行う。「200 が返った」ではなく **今動いているスケッチの絵であること**
 * まで見たいのと、canvas から画素を読めること自体が配信の CORS
 * (`Access-Control-Allow-Origin: *`) が効いている確認になるため。
 */

import { expect, test, type Browser, type Page } from "@playwright/test";

import { FAKE_VIEWER } from "./fake-github/viewer";
import {
  login,
  openEditor,
  saveAgain,
  saveNewSketch,
  typeIntoEditor,
} from "./helpers";
import { WEB_ORIGIN } from "./origins";

/** 画素 1 つ (RGBA)。 */
type Pixel = [number, number, number, number];

const RED: Pixel = [255, 0, 0, 255];
const BLUE: Pixel = [0, 0, 255, 255];
const GREEN: Pixel = [0, 255, 0, 255];

/** 面を 1 色で塗るだけのスケッチ (1 行 — helpers.ts の作法)。 */
function solidSketch(color: string): string {
  return `function setup(){ createCanvas(240,150); background(${color}); noLoop(); }`;
}

/** ログインして、書ける状態のエディタを開く。 */
async function signedInEditor(page: Page): Promise<void> {
  await openEditor(page);
  await login(page);
  await openEditor(page);
}

/** そのコードを流し込んで実行する。 */
async function runSketch(page: Page, code: string): Promise<void> {
  await typeIntoEditor(page, code);
  await page.keyboard.press("ControlOrMeta+Enter");
}

/**
 * 作品ページが出している og:image (無ければ null)。
 *
 * ロケータで待たずに DOM を直接読む — **無いことを確かめる**のにも使うので、
 * 現れるまで待たれると 1 回ごとに待ち時間を積むことになる。
 */
async function ogImage(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document
        .querySelector('head meta[property="og:image"]')
        ?.getAttribute("content") ?? null
  );
}

/**
 * 撮影は保存の後を追いかけるので、出るまで開き直して待つ。
 *
 * 待つ対象を「保存できた」ではなく **og:image が指す URL** にするのは、
 * 撮影 → 送信 → D1 → ページの表示までが揃って初めて意味を持つため。
 */
async function waitForThumbnail(
  page: Page,
  previous: string | null = null
): Promise<string> {
  await expect
    .poll(
      async () => {
        await page.reload();
        const url = await ogImage(page);
        return url !== null && url !== previous ? url : null;
      },
      { message: "サムネイルが作品ページに出ません", timeout: 30_000 }
    )
    .not.toBeNull();

  const url = await ogImage(page);
  if (url === null) throw new Error("og:image が消えました");
  return url;
}

/**
 * その画像の中心の画素。
 *
 * ブラウザで読むのは、PNG の復号を自前で持たないため。配信が
 * `Access-Control-Allow-Origin: *` を返していないと canvas が汚染されて
 * `getImageData` が落ちるので、**CORS の確認も兼ねる**。
 */
async function centerPixel(page: Page, url: string): Promise<Pixel> {
  return page.evaluate(async (src) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`読めません: ${src}`));
      image.src = src;
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("2d コンテキストがありません");
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(
      Math.floor(image.naturalWidth / 2),
      Math.floor(image.naturalHeight / 2),
      1,
      1
    );
    return [data[0], data[1], data[2], data[3]] as [
      number,
      number,
      number,
      number,
    ];
  }, url);
}

/** cookie を持たない閲覧者として作品ページを開く。 */
async function openAsViewer(browser: Browser, sketchId: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${WEB_ORIGIN}/@${FAKE_VIEWER.login}/${sketchId}`);
  return page;
}

test.describe("サムネイル", () => {
  test("保存すると、そのときの絵が作品ページのカードに出る", async ({
    page,
    browser,
  }) => {
    await signedInEditor(page);
    await runSketch(page, solidSketch("255,0,0"));
    const sketchId = await saveNewSketch(page, "サムネイルの作品", "public");

    const viewer = await openAsViewer(browser, sketchId);
    const first = await waitForThumbnail(viewer);

    // 配信ホストから出ている (本体のオリジンでは配らない — ADR 0014)。
    expect(new URL(first).origin).not.toBe(WEB_ORIGIN);

    const response = await viewer.request.get(first);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");

    // 撮れているのは「今動いているスケッチ」の絵。
    expect(await centerPixel(viewer, first)).toEqual(RED);

    // 保存し直すと、その版の絵に入れ替わる。
    await runSketch(page, solidSketch("0,0,255"));
    await saveAgain(page);

    const second = await waitForThumbnail(viewer, first);
    expect(second).not.toBe(first);
    expect(await centerPixel(viewer, second)).toEqual(BLUE);

    // 前の版の絵は消えない (鍵が版ごとに不変なので上書きが起きない)。
    expect(await centerPixel(viewer, first)).toEqual(RED);

    await viewer.context().close();
  });

  test("WEBGL のスケッチも撮れる", async ({ page, browser }) => {
    // WebGL の描画バッファは、既定では合成の後に捨てられる (読むと空になる)。
    // p5 が `preserveDrawingBuffer: true` で作っていることに乗っているので、
    // **実際に読めることを実物で押さえる**。
    await signedInEditor(page);
    await runSketch(
      page,
      "function setup(){ createCanvas(240,150,WEBGL); background(0,255,0); noLoop(); }"
    );
    const sketchId = await saveNewSketch(page, "WEBGL の作品", "public");

    const viewer = await openAsViewer(browser, sketchId);
    const url = await waitForThumbnail(viewer);
    expect(await centerPixel(viewer, url)).toEqual(GREEN);

    await viewer.context().close();
  });

  test("過去の版のページはカードを出さない", async ({ page, browser }) => {
    await signedInEditor(page);
    await runSketch(page, solidSketch("255,0,0"));
    const sketchId = await saveNewSketch(page, "版が 2 つある作品", "public");

    const viewer = await openAsViewer(browser, sketchId);
    await waitForThumbnail(viewer);
    const oldRevision = await viewer
      .locator(".sketch-page")
      .getAttribute("data-revision");
    expect(oldRevision).not.toBeNull();

    await runSketch(page, solidSketch("0,0,255"));
    await saveAgain(page);
    await waitForThumbnail(viewer);

    // 過去の版は `noindex` で近似重複を並べない方針 (ADR 0016)。カードも作らない。
    await viewer.goto(
      `${WEB_ORIGIN}/@${FAKE_VIEWER.login}/${sketchId}?rev=${oldRevision ?? ""}`
    );
    await expect(viewer.locator(".sketch-past")).toBeVisible();
    expect(await ogImage(viewer)).toBeNull();

    await viewer.context().close();
  });
});
