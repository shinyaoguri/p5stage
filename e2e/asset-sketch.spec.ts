/**
 * 通しの E2E (Phase 3-6) — **p5 が実際にアセットを読む**。
 *
 * Phase 3 の完了条件は「画像・3D モデルを使う作品が保存・閲覧まで通る」で、
 * ここがその最後の 1 本。他のアセット系 spec との違いは、**p5 の API
 * (`loadImage` / `loadModel`) を通ること**にある。
 *
 * - `assets.spec.ts` — 受け口と配信 (`/a/<sha256>/<name>`) と、素の `<img src>` /
 *   `new Image()` への代入までを見る。p5 は登場しない
 * - `asset-panel.spec.ts` — 持ち込みの UI と `assets.json` への書き戻しを見る
 * - ここ — 持ち込んだアセットを **p5 が読んで描く**ところまでを、エディタと
 *   作品ページの両方で見る
 *
 * 3-3 の実装は p5 の中身を読んだ上で組んである (GIF 判定の `fetch` の後に
 * `img.src` へ元のパスを渡す / `loadModel` はパスの末尾 4 文字で形式を決める —
 * ADR 0014)。**その前提が崩れたことは、p5 を実際に通さないと分からない。**
 *
 * 確認は**画素**で行う。「読めた」ではなく「正しい中身が正しい向きで描かれた」まで
 * 見たいのと、canvas から画素を読めること自体が配信の CORS
 * (`Access-Control-Allow-Origin: *`) が効いていることの確認になるため
 * (taint された canvas は読めない)。
 *
 * 過去リビジョン再現は `asset-gc.spec.ts`「一度でも保存した作品が使った実体は、
 * 外して手放した後も残る」が blob 側で見ている (旧リビジョンを描き直す UI は
 * Phase 4)。ここでは重ねない。
 *
 * ローカルの D1 / R2 は `--persist-to` で実行をまたいで残る。中身が同じなら sha256 も
 * 同じで「まだ無い」状態を作れないため、**持ち込む中身は毎回変える**。
 */

import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { FAKE_VIEWER } from "./fake-github/viewer";
import {
  closeAssets,
  assetRow,
  login,
  openAssets,
  openEditor,
  saveNewSketch,
  typeIntoEditor,
} from "./helpers";

/** 2x1 の PNG。左が赤 (255,0,0)・右が青 (0,0,255)。 */
const DOT_PNG = readFileSync(
  fileURLToPath(new URL("fixtures/dot.png", import.meta.url))
);

/** 一辺 1 の立方体 (原点中心)。 */
const CUBE_OBJ = readFileSync(
  fileURLToPath(new URL("fixtures/cube.obj", import.meta.url)),
  "utf8"
);

/** 画素 1 つ (RGBA)。 */
type Pixel = [number, number, number, number];

const RED: Pixel = [255, 0, 0, 255];
const BLUE: Pixel = [0, 0, 255, 255];
const GREEN: Pixel = [0, 255, 0, 255];
const BLACK: Pixel = [0, 0, 0, 255];

interface Upload {
  readonly name: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
}

/**
 * 毎回違う中身の PNG。
 *
 * 種の PNG の**後ろ**に乱数を足す。PNG の復号は `IEND` で終わるので画像としては
 * そのまま読め (画素の確認に要る)、鍵だけが毎回変わる。
 */
function pngUpload(): Upload {
  return {
    name: "cat.png",
    mimeType: "image/png",
    buffer: Buffer.concat([DOT_PNG, randomBytes(16)]),
  };
}

/** 毎回違う中身の OBJ。テキストなので、乱数はコメント行で足せる。 */
function objUpload(): Upload {
  return {
    name: "cube.obj",
    mimeType: "model/obj",
    buffer: Buffer.from(`${CUBE_OBJ}# ${randomUUID()}\n`, "utf8"),
  };
}

/** 画面から持ち込む (`asset-panel.spec.ts` と同じ道)。 */
async function bringIn(page: Page, upload: Upload): Promise<void> {
  await openAssets(page);
  await page.locator("#assets-picker").setInputFiles(upload);
  await expect(assetRow(page, upload.name)).toBeVisible();
  await closeAssets(page);
}

/**
 * スケッチが描いた canvas から画素を読む。
 *
 * 位置は**画素数ではなく比率**で指定する。p5 は `pixelDensity` の分だけ実体を
 * 大きく持つので、比率で指しておけば密度が変わっても同じ場所を指せる。
 *
 * WEBGL では原点が左下 (`readPixels`) で 2D は左上。**上下の対称な場所だけを
 * 指す**ことで、呼ぶ側がその違いを気にせずに済む形にしてある。
 *
 * 中身のあるスケッチ文書が見つからないうちは null (ランナーはダブルバッファで、
 * 表に出ていない側は空になっている)。**読めなかった理由は文字列で返す** — 配信の
 * CORS が落ちると canvas が taint されて `getImageData` が投げるので、それを
 * 「まだ描かれていない」と混ぜると、待ち時間切れの形でしか気付けなくなる。
 */
