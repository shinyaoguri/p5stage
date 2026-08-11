/**
 * スケッチを埋め込む iframe の属性。
 *
 * 本体 → ランナー → スケッチと iframe が 2 段になる (ADR 0007)。Permissions Policy は
 * 各段で委譲しないと末端まで届かないため、両者が同じ値を使えるようここに置く。
 */

/**
 * sandbox。`allow-same-origin` は「preview オリジンとして扱う」の意味で、
 * 本体オリジンは与えない。外すと不透明オリジンになり getUserMedia も Storage も使えず、
 * p5 の多くの機能が壊れる。
 */
export const SKETCH_SANDBOX = "allow-scripts allow-same-origin";

/**
 * allow (Permissions Policy の委譲)。
 * user activation はクロスオリジンの子フレームへ伝播しないため、Web Audio を
 * 鳴らすには `autoplay` の委譲が要る。カメラ・マイクは p5 の capture 系で使う。
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
