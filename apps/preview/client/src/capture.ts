/**
 * 実行中のスケッチから 1 枚絵を撮る (Phase 4-4 / ADR 0019)。
 *
 * **画素に触れられるのはここだけ。** スケッチ文書はランナーと同一オリジンなので
 * (`srcdoc` + `allow-same-origin` — ADR 0007) canvas を直接読めるが、本体は
 * クロスオリジンなので読めない。本体は `capture` と言い、結果の PNG だけを受け取る。
 *
 * 撮れない状況は珍しくない (canvas を作らないスケッチ・外部画像で汚れた canvas)。
 * どれも実行の失敗ではないので、理由を添えて「撮れなかった」を返す。
 */

import { THUMBNAIL_MIME, thumbnailSize } from "@p5stage/shared";

/** 撮影の結果。撮れなければ `image` は null で `reason` が入る。 */
export interface CaptureResult {
  readonly image: Blob | null;
  readonly reason: string | null;
}

function failed(reason: string): CaptureResult {
  return { image: null, reason };
}

/**
 * いちばん大きい canvas を選ぶ。
 *
 * p5 は既定で 1 枚しか作らないが、`createGraphics` を使うスケッチや、
 * ライブラリが計測用の小さな canvas を置くスケッチがある。**作品として見えているのは
 * ふつういちばん大きいもの**なので、面積で選ぶ (見えているかどうかの判定は
 * `display: none` や親の重なりまで見ることになり、ここでは重すぎる)。
 */
export function largestCanvas(doc: Document): HTMLCanvasElement | null {
  let best: HTMLCanvasElement | null = null;
  let bestArea = 0;

  for (const canvas of doc.querySelectorAll("canvas")) {
    const area = canvas.width * canvas.height;
    if (area > bestArea) {
      best = canvas;
      bestArea = area;
    }
  }
  return bestArea > 0 ? best : null;
}

/** canvas を PNG の Blob にする。変換できなければ null。 */
function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), THUMBNAIL_MIME);
  });
}

/**
 * 表示中のスケッチ文書から PNG を作る。
 *
 * WebGL の canvas も読める — p5 は `preserveDrawingBuffer: true` で
 * コンテキストを作るため、描画の直後でなくても中身が残っている。
 */
export async function captureSketch(
  doc: Document | null
): Promise<CaptureResult> {
  if (doc === null) return failed("実行中のスケッチがありません");

  const source = largestCanvas(doc);
  if (source === null) return failed("スケッチに canvas がありません");

  const size = thumbnailSize(source.width, source.height);
  if (size === null) return failed("canvas の大きさを読めません");

  // 縮小先はランナー文書側に作る。スケッチ文書は次の実行で丸ごと捨てられるので、
  // その中に作業用の要素を残さない。
  const target = document.createElement("canvas");
  target.width = size.width;
  target.height = size.height;

  const context = target.getContext("2d");
  if (context === null) return failed("画像を組み立てられませんでした");

  try {
    context.drawImage(source, 0, 0, size.width, size.height);
    const image = await toPngBlob(target);
    // 外部の画像を CORS 無しで読み込んだ canvas は汚染され、読み出しが
    // SecurityError になる。スケッチとしては正常なので、実行は何も変えない。
    return image === null
      ? failed("画像に変換できませんでした")
      : { image, reason: null };
  } catch {
    return failed(
      "canvas の中身を読み出せません (CORS 無しで読み込んだ画像がある可能性があります)"
    );
  }
}