async function readPixels(
  page: Page,
  points: readonly (readonly [number, number])[]
): Promise<Pixel[] | string | null> {
  for (const frame of page.frames()) {
    if (frame.url() !== "about:srcdoc") continue;
    try {
      const pixels = await frame.evaluate((spots) => {
        const canvas = document.querySelector("canvas");
        if (canvas === null) return null;

        const at = (ratioX: number, ratioY: number): [number, number] => [
          Math.floor(canvas.width * ratioX),
          Math.floor(canvas.height * ratioY),
        ];

        try {
          // 2D の canvas に webgl を、その逆を訊くと null が返る (例外にはならない)。
          const flat = canvas.getContext("2d");
          if (flat !== null) {
            return spots.map(([ratioX, ratioY]) => {
              const [x, y] = at(ratioX, ratioY);
              return Array.from(flat.getImageData(x, y, 1, 1).data);
            });
          }

          const gl = (canvas.getContext("webgl2") ??
            canvas.getContext("webgl")) as WebGLRenderingContext | null;
          if (gl === null) return null;
          return spots.map(([ratioX, ratioY]) => {
            const [x, y] = at(ratioX, ratioY);
            const out = new Uint8Array(4);
            gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
            return Array.from(out);
          });
        } catch (error) {
          return String(error);
        }
      }, points);
      if (pixels !== null) return pixels as Pixel[] | string;
    } catch {
      // 差し替えの途中でフレームが外れた。次の呼び出しで見直す。
    }
  }
  return null;
}

/** 画像を読むスケッチ (Monaco の自動閉じと喧嘩しないよう 1 行で書く)。 */
const IMAGE_SKETCH =
  'let sketchImage; function preload(){ sketchImage = loadImage("cat.png"); }' +
  " function setup(){ createCanvas(120,120); noSmooth(); noLoop(); }" +
  " function draw(){ background(0); image(sketchImage,0,0,width,height); }";

/**
 * 3D モデルを読むスケッチ。
 *
 * 色は `fill()` で置く。**`normalMaterial()` は使えない** — p5 の OBJ パーサは
 * `vn` を持たないファイルに法線を計算せず、零ベクトルのまま残すので、面が真っ黒に
 * なる (実測。種に `vn` を足す手もあるが、確かめたいのは配信であって陰影ではない)。
 */
const MODEL_SKETCH =
  'let sketchModel; function preload(){ sketchModel = loadModel("cube.obj"); }' +
  " function setup(){ createCanvas(120,120,WEBGL); noLoop(); }" +
  " function draw(){ background(0); noStroke(); fill(0,255,0); scale(45); model(sketchModel); }";

/** 画像スケッチを見る位置 — 左寄り・右寄り (縦は中央)。 */
const IMAGE_POINTS = [
  [0.2, 0.5],
  [0.8, 0.5],
] as const;

/** モデルスケッチを見る位置 — 中央 (立方体) と隅 (背景)。 */
const MODEL_POINTS = [
  [0.5, 0.5],
  [0.05, 0.05],
] as const;

/**
 * 書いたスケッチを実行する。
 *
 * 世代の番号では待たない — アセットを持ち込んだ時点で実行が起きることがあり、
 * 何番になるかは経緯で変わる。**描かれた画素**で待つ方が、確かめたいものに近い。
 */
async function runSketch(page: Page, code: string): Promise<void> {
  await typeIntoEditor(page, code);
  await page.keyboard.press("ControlOrMeta+Enter");
}

/** 別のブラウザコンテキスト (cookie を持たない = 通りすがりの閲覧者)。 */
async function viewAsGuest(
  browser: Browser,
  sketchId: string,
  read: (page: Page) => Promise<void>
): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`/s/${sketchId}`);
    // 正典 URL へ 302 で寄る (ADR 0011)。作者は偽 GitHub がログインさせた人。
    expect(new URL(page.url()).pathname).toBe(
      `/@${FAKE_VIEWER.login}/${sketchId}`
    );
    await read(page);
  } finally {
    await context.close();
  }
}

test.describe("p5 がアセットを読む", () => {
  test("持ち込んだ画像を loadImage が読み、閲覧者の画面でも同じものが描かれる", async ({
    browser,
    page,
  }) => {
    await openEditor(page);
    await login(page);
    await bringIn(page, pngUpload());

    await runSketch(page, IMAGE_SKETCH);

    // 左が赤・右が青。読めただけなら向きの取り違えに気付けないので、
    // **左右で違う色の種**を使って中身まで見る。
    await expect
      .poll(() => readPixels(page, IMAGE_POINTS), {
        message: "エディタで画像が描かれていません",
        timeout: 20_000,
      })
      .toEqual([RED, BLUE]);

    const sketchId = await saveNewSketch(
      page,
      `画像 ${randomUUID()}`,
      "public"
    );

    await viewAsGuest(browser, sketchId, async (guest) => {
      await expect
        .poll(() => readPixels(guest, IMAGE_POINTS), {
          message: "作品ページで画像が描かれていません",
          timeout: 20_000,
        })
        .toEqual([RED, BLUE]);
    });
  });

  test("持ち込んだ 3D モデルを loadModel が読み、閲覧者の画面でも描かれる", async ({
    browser,
    page,
  }) => {
    await openEditor(page);
    await login(page);
    await bringIn(page, objUpload());

    await runSketch(page, MODEL_SKETCH);

    // 中央には立方体の面が出ていて、隅は背景のまま。**隅まで見る**のは、
    // canvas が丸ごと塗り潰されているだけの状態と区別するため
    // (モデルが読めていなくても背景色だけは塗られる)。
    await expect
      .poll(() => readPixels(page, MODEL_POINTS), {
        message: "エディタで 3D モデルが描かれていません",
        timeout: 20_000,
      })
      .toEqual([GREEN, BLACK]);

    const sketchId = await saveNewSketch(
      page,
      `モデル ${randomUUID()}`,
      "public"
    );

    await viewAsGuest(browser, sketchId, async (guest) => {
      await expect
        .poll(() => readPixels(guest, MODEL_POINTS), {
          message: "作品ページで 3D モデルが描かれていません",
          timeout: 20_000,
        })
        .toEqual([GREEN, BLACK]);
    });
  });
});
