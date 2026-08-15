/**
 * 画面の証跡 (`@shots`)。**何も検証しない**、人が見るための画像を吐くだけ。
 *
 * ここがある理由は、**web (本体) の PR プレビュー URL が出せない**こと。
 * `p5stage-web` はライブ同期の Durable Object (ADR 0017) を持ち、Cloudflare は
 * DO を実装した Worker にプレビュー URL を発行しない。つまり PR で「触って
 * 確かめる」道が無い。代わりに**同じ画面を CI で撮って PR に添える**。
 *
 * 撮るのは「PR で見たいもの」だけに絞る。増やすほど遅くなり、読む側も追えない。
 * 検証は他の spec が受け持つので、ここでは待ち合わせ以上のことをしない
 * (`expect` は「撮る前に着いているか」を見るためだけに使う)。
 *
 * 普段の E2E からは `grepInvert` で外してある (playwright.config.ts)。
 * 手元で見たいときは `npm run shots`。
 */

import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import {
  addFile,
  fileTab,
  login,
  openAccountMenu,
  openEditor,
  openSettings,
  setProjectName,
} from "./helpers";

/** 置き場。gitignore 済み (リポジトリに画像はコミットしない)。 */
const OUT = "e2e/shots";

/** 種として置いてある公開作品 (e2e/seed.sql)。 */
const SEED_AUTHOR = "e2e-author";
const SEED_SKETCH = "E2EPublicSketch0";

/**
 * 動きが落ち着くのを待つ。
 *
 * スケッチは描き続けるので**完全に止まることは無い**。ここで待つのは
 * 「面が出入りするアニメーション」の方で、着いた後の絵の揺れは証跡として問題ない。
 */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(600);
}

test.describe("画面の証跡 @shots", () => {
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  test("エディタ @shots", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openEditor(page);
    // 何もしない画面より、ファイルが増えて名前が付いた画面の方が実態に近い。
    await addFile(page, "helper.js");
    await fileTab(page, "sketch.js").click();
    await setProjectName(page, "tidal-glow-z2w");
    await settle(page);
    await page.screenshot({ path: `${OUT}/01-editor.png` });

    // 上端の帯 (タブ・作品の名前・保存・操作列)。**意匠の差はここに出る**が、
    // 1280 幅のままでは 2px の違いが読めないので切り出す。
    await page.screenshot({
      path: `${OUT}/02-editor-top.png`,
      clip: { x: 0, y: 0, width: 1280, height: 48 },
    });

    await openAccountMenu(page);
    await settle(page);
    await page.screenshot({ path: `${OUT}/03-account-menu.png` });

    await openSettings(page);
    await settle(page);
    await page.screenshot({ path: `${OUT}/04-settings.png` });
  });

  test("狭い画面のエディタ @shots", async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 800 });
    await openEditor(page);
    await settle(page);
    await page.screenshot({ path: `${OUT}/05-editor-narrow.png` });
  });

  test("ログイン後のエディタ @shots", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openEditor(page);
    await login(page);
    await settle(page);
    await page.screenshot({ path: `${OUT}/06-editor-signed-in.png` });
  });

  test("作品ページとギャラリー @shots", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto(`/@${SEED_AUTHOR}/${SEED_SKETCH}`);
    // 実行 iframe が着くまで待つ (空の枠を撮っても何も分からない)。
    await expect(page.locator("iframe")).toBeVisible();
    await settle(page);
    await page.screenshot({ path: `${OUT}/07-sketch-page.png` });

    await page.goto("/");
    await settle(page);
    await page.screenshot({ path: `${OUT}/08-gallery.png`, fullPage: true });
  });
});
