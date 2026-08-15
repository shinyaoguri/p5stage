/**
 * 右上の操作列に並べるアイコンボタン (#41 の 2)。
 *
 * 移植元は canvastage の `ICONS` / `makeToolbarButton()` (`src/main.ts`)。
 * スケッチの上に重なる面なので、操作系は枠付きのテキストではなく**薄いアイコン**に
 * して、下の絵をできるだけ隠さない。
 *
 * **アイコンだけのボタンは名前を持たない。** 支援技術には「ボタン」としか読まれず、
 * マウスでも何のボタンか分からない。`title` (ホバー) と `aria-label` (支援技術) の
 * 両方を必ず与え、SVG 自体は `aria-hidden` で読み上げから外す。ここを組み立てで
 * 強制するために、素の `<button>` を各パネルが作るのをやめてこの関数へ寄せる。
 */

import "../../styles/toolbar-button.css";

/**
 * アイコン。
 *
 * 24×24 の viewBox に線で描く Feather 風 (canvastage と同じ流儀)。実際の描画は
 * 16px なので、細部を足しても潰れる。`currentColor` で描き、色は CSS が決める。
 * GitHub のマークだけは公式の塗り潰しなので 16×16 / `fill`。
 */
export const ICONS = {
  /** 保存。 */
  save: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
    <polyline points="17 21 17 13 7 13 7 21"/>
    <polyline points="7 3 7 8 15 8"/>
  </svg>`,
  /** 新しいスケッチ。 */
  newSketch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="12" y1="18" x2="12" y2="12"/>
    <line x1="9" y1="15" x2="15" y2="15"/>
  </svg>`,
  /** 外から取り込む。 */
  import: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>`,
  /** 紐付けを外す (切れた鎖)。 */
  unlink: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 7h3a5 5 0 0 1 4.24 7.66"/>
    <path d="M9 17H6A5 5 0 0 1 6 7h1"/>
    <line x1="3" y1="3" x2="21" y2="21"/>
  </svg>`,
  /** 設定。 */
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>`,
  /** 全画面表示にする (外を向いた四隅)。 */
  fullscreen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
  </svg>`,
  /** 全画面表示を終わる (内を向いた四隅)。 */
  exitFullscreen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
  </svg>`,
  /** GitHub のマーク (公式の形なので塗り潰し)。 */
  github: `<svg viewBox="0 0 16 16" fill="currentColor" stroke="none">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
  </svg>`,
  /** 実行 (塗り潰しの三角。線で描くと 12px では潰れる)。 */
  play: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="6,3 20,12 6,21"/>
  </svg>`,
  /** 停止。 */
  stop: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <rect x="5" y="5" width="14" height="14" rx="2"/>
  </svg>`,
  /** 人 (アバターが読めないときの代わり)。 */
  person: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>`,
  /** 外の面を開く (作品ページ)。 */
  externalLink: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
  </svg>`,
  /** 直すまで続く条件 (#41 の 6)。 */
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>`,
  /**
   * アセット (Phase 3-4)。
   *
   * 絵は画像だが、指すのは画像だけではない (音声・3D モデル・データ・フォント)。
   * それでも額縁の絵にするのは、**いちばん多く持ち込まれるのが画像**で、
   * 一覧に並ぶのもその見本だから。
   */
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>`,
  /** タグ (Phase 5)。荷札。 */
  tag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
    <line x1="7" y1="7" x2="7.01" y2="7"/>
  </svg>`,
} as const;

export type IconName = keyof typeof ICONS;

export interface ToolbarButtonOptions {
  /**
   * 何のボタンか。`title` と `aria-label` の両方になる。**省略できない**。
   *
   * ここに入れるのは**押すと何が起きるか**だけ。「今どうなっているか」は入れない —
   * 状態はアイコン自身が色とドットで示し (#41 の 6)、読み上げには
   * `aria-describedby` で別に渡す。名前に混ぜると `保存 (保存しました (8/14 18:03))`
   * のような入れ子になり、ホバーするたび読まされる。
   */
  readonly label: string;
  readonly icon: IconName;
  readonly id?: string;
  readonly onClick?: () => void;
}

/** 操作列のアイコンボタンを作る。 */
export function makeToolbarButton(
  options: ToolbarButtonOptions
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "toolbar-btn";
  if (options.id !== undefined) button.id = options.id;
  setToolbarButtonIcon(button, options.icon);
  setToolbarButtonLabel(button, options.label);
  if (options.onClick !== undefined) {
    button.addEventListener("click", options.onClick);
  }
  return button;
}

export interface ToolbarLinkOptions {
  /** どこへ行くか。`title` と `aria-label` の両方になる。**省略できない**。 */
  readonly label: string;
  readonly icon: IconName;
  readonly id?: string;
}

/**
 * 操作列のアイコンリンクを作る。
 *
 * 行き先 (作品ページ・Gist) は**文字で名乗らせない**。操作列は他がすべてアイコン
 * なので、そこだけ文字が並ぶと列が途切れて見える。押す先が外部の面であることは
 * 絵で示し、名前はホバーと読み上げが持つ。
 *
 * ボタンと同じ見た目 (`.toolbar-btn`) に乗せるが、**リンクはリンクのまま**にする —
 * 別のタブで開く・URL をコピーするといった、リンクにしかできない操作が要る。
 */
export function makeToolbarLink(
  options: ToolbarLinkOptions
): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "toolbar-btn";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  if (options.id !== undefined) link.id = options.id;
  setToolbarButtonIcon(link, options.icon);
  setToolbarButtonLabel(link, options.label);
  return link;
}

/** 操作列に並ぶもの (アイコンボタンとアイコンリンク)。 */
type ToolbarElement = HTMLButtonElement | HTMLAnchorElement;

/**
 * ボタンの名前を差し替える。
 *
 * `title` と `aria-label` は必ず一緒に動かす。片方だけ変えると、見えている説明と
 * 読み上げが食い違う。
 */
export function setToolbarButtonLabel(
  button: ToolbarElement,
  label: string
): void {
  button.title = label;
  button.setAttribute("aria-label", label);
}

/** ボタンの絵を差し替える。名前は `aria-label` が持つので SVG は読み上げから外す。 */
export function setToolbarButtonIcon(
  button: ToolbarElement,
  icon: IconName
): void {
  button.innerHTML = ICONS[icon];
  button.querySelector("svg")?.setAttribute("aria-hidden", "true");
}
