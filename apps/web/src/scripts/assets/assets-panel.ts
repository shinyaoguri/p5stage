/**
 * 作品のアセットを扱うパネル。画面右端から出入りするドロワー (Phase 3-4)。
 *
 * 出入りと `inert` の作法は設定パネル (#41 の 4) と同じ。**開いている間だけ場所を
 * 取り、閉じればアイコンだけになる**面で、コードを見ながらアセットの名前を
 * 確かめられるようにする (モーダルにすると確かめたい相手が隠れる)。
 *
 * 映すのは `assets.json` そのもので、パネルは写しを持たない — 開くたびに今の
 * ファイル構成から読み直す。手で編集する道は 3-2 が意図して残してあり、写しを
 * 正にすると手で直した内容を次の操作で踏み潰す (詳細は assets/manifest-edit.ts)。
 *
 * 落とす先は**画面のどこでもよい**。ドロワーの中だけで受けると、閉じているときに
 * 落としたファイルをブラウザがそのまま開いてしまい (既定の動作)、書きかけの
 * スケッチごと画面が飛ぶ。窓で受けて、開いてから取り込む。
 */

import { ASSET_TYPES, assetUrl, type SketchFiles } from "@p5stage/shared";

import { formatBytes } from "../../lib/assets/asset";
import "../../styles/assets-panel.css";
import type { ToastType } from "../ui/toast";
import { makeToolbarButton, setToolbarButtonLabel } from "../ui/toolbar-button";
import { fetchAssetUsage, uploadAsset, type AssetUsage } from "./asset-upload";
import {
  addAsset,
  readManifestState,
  removeAsset,
  type ManifestAsset,
} from "./manifest-edit";

export interface AssetsPanelOptions {
  /** アセットの配信オリジン (ADR 0014)。無い構成では見本を出さない。 */
  readonly assetsOrigin: string | null;
  /** いまのファイル構成。開くたび・書き換えるたびに読み直す。 */
  getFiles(): SketchFiles;
  /** `assets.json` を書き換えた。エディタへ書き戻す。 */
  onWrite(content: string): void;
  /** 出来事の報告 (トーストの受け口)。 */
  onNotice(message: string, type: ToastType): void;
}

/** ファイル選択に出す拡張子。allowlist (要件 3.3) と同じ並びから作る。 */
const ACCEPT = Object.values(ASSET_TYPES).flat().join(",");

/** 見本 (サムネイル) を出せる形式。 */
function isPreviewable(mime: string): boolean {
  return mime.startsWith("image/");
}

/** 見本を出せない形式に添える短い名前 (`model/gltf-binary` → `GLTF`)。 */
function typeBadge(mime: string): string {
  const subtype = mime.split("/")[1] ?? mime;
  return (subtype.split(/[+-]/)[0] ?? subtype).toUpperCase();
}

export class AssetsPanel {
  readonly #container: HTMLElement;
  readonly #options: AssetsPanelOptions;
  readonly #body: HTMLElement;
  readonly #toggle: HTMLButtonElement;
  readonly #content: HTMLElement;
  readonly #footer: HTMLElement;
  readonly #picker: HTMLInputElement;
  readonly #dropButton: HTMLButtonElement;
  /** 送るのを待っているファイル。取り込み中に落とされた分がここに積まれる。 */
  readonly #queue: File[] = [];
  #usage: AssetUsage | null = null;
  #open = false;
  #busy = false;
  /** ファイルを掴んだまま窓の上にいる。落とせる先を光らせる。 */
  #dragging = false;

