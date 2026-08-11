/**
 * 再実行のトランジション (要件 3.1)。
 *
 * 実際に動かすのはランナー側のダブルバッファ 2 枚 (ADR 0007) だが、演出の一覧は
 * 本体の設定 UI にも要り、id は postMessage を渡って来るので検証も要る。
 * そのため**レジストリは共有パッケージに置き、DOM を触らない宣言で持つ**。
 *
 * 移植元は canvastage の transitions.ts。あちらは `setup()` / `run()` が
 * `HTMLElement` を直接いじる手続きだったが、ここでは「初期スタイル + keyframes」の
 * データに変えた。適用する層 (ランナー) と決める層 (本体・プロトコル) を分けられ、
 * 演出の中身をブラウザ無しで検証できる。
 *
 * 新しい演出はこのレジストリに足すだけで設定の選択肢に並ぶ。
 */

/**
 * レイヤ (スケッチ 1 枚) の初期スタイル。遷移を始める前に当てる。
 * 触るプロパティを絞ってあるのは、遷移が終わった後に確実に中立へ戻すため。
 */
export interface LayerStyle {
  readonly zIndex?: string;
  readonly opacity?: string;
  readonly transform?: string;
  readonly clipPath?: string;
}

/**
 * 演出の 1 コマ。Web Animations API の `Keyframe` に渡せる形だが、型はここで
 * 自前に持つ。このパッケージは Workers からも読まれ、そちらには DOM の型が無い。
 */
export type LayerKeyframe = Readonly<Record<string, string | number>>;

/** レイヤ 1 枚の振る舞い。keyframes が null なら初期スタイルのまま動かさない。 */
export interface LayerPlan {
  readonly setup: LayerStyle;
  readonly keyframes: readonly LayerKeyframe[] | null;
}

/**
 * 遷移の設計図。
 *
 * outgoing は今表示しているレイヤ、incoming はこれから出すレイヤ。
 *
 * 重要: incoming はロード直後でまだ最初の 1 フレームを描けていないことがある。
 * incoming を上に出す演出 (cover 系) は一瞬黒く見えうるため、露出 (reveal) 系は
 * 描画済みの outgoing を上に置いて剥がす方式にする。
 */
export interface TransitionPlan {
  readonly outgoing: LayerPlan;
  readonly incoming: LayerPlan;
}

export interface PreviewTransition {
  readonly id: string;
  readonly name: string;
  readonly plan: TransitionPlan;
}

/** 動かさないレイヤ。 */
const STILL: LayerPlan = { setup: {}, keyframes: null };

/** クロスフェード (ディゾルブ)。incoming を上に重ね、入れ替わりにフェードする。 */
const dissolve: PreviewTransition = {
  id: "dissolve",
  name: "ディゾルブ",
  plan: {
    outgoing: { setup: {}, keyframes: [{ opacity: 1 }, { opacity: 0 }] },
    incoming: {
      setup: { zIndex: "1", opacity: "0" },
      keyframes: [{ opacity: 0 }, { opacity: 1 }],
    },
  },
};

/**
 * ワイプ (露出系)。描画済みの outgoing を上に置いて削り、下で待つ incoming を露出する。
 *
 * outgoing を左から削る (inset の left を伸ばす) と境界は左→右へ動き、incoming は
 * 左から現れる = 「右へのワイプ」。右から削れば逆になる。
 */
function makeWipe(
  id: string,
  name: string,
  fromLeft: boolean
): PreviewTransition {
  const end = fromLeft ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)";
  return {
    id,
    name,
    plan: {
      outgoing: {
        setup: { zIndex: "1" },
        keyframes: [{ clipPath: "inset(0 0 0 0)" }, { clipPath: end }],
      },
      incoming: { setup: { zIndex: "0" }, keyframes: null },
    },
  };
}

/**
 * スライド (カバー系)。incoming を画面外から滑り込ませる。
 * outgoing は動かさない (動かすと下のスケッチまでずれて見える)。名前は動く向き。
 */
function makeSlide(
  id: string,
  name: string,
  startX: string
): PreviewTransition {
  return {
    id,
    name,
    plan: {
      outgoing: STILL,
      incoming: {
        setup: { zIndex: "1", transform: `translateX(${startX})` },
        keyframes: [
          { transform: `translateX(${startX})` },
          { transform: "translateX(0)" },
        ],
      },
    },
  };
}

/** incoming が少し縮みながらフェードインする。 */
const zoom: PreviewTransition = {
  id: "zoom",
  name: "ズーム",
  plan: {
    outgoing: { setup: {}, keyframes: [{ opacity: 1 }, { opacity: 0 }] },
    incoming: {
      setup: { zIndex: "1", opacity: "0", transform: "scale(1.06)" },
      keyframes: [
        { opacity: 0, transform: "scale(1.06)" },
        { opacity: 1, transform: "scale(1)" },
      ],
    },
  },
};

const TRANSITIONS: readonly PreviewTransition[] = [
  dissolve,
  makeSlide("slide-left", "スライド (左へ)", "100%"),
  makeSlide("slide-right", "スライド (右へ)", "-100%"),
  makeWipe("wipe-left", "ワイプ (左へ)", false),
  makeWipe("wipe-right", "ワイプ (右へ)", true),
  zoom,
];

const BY_ID = new Map(
  TRANSITIONS.map((transition) => [transition.id, transition])
);

/** 演出なし (即時切替) を表す id。 */
export const NO_TRANSITION = "none";

/**
 * 既定の演出。
 *
 * canvastage は "none" が既定だが、p5stage は書き換えるたびに再実行するライブ
 * コーディングが中心で、切り替わりの瞬間を演出で埋めたほうが読み込みの間が目立たない。
 * 向きを持たないディゾルブなら、どんなスケッチの上でも文脈を壊さない。
 */
export const DEFAULT_TRANSITION_ID = dissolve.id;

/** 既定の長さ。長いと次の書き換えを待たせるので、視認できる最短寄りにする。 */
export const DEFAULT_TRANSITION_MS = 400;

/** 長さの下限・上限。上限は「実行が止まったように見えない」範囲で切る。 */
export const MIN_TRANSITION_MS = 100;
export const MAX_TRANSITION_MS = 2000;

/** 演出の緩急。canvastage から引き継ぐ (Material の standard curve)。 */
export const TRANSITION_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

/** 設定 UI 用の選択肢。先頭は「なし」= 即時切替。 */
export const TRANSITION_OPTIONS: readonly {
  readonly value: string;
  readonly label: string;
}[] = [
  { value: NO_TRANSITION, label: "なし" },
  ...TRANSITIONS.map((transition) => ({
    value: transition.id,
    label: transition.name,
  })),
];

/** id が既知の演出か (「なし」は含まない)。 */
export function isTransitionId(value: unknown): value is string {
  return typeof value === "string" && BY_ID.has(value);
}

/** 演出を引く。「なし」や未知の id なら null。 */
export function getTransition(id: string): PreviewTransition | null {
  return BY_ID.get(id) ?? null;
}

/** 長さを扱える範囲に丸める。範囲外の値でも実行そのものは止めない。 */
export function clampTransitionMs(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return DEFAULT_TRANSITION_MS;
  return Math.min(MAX_TRANSITION_MS, Math.max(MIN_TRANSITION_MS, durationMs));
}
