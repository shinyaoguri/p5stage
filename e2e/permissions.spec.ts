/**
 * 「スケッチが音とカメラを使える」ことの回帰テスト (Issue #11 の未検証課題)。
 *
 * 別オリジン化で新しく生まれた懸念がここにある。user activation は**クロスオリジンの
 * 子フレームへ伝播しない**ので、本体でボタンを押しただけでは、そのままではスケッチの
 * AudioContext は動き出さない。カメラ・マイクも Permissions Policy の既定 allowlist が
 * `self` なので、委譲しなければ別オリジンの子には届かない。
 *
 * `SKETCH_ALLOW` (`@p5stage/shared`) はこれを通すための委譲で、効いているかは実ブラウザで
 * しか分からない (単体テストで見えるのは「属性に文字列が入っていること」まで)。
 * 効き目を握るのは **1 段目 (本体 → ランナー) のクロスオリジン境界**で、2 段目は
 * `srcdoc` が親の許可を継承するため外しても届く。だから対照実験は 1 段目を剥がす。
 *
 * 測り方に 2 つ落とし穴がある。
 *
 * - **`page.evaluate` は user gesture 付きで走る**。evaluate の中で AudioContext を
 *   作ると、委譲が切れていても `running` になり、何も検証できない。値はスケッチ自身の
 *   スクリプトから `console.log` して、コンソールブリッジ越しに読む
 * - **Playwright の Chromium は既定で autoplay を無条件に許す**。実機と同じ
 *   `document-user-activation-required` (デスクトップ Chrome の既定) を明示しないと、
 *   委譲が切れていても `running` になる
 */

import { expect, test } from "@playwright/test";

import {
  consolePanel,
  expectGeneration,
  openEditor,
  typeIntoEditor,
} from "./helpers";

test.use({
  launchOptions: {
    args: [
      // 実機のデスクトップ Chrome と同じ autoplay policy。
      "--autoplay-policy=document-user-activation-required",
      // 実デバイスの代わり。許可の可否は Permissions Policy が握るので、
      // 「委譲が切れていれば失敗する」という検証はこの下でも成立する。
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
  permissions: ["camera", "microphone"],
});

/**
 * スケッチとして流し込むコード。委譲の届き方を 3 つの角度から出力する。
 *
 * `typeIntoEditor` は Monaco へ実際に打鍵するので、改行を含まない 1 行に収める
 * (自動インデントと括弧の自動補完でずれるため)。
 */
const PROBE = [
  "const p = document.featurePolicy;",
  'console.log("policy:" + ["autoplay","camera","microphone"].map((f) => f + "=" + p.allowsFeature(f)).join(","));',
  'console.log("audio:" + new AudioContext().state);',
  'navigator.mediaDevices.getUserMedia({ video: true }).then((s) => { console.log("camera:tracks=" + s.getVideoTracks().length); s.getTracks().forEach((t) => t.stop()); }, (e) => console.log("camera:" + e.name));',
].join(" ");

/**
 * プローブを流し込んで実行する。
 *
 * 実行の口 (`#run` ボタン) を押すこと自体が**本体オリジンでの user activation** に
 * なる。スケッチが音を鳴らせるかは、まさにこの activation が越境するかの話なので、
 * 「ボタンを押して実行する」という普段どおりの操作がそのまま検証条件になる。
 */
async function runProbe(page: import("@playwright/test").Page): Promise<void> {
  await typeIntoEditor(page, PROBE);
  await page.locator("#run").click();
  await expect(consolePanel(page)).toContainText("policy:");
}

test.describe("スケッチへの権限委譲", () => {
  test("Permissions Policy はスケッチ文書まで届く", async ({ page }) => {
    await openEditor(page);
    await runProbe(page);

    // 本体 → ランナー → スケッチと 2 段越えた先で見た値。
    // 1 段目の委譲を落とすと、ここが揃って false になる。
    await expect(consolePanel(page)).toContainText(
      "policy:autoplay=true,camera=true,microphone=true"
    );
  });

  test("本体側の操作だけでスケッチの AudioContext が動き出す", async ({
    page,
  }) => {
    await openEditor(page);
    await runProbe(page);

    // スケッチ文書は一度も触られていない。それでも `running` で始まるのは、
    // 本体の user activation が `allow="autoplay"` 越しに届いているから。
    // ここが `suspended` なら、鳴らすために iframe 内へ「クリックで開始」の
    // オーバーレイを置く必要が出る (Issue #11 で備えとして挙げていた案)。
    await expect(consolePanel(page)).toContainText("audio:running");
  });

  test("スケッチから getUserMedia でカメラを取れる", async ({ page }) => {
    await openEditor(page);
    await runProbe(page);

    // p5 の createCapture が通る条件。委譲が無ければ NotAllowedError になる。
    await expect(consolePanel(page)).toContainText("camera:tracks=1");
  });

  test("委譲を外すと音もカメラも届かなくなる", async ({ page }) => {
    await openEditor(page);

    // 対照実験。上の 3 本が「たまたま通っている」のではなく `allow` のおかげだと
    // 確かめる。1 段目 (本体が置くランナーの iframe) から委譲を剥がすと、2 段目が
    // どれだけ丁寧に委譲しても末端には届かない。ここを崩さずに書ける形が無いので、
    // テストから DOM を直接触る唯一の場所になっている。
    await page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>(
        "#stage iframe.preview-frame"
      );
      if (frame === null) throw new Error("実行 iframe が見つかりません");
      // 属性が効くのは読み込みの時点なので、剥がしてから同じ URL を入れ直す。
      const url = frame.src;
      frame.setAttribute("allow", "");
      frame.src = url;
    });
    // 読み込み直したランナーと本体が握手し直すのを待つ (#1 の再実行)。
    await expectGeneration(page, 1);

    await runProbe(page);

    await expect(consolePanel(page)).toContainText(
      "policy:autoplay=false,camera=false,microphone=false"
    );
    await expect(consolePanel(page)).toContainText("audio:suspended");
    await expect(consolePanel(page)).toContainText("camera:NotAllowedError");
  });
});