  constructor(container: HTMLElement, options: AssetsPanelOptions) {
    this.#container = container;
    this.#options = options;

    this.#toggle = makeToolbarButton({
      id: "assets-toggle",
      icon: "image",
      label: "アセットを開く",
      onClick: () => this.toggle(),
    });
    this.#toggle.classList.add("assets-panel-toggle");

    this.#body = document.createElement("div");
    this.#body.className = "assets-panel-body";
    this.#body.id = "assets-panel-body";
    this.#body.setAttribute("role", "group");
    this.#body.setAttribute("aria-label", "アセット");
    this.#toggle.setAttribute("aria-controls", this.#body.id);

    this.#picker = document.createElement("input");
    this.#picker.type = "file";
    this.#picker.multiple = true;
    this.#picker.accept = ACCEPT;
    this.#picker.className = "assets-picker";
    this.#picker.id = "assets-picker";
    this.#picker.addEventListener("change", () => {
      const files = [...(this.#picker.files ?? [])];
      // 同じファイルを続けて選べるようにする (`change` は値が変わらないと来ない)。
      this.#picker.value = "";
      void this.#accept(files);
    });

    this.#dropButton = document.createElement("button");
    this.#dropButton.type = "button";
    this.#dropButton.className = "assets-drop";
    this.#dropButton.addEventListener("click", () => this.#picker.click());

    this.#content = document.createElement("div");
    this.#content.className = "assets-panel-content";
    this.#footer = document.createElement("div");
    this.#footer.className = "assets-panel-footer";

    this.#body.replaceChildren(
      this.#createHeader(),
      this.#content,
      this.#footer
    );

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !this.#open) return;
      event.stopPropagation();
      this.close();
    };
    this.#container.addEventListener("keydown", closeOnEscape);
    this.#body.addEventListener("keydown", closeOnEscape);

    this.#container.replaceChildren(this.#toggle);
    // ドロワーは画面に対して置く面なので、DOM も画面の直下に置く (設定パネルと
    // 同じ理由 — 操作列の中に残すと、その z-index の層に潜る)。
    document.body.appendChild(this.#body);

    this.#listenForDrops();
    this.#render();
    this.#renderChrome();
  }

  open(): void {
    this.#open = true;
    this.#renderChrome();
    // 開くたびに読み直す。手で書き換えた `assets.json` もこれで映る。
    this.#render();
    void this.#refreshUsage();
  }

  close(): void {
    // 閉じた面は `inert` になるので、中にフォーカスが残ると行き場を失う。
    if (this.#body.contains(document.activeElement)) this.#toggle.focus();
    this.#open = false;
    this.#renderChrome();
  }

  toggle(): void {
    if (this.#open) this.close();
    else this.open();
  }

  /** 外から中身が変わったとき (作品の読み込み・取り込みの直後)。 */
  refresh(): void {
    this.#render();
  }

  dispose(): void {
    this.#container.replaceChildren();
    // ドロワーはコンテナの外 (body 直下) にあるので、一緒には消えない。
    this.#body.remove();
  }

  #renderChrome(): void {
    this.#body.classList.toggle("is-open", this.#open);
    // `hidden` では消さない (出入りを見せる面)。見えていない間にフォーカスと
    // 読み上げが届かないようにするのは `inert` の役目。
    this.#body.toggleAttribute("inert", !this.#open);
    this.#toggle.setAttribute("aria-expanded", String(this.#open));
    this.#toggle.classList.toggle("is-active", this.#open);
    setToolbarButtonLabel(
      this.#toggle,
      this.#open ? "アセットを閉じる" : "アセットを開く"
    );
  }

  #createHeader(): HTMLElement {
    const header = document.createElement("div");
    header.className = "assets-panel-header";

    const title = document.createElement("h2");
    title.className = "assets-panel-title";
    title.textContent = "アセット";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "assets-panel-close";
    // 絵 (×) は読み上げから外し、名前は title と aria-label が持つ。
    close.innerHTML = `<span aria-hidden="true">×</span>`;
    close.title = "アセットを閉じる";
    close.setAttribute("aria-label", "アセットを閉じる");
    close.addEventListener("click", () => this.close());

    header.replaceChildren(title, close);
    return header;
  }

  /** 一覧とクォータを組み直す。 */
  #render(): void {
    const state = readManifestState(this.#options.getFiles());

    this.#dropButton.disabled = this.#busy || state.kind === "invalid";
    this.#dropButton.textContent = this.#busy
      ? "アップロード中…"
      : "ここに落とすか、押して選ぶ";
    this.#dropButton.classList.toggle("is-dragging", this.#dragging);

    const nodes: Node[] = [this.#dropButton, this.#picker];

    if (state.kind === "invalid") {
      // 直すまで足すことも外すこともできない。理由はそのまま出す (3-2 の文言)。
      const invalid = document.createElement("p");
      invalid.className = "assets-invalid";
      invalid.setAttribute("role", "alert");
      invalid.textContent = `${state.message} (エディタで直してください)`;
      nodes.push(invalid);
    } else if (state.assets.length === 0) {
      const empty = document.createElement("p");
      empty.className = "assets-empty";
      empty.textContent =
        "まだアセットはありません。画像・音声・3D モデル・データ・フォントを置けます";
      nodes.push(empty);
    } else {
      const list = document.createElement("ul");
      list.className = "assets-list";
      for (const asset of state.assets) {
        list.appendChild(this.#createRow(asset));
      }
      nodes.push(list);
    }

    this.#content.replaceChildren(...nodes);
    this.#renderFooter();
  }

  /**
   * アセット 1 件の行。
   *
   * 名前を主役にするのは、**コードから引くのがこの名前**だから
   * (`loadImage("cat.png")`)。sha256 は出さない — 64 桁を見て利用者にできることは
   * 無く、一覧が読めなくなるだけ。
   */
  #createRow(asset: ManifestAsset): HTMLElement {
    const row = document.createElement("li");
    row.className = "assets-row";
    // 掴む手掛かりは表示名ではなく属性で持つ (E2E の足掛かり)。
    row.dataset.asset = asset.name;

    const thumb = document.createElement("span");
    thumb.className = "assets-thumb";
    const origin = this.#options.assetsOrigin;
    if (origin !== null && isPreviewable(asset.entry.mime)) {
      const image = document.createElement("img");
      // 配信 URL をそのまま参照する (ADR 0014)。blob URL に落とすとメモリに載る。
      image.src = assetUrl(origin, asset.entry.sha256, asset.name);
      image.loading = "lazy";
      // 名前は隣に文字で出ている。読み上げに 2 度言わせない。
      image.alt = "";
      thumb.appendChild(image);
    } else {
      thumb.classList.add("is-badge");
      thumb.textContent = typeBadge(asset.entry.mime);
    }

    const name = document.createElement("span");
    name.className = "assets-name";
    name.textContent = asset.name;

    const size = document.createElement("span");
    size.className = "assets-size";
    size.textContent = formatBytes(asset.entry.size);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "assets-remove";
    remove.innerHTML = `<span aria-hidden="true">×</span>`;
    // 「削除」とは書かない。消えるのは作品からの参照だけで、実体も所有も残る
    // (手放す口は 3-4b)。
    remove.title = `${asset.name} を作品から外す`;
    remove.setAttribute("aria-label", `${asset.name} を作品から外す`);
    remove.addEventListener("click", () => this.#remove(asset.name));

    row.replaceChildren(thumb, name, size, remove);
    return row;
  }

  /** 使用量。ログインしていなければ、その旨だけを出す。 */
  #renderFooter(): void {
    const usage = this.#usage;
    if (usage === null) {
      const notice = document.createElement("p");
      notice.className = "assets-quota-text";
      notice.textContent = "ログインするとアセットを追加できます";
      this.#footer.replaceChildren(notice);
      return;
    }

    const ratio = usage.quotaBytes === 0 ? 0 : usage.bytes / usage.quotaBytes;
    const percent = Math.min(100, Math.max(0, ratio * 100));

    const bar = document.createElement("div");
    bar.className = "assets-quota-bar";
    // 棒だけでは読み上げに届かない。値そのものを渡す。
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(usage.quotaBytes));
    bar.setAttribute("aria-valuenow", String(usage.bytes));
    bar.setAttribute("aria-label", "アセットの使用量");
    const fill = document.createElement("span");
    fill.className = "assets-quota-fill";
    fill.style.width = `${percent}%`;
    bar.appendChild(fill);

    const text = document.createElement("p");
    text.className = "assets-quota-text";
    // 表示は丸めた値なので、確かめる側 (E2E) には生の数を渡す。
    text.dataset.usedBytes = String(usage.bytes);
    text.textContent =
      `${formatBytes(usage.bytes)} / ${formatBytes(usage.quotaBytes)} を使用中` +
      ` (1 ファイル ${formatBytes(usage.maxAssetBytes)} まで)`;

    this.#footer.replaceChildren(bar, text);
  }

  async #refreshUsage(): Promise<void> {
    this.#usage = await fetchAssetUsage();
    this.#renderFooter();
  }

  /**
   * 落とされた・選ばれたファイルを取り込む。
   *
   * **1 つずつ順に送る。** 並べて送ると、名前が空いているかの判断が互いの結果を
   * 見ないまま進み、2 つ目以降が同じ名前に着く。
   *
   * 送っている最中に落とされた分は**待ち行列に積む**。走っているループが続けて
   * 拾うので、上げ切るまでの数秒に落としたファイルが黙って消えることはない。
   */
  async #accept(files: readonly File[]): Promise<void> {
    if (files.length === 0) return;
    this.#queue.push(...files);
    if (this.#busy) return;

    this.#busy = true;
    this.#render();

    const added: string[] = [];
    try {
      if (this.#usage === null) {
        // 閉じたまま落とされたときのために、ここでも一度引き直す。
        await this.#refreshUsage();
      }
      if (this.#usage === null) {
        this.#queue.length = 0;
        this.#options.onNotice("ログインするとアセットを追加できます", "error");
        return;
      }

      for (
        let file = this.#queue.shift();
        file !== undefined;
        file = this.#queue.shift()
      ) {
        const result = await uploadAsset(file);
        if (!result.ok) {
          this.#options.onNotice(result.message, "error");
          continue;
        }
        this.#usage = result.usage;

        const edit = addAsset(
          this.#options.getFiles(),
          file.name,
          result.entry
        );
        if (!edit.ok) {
          this.#options.onNotice(edit.message, "error");
          continue;
        }
        // 書き戻しは 1 件ずつ。次の 1 件はこの結果を読んでから名前を決める。
        if (!edit.unchanged) this.#options.onWrite(edit.content);
        added.push(
          edit.name === file.name.trim()
            ? edit.name
            : `${file.name} を ${edit.name} として`
        );
      }
    } finally {
      this.#busy = false;
      this.#render();
    }

    if (added.length > 0) {
      this.#options.onNotice(`${added.join("・")} を追加しました`, "success");
    }
  }

  /**
   * 作品からアセットを外す。
   *
   * 確認は挟まない。**取り消せる操作**だから — 実体も所有も残るので、同じものを
   * 落とし直せば転送なしで戻る (ADR 0003 の dedup)。
   */
  #remove(name: string): void {
    const edit = removeAsset(this.#options.getFiles(), name);
    if (!edit.ok) {
      this.#options.onNotice(edit.message, "error");
      return;
    }
    this.#options.onWrite(edit.content);
    this.#render();
    this.#options.onNotice(`${name} を作品から外しました`, "info");
  }

  /**
   * 窓に落とされたファイルを受ける。
   *
   * `preventDefault` を欠かすと、ブラウザが落とされたファイルを**そのページで
   * 開く**。書きかけのスケッチごと画面が飛ぶので、ドロワーの開閉に関わらず窓で
   * 受け止める。ファイルを伴わない drag (Monaco の中の文字の移動) には触らない。
   */
  #listenForDrops(): void {
    const hasFiles = (event: DragEvent): boolean =>
      event.dataTransfer?.types.includes("Files") ?? false;

    window.addEventListener("dragover", (event) => {
      if (!hasFiles(event)) return;
      // `dragover` を止め続けている間だけ drop が来る (仕様)。
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
      this.#setDragging(true);
    });

    window.addEventListener("dragleave", (event) => {
      // 窓の外へ出たときだけ消す (要素をまたぐたびに来るので、それは無視する)。
      if (event.relatedTarget !== null) return;
      this.#setDragging(false);
    });

    window.addEventListener("drop", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      this.#setDragging(false);
      // 落とした先が見えるように開く。取り込みの結果もここに出る。
      this.open();
      void this.#accept([...(event.dataTransfer?.files ?? [])]);
    });
  }

  #setDragging(dragging: boolean): void {
    if (this.#dragging === dragging) return;
    this.#dragging = dragging;
    this.#dropButton.classList.toggle("is-dragging", dragging);
  }
}
