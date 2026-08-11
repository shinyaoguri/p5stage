/**
 * 「実行 iframe が本体と別オリジンにある」ことの回帰テスト (要件 5.1 / ADR 0007)。
 *
 * 移植元の canvastage は逆に「同一オリジンであること」を E2E で守っていた。
 * p5stage では主張が反転するので、ここが**その反転を固定する場所**になる。
 * 単体テストでは確かめられない — オリジン境界も、Worker が実際に返すヘッダも、
 * ブラウザに載せて初めて観測できる。
 */

import { expect, test } from "@playwright/test";

import {
  consolePanel,
  expectGeneration,
  openEditor,
  previewFrame,
  runnerFrame,
} from "./helpers";
import { PREVIEW_ORIGIN, WEB_ORIGIN } from "./origins";

test.describe("別オリジン実行", () => {
  test("実行 iframe は本体と別オリジンのランナーを指す", async ({ page }) => {
    await openEditor(page);

    const src = await previewFrame(page).getAttribute("src");
    expect(src).not.toBeNull();

    const frameOrigin = new URL(src as string).origin;
    expect(frameOrigin).toBe(PREVIEW_ORIGIN);
    expect(frameOrigin).not.toBe(new URL(page.url()).origin);
  });

  test("実行 iframe の sandbox と allow は他者コードの前提どおり", async ({
    page,
  }) => {
    await openEditor(page);

    // allow-same-origin は「preview オリジンとして扱う」の意味で、本体オリジンは
    // 与えない。外すと不透明オリジンになり Storage も getUserMedia も使えなくなる。
    await expect(previewFrame(page)).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-same-origin"
    );
    // user activation はクロスオリジンの子フレームへ伝播しないので、
    // 音とカメラは Permissions Policy の委譲で通す。
    const allow = await previewFrame(page).getAttribute("allow");
    for (const feature of ["autoplay", "camera", "microphone"]) {
      expect(allow).toContain(feature);
    }
  });

  test("ランナー文書から本体の DOM には触れられない", async ({ page }) => {
    await openEditor(page);

    // 同一オリジンに戻ってしまうと、他者コードが本体の DOM に届く。
    // 例外になることそのものが、境界が実在する証拠になる。
    const reach = await runnerFrame(page, PREVIEW_ORIGIN).evaluate(() => {
      try {
        return typeof window.parent.document.title === "string"
          ? "reachable"
          : "unknown";
      } catch {
        return "blocked";
      }
    });
    expect(reach).toBe("blocked");
  });

  test("preview は本体以外からの埋め込みを許さない", async ({ request }) => {
    const response = await request.get(`${PREVIEW_ORIGIN}/runner/`);
    expect(response.status()).toBe(200);

    // iframe に載せる前提のオリジンなので X-Frame-Options: DENY は使えない。
    // 埋め込み元は frame-ancestors で本体だけに絞る。
    const headers = response.headers();
    expect(headers["content-security-policy"]).toBe(
      `frame-ancestors ${WEB_ORIGIN}`
    );
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
  });

  test("本体は宛先の違う postMessage を受け付けない", async ({ page }) => {
    await openEditor(page);

    // postMessage は誰でも送れる共有チャネルで、他人のメッセージも同じ口に届く。
    // 本体は origin・source・封筒 (channel) の 3 つで自分宛てだけを選り分ける。

    // (1) 本体オリジンから、ランナーになりすまして送る。
    await page.evaluate(() => {
      window.postMessage(
        {
          channel: "p5stage",
          message: {
            type: "console",
            level: "error",
            message: "なりすました出力",
            timestamp: 0,
          },
        },
        "*"
      );
    });

    // (2) ランナーから、別のチャネルの封筒で送る。origin も source も正しいので、
    // 選り分けられるのは封筒の宛名だけ (同じ口に他人のメッセージが流れてくる)。
    await runnerFrame(page, PREVIEW_ORIGIN).evaluate((webOrigin: string) => {
      window.parent.postMessage(
        {
          channel: "not-p5stage",
          message: {
            type: "console",
            level: "error",
            message: "別チャネルの出力",
            timestamp: 0,
          },
        },
        webOrigin
      );

      // 正しい経路で送った印。これが出た時点で、上の 2 通の配送も終わっている
      // (同じ窓へ送ったメッセージは送った順に処理される)。この 1 通が出ること
      // 自体が、経路が生きている証拠にもなる。
      window.parent.postMessage(
        {
          channel: "p5stage",
          message: {
            type: "console",
            level: "log",
            message: "正しい経路の出力",
            timestamp: 0,
          },
        },
        webOrigin
      );
    }, WEB_ORIGIN);

    await expect(consolePanel(page)).toContainText("正しい経路の出力");
    await expect(consolePanel(page)).not.toContainText("なりすました出力");
    await expect(consolePanel(page)).not.toContainText("別チャネルの出力");

    // 割り込みで状態が壊れていないこと (実行は引き続き通る)。
    await page.locator("#run").click();
    await expectGeneration(page, 2);
  });
});
