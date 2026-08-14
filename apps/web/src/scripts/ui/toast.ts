/**
 * 一過性の知らせ (#41 の 5)。
 *
 * 移植元は canvastage の `showToast()` (`src/toast.ts`)。画面右上に短く出して
 * 自分で消える面で、**出来事の報告だけ**を載せる。
 *
 * 載せるものと載せないものの線引きは「消えても状態が分からなくならないか」。
 *
 * - 載せる … `下書きを復元しました` / `Gist から取り込みました` / 各種の失敗のように、
 *   **もう終わった出来事**の報告。読み逃しても画面の意味は変わらない
 * - 載せない … `未保存の変更があります` / `下書きを保存できません` のように、
 *   **今そうである状態**。消えると気付けないまま書き続けることになるので、
 *   常時見えている場所に残す (行き先は #41 の 6)
 *
 * canvastage から変えた点は 3 つ。理由はそれぞれの箇所に書く。
 */

import "../../styles/toast.css";

export type ToastType = "info" | "success" | "error";

/** 同時に出す上限。溢れたら古い方から畳む。 */
const MAX_VISIBLE = 3;

/**
 * 出したままにする時間。
 *
 * 失敗だけ長い。失敗の文言は「次に何をすればいいか」まで含む
 * (`ログインが切れました。ログインし直してください` など) ので、読み切る時間が要る。
 */
const DURATION_MS: Record<ToastType, number> = {
  info: 4000,
  success: 4000,
  error: 8000,
};

/** 消える動きの長さ。CSS の `toast-exit` と合わせる。 */
const EXIT_MS = 300;

interface LiveToast {
  readonly element: HTMLElement;
  readonly message: string;
  readonly type: ToastType;
  timer: ReturnType<typeof setTimeout> | null;
}

let container: HTMLElement | null = null;

/** 出ている知らせ。古い順に並ぶ (溢れたときに畳む順序でもある)。 */
const live: LiveToast[] = [];

function toastContainer(): HTMLElement {
  if (container !== null && container.isConnected) return container;

  const element = document.createElement("div");
  element.id = "toast-container";
  /*
   * 支援技術へは `polite` で読ませる。
   *
   * 失敗も含めて割り込ませない。ここに出るのは**もう終わった出来事**で、今の操作を
   * 止めてまで読ませるものではない。操作を止める失敗 (取り込みの失敗など) は
   * ダイアログの中の `role="alert"` が別に持っている。
   */
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  document.body.appendChild(element);

  container = element;
  return element;
}

/**
 * 知らせを出す。
 *
 * 同じ文言が既に出ているときは積まずに時間を延ばす。連続で同じ失敗を踏むのは
 * 普通の操作 (使えないファイル名を続けて入れるなど) で、そのたびに積むと画面が
 * 同じ文字で埋まる。
 */
export function showToast(message: string, type: ToastType): void {
  const shown = live.find(
    (toast) => toast.message === message && toast.type === type
  );
  if (shown !== undefined) {
    schedule(shown);
    return;
  }

  const element = document.createElement("div");
  element.className = `toast toast-${type}`;
  // 種別は見た目だけでなく機械にも読めるようにする (E2E が色ではなくここを見る)。
  element.dataset.type = type;
  element.textContent = message;
  toastContainer().appendChild(element);

  const toast: LiveToast = { element, message, type, timer: null };
  live.push(toast);
  schedule(toast);

  // 溢れた分は古い方から畳む。畳んでいる最中のものは `live` から外れているので、
  // 消える動きが終わるのを待たずに数え直せる。
  while (live.length > MAX_VISIBLE) {
    const oldest = live[0];
    if (oldest === undefined) break;
    dismiss(oldest);
  }
}

function schedule(toast: LiveToast): void {
  if (toast.timer !== null) clearTimeout(toast.timer);
  toast.timer = setTimeout(() => dismiss(toast), DURATION_MS[toast.type]);
}

function dismiss(toast: LiveToast): void {
  const index = live.indexOf(toast);
  // 時間切れと溢れの両方から来ることがある。二度目は何もしない。
  if (index === -1) return;
  live.splice(index, 1);

  if (toast.timer !== null) clearTimeout(toast.timer);
  toast.element.classList.add("toast-exit");
  setTimeout(() => toast.element.remove(), EXIT_MS);
}
