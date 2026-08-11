/**
 * スケッチを埋め込む iframe の属性。
 *
 * 本体 → ランナー → スケッチと iframe が 2 段になる (ADR 0007)。両段が同じ値を使えるよう
 * ここに置く。
 *
 * 末端まで届くかを分けているのは **1 段目 (本体 → ランナー) の委譲だけ**で、これを外すと
 * 音もカメラも死ぬ。2 段目は `srcdoc` で親と同一オリジンになり、既定の allowlist (`self`)
 * で親の許可をそのまま継承するため、実測では無くても届く。それでも書いておくのは、
 * 実行文書の作り方 (`srcdoc` をやめて別 URL にするなど) を変えた瞬間に黙って死ぬのを
 * 防ぐため。実際の届き方は `e2e/permissions.spec.ts` で押さえている。
 */

/**
 * sandbox。`allow-same-origin` は「preview オリジンとして扱う」の意味で、
 * 本体オリジンは与えない。外すと不透明オリジンになり getUserMedia も Storage も使えず、
 * p5 の多くの機能が壊れる。
 */
export const SKETCH_SANDBOX = "allow-scripts allow-same-origin";

/**
 * allow (Permissions Policy の委譲)。
 *
 * user activation はクロスオリジンの子フレームへ伝播しないため、Web Audio を
 * 鳴らすには `autoplay` の委譲が要る。実測では、これがあれば**本体側のクリック**
 * (実行ボタンなど) だけでスケッチの AudioContext が `running` で始まる。
 * iframe 内に「クリックで開始」のオーバーレイを置く必要は無い。
 *
 * カメラ・マイクは p5 の capture 系で使う。既定の allowlist が `self` なので、
 * 委譲しなければ別オリジンのスケッチでは `NotAllowedError` になる。
 */
export const SKETCH_ALLOW = [
  "autoplay",
  "camera",
  "microphone",
  "midi",
  "accelerometer",
  "gyroscope",
  "xr-spatial-tracking",
].join("; ");
