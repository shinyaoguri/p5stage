/**
 * 画面を最大化する (#87 の段階 1)。
 *
 * エディタは書く場所であると同時に**作品を見せる場所**でもある。ブラウザの
 * タブ・アドレスバー・OS のメニューバーが消えるだけで、同じスケッチが見え方として
 * 別物になるので、その口を 1 つ置く。
 *
 * 広げるのは**本体の文書ごと** (`documentElement`)。実行 iframe だけを全画面に
 * すると、その間はエディタも操作列も触れなくなる。文書ごとなら中の並びは
 * 変わらず、スケッチが広がった分だけ大きく描かれる (`#stage` は `inset: 0`)。
 * iframe 側へ `allow="fullscreen"` を委譲する必要も無い — 子は一緒に広がるだけで、
 * 自分から全画面を要求しはしない。
 *
 * **使えない環境ではボタンを作らない。** iOS Safari は要素の全画面表示に対応せず
 * (`document.fullscreenEnabled` が false)、押しても何も起きないボタンが残る。
 * 押せない理由を説明できない操作は、置かない方が短い。
 */

import { showToast } from "./toast";
import {
  makeToolbarButton,
  setToolbarButtonIcon,
  setToolbarButtonLabel,
} from "./toolbar-button";

/**
 * 全画面ボタンを置く。使えない環境では何も置かず null を返す。
 *
 * 今どちらの状態かは**この関数が覚えない**。`document.fullscreenElement` が正本で、
 * Escape キーやブラウザの UI からも解除されるため、自前の真偽値を持つと実態から
 * ずれる。`fullscreenchange` を聞いて、そのつど DOM から引き直す。
 */
export function mountFullscreenButton(
  host: HTMLElement
): HTMLButtonElement | null {
  if (!document.fullscreenEnabled) return null;

  const button = makeToolbarButton({
    id: "fullscreen",
    icon: "fullscreen",
    label: "全画面表示",
    onClick: () => void toggle(),
  });

  const render = (): void => {
    const on = document.fullscreenElement !== null;
    setToolbarButtonIcon(button, on ? "exitFullscreen" : "fullscreen");
    setToolbarButtonLabel(button, on ? "全画面表示を終わる" : "全画面表示");
    // 全画面の間は押されたままに見せる (他の面を開くボタンと同じ扱い)。
    button.classList.toggle("is-active", on);
    // 今どちらかは意匠ではなく構造で読めるようにする (E2E は四隅の向きではなく
    // こちらを見る — project-bar の `data-running` と同じ流儀)。
    button.dataset.fullscreen = String(on);
  };

  document.addEventListener("fullscreenchange", render);
  render();
  host.appendChild(button);
  return button;
}

/**
 * 全画面の出入り。
 *
 * 断られたことは**もう終わった出来事**なのでトーストで言う (#41 の 5)。もう一度
 * 押せば済むもので、直すまで続く条件ではない。
 */
async function toggle(): Promise<void> {
  try {
    if (document.fullscreenElement === null) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch {
    showToast("全画面表示に切り替えられませんでした", "error");
  }
}
