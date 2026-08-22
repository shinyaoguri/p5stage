/**
 * 配信の再検証が拾った中身に、所有の検査を通す (#70)。
 *
 * 保存・取り込み・フォークには前から検査があるが、**配信の裏で走る再検証**には
 * 無かった。作者が gist.github.com で `assets.json` に他人の sha256 を書けば、
 * 閲覧されるだけでその版が R2 と参照台帳に載り、配信 `/a/<sha256>/<name>` は
 * D1 を引かないので実際に配られる (クォータを一切使わずにアセット付きの作品)。
 *
 * 単体テスト側 (`delivery-gate.test.ts`) が見るのは線引きだけ。**再検証が実際に
 * 走って版が止まる**ところは、GitHub から中身が来る道が要るのでここでしか踏めない。
 *
 * 種 (`e2e/seed.sql` / `playwright.config.ts` / `fake-github/viewer.ts`) の作りは
 * 「配信中の版はアセットを使わない中身・偽 GitHub 側だけが壊れた版を持つ・
 * `revision_checked_at` は 0 (= 再検証の間隔を最初から超えている)」。
 */

import { expect, test } from "@playwright/test";

import {
  expectGeneration,
  login,
  openEditor,
  warningIndicator,
} from "./helpers";

/** 種として置いてある作品 (e2e/seed.sql)。持ち主はログインする人。 */
const SKETCH_ID = "E2EBlockedAst001";
const OWNER = "e2e-user";

/** 種が配信している版。断りが効いていればここから動かない。 */
const SEED_REVISION = "e2e1111111111111111111111111111111111111";

test.describe("配信の再検証と所有の検査", () => {
  test("所有していないアセットを参照する版は配信に載らず、作者に知らせが出る", async ({
    page,
  }) => {
    // 1 度目の閲覧で再検証が走る (`waitUntil` なので応答の裏)。この時点の画面は
    // まだ再検証前の版なので、ここでは版を見ない。
    await page.goto(`/@${OWNER}/${SKETCH_ID}`);
    await expect(page.locator("h1")).toHaveText("E2E 壊れたマニフェストの作品");

    // 断りが D1 に着いたことは、作者だけが読める口 (エディタ) で見る。
    // **検査が無ければここは永久に出ない** — 版が進んで正常に見えるため。
    await openEditor(page);
    await login(page);
    await page.goto(`/edit?sketch=${SKETCH_ID}`);
    await expectGeneration(page, 1);

    await expect(warningIndicator(page)).toBeVisible();
    await expect(warningIndicator(page)).toHaveAttribute(
      "aria-label",
      /所有していないアセット/
    );

    // 印が着いている = 再検証は終わっている。配信の版が動いていないことを見る。
    await page.goto(`/@${OWNER}/${SKETCH_ID}`);
    await expect(page.locator(".sketch-page")).toHaveAttribute(
      "data-revision",
      SEED_REVISION
    );
    // 断られた版の中身 (assets.json) も入っていない。
    await expect(
      page.locator('.sketch-file[data-file="assets.json"]')
    ).toHaveCount(0);
  });
});
