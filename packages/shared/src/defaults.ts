/**
 * 新規スケッチの初期内容。
 *
 * p5.js は当面 CDN から読み込む (移植元の canvastage と同じ)。preview オリジンへの
 * 同梱とバージョン固定は Phase 1 の課題として Issue #11 に残している。
 */

import { ENTRY_FILE, type SketchFiles } from "./files";

/** 既定テンプレートが読み込む p5.js。 */
export const P5_CDN_URL = "https://cdn.jsdelivr.net/npm/p5@1/lib/p5.min.js";

const DEFAULT_HTML = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <title>sketch</title>
    <script src="${P5_CDN_URL}"></script>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <script src="sketch.js"></script>
  </body>
</html>
`;

const DEFAULT_CSS = `html,
body {
  margin: 0;
  padding: 0;
  overflow: hidden;
}
`;

const DEFAULT_JS = `function setup() {
  createCanvas(windowWidth, windowHeight);
}

function draw() {
  background(20);
  noStroke();
  fill(255, 120, 160);
  circle(width / 2, height / 2, 120 + sin(frameCount * 0.05) * 40);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
`;

/** 新規スケッチの既定ファイル。 */
export const DEFAULT_SKETCH_FILES: SketchFiles = {
  [ENTRY_FILE]: DEFAULT_HTML,
  "style.css": DEFAULT_CSS,
  "sketch.js": DEFAULT_JS,
};
