/**
 * 実行キャンバスに重なる透過エディタ (要件 3.1)。
 *
 * 移植元 canvastage との違いは 2 つ。
 *
 * - **ファイルごとに `ITextModel` を分ける**。あちらは単一モデルの `setValue` 切替
 *   だったため、タブを移ると undo 履歴が混ざる (別ファイルの編集が戻る) 。
 *   モデルを分けると undo 履歴・カーソル位置・言語がファイル単位で独立する
 * - 見た目の設定は設定パネル (1-5) が持つ。ここは受け取った設定を当てるだけで、
 *   既定値も範囲も持たない (正本は scripts/settings/definitions.ts)
 */

import type { SketchFiles } from "@p5stage/shared";

import "../../styles/editor-overlay.css";
import type { EditorSettings } from "../settings/definitions";
import { editorOptionsFor, modelOptionsFor } from "../settings/editor-options";
import { nextActiveFile } from "./file-actions";
import { javascriptDefaults, monaco } from "./monaco";
import { resolveLanguage } from "./languages";
import { isRunShortcut } from "./run-shortcut";
import {
  DEFAULT_THEME_DATA,
  DEFAULT_THEME_NAME,
  PALETTES,
  createThemeData,
} from "./themes";

export interface CodeEditorOptions {
  /** 初期のファイル構成。表示順はこのオブジェクトのキー順。 */
  readonly files: SketchFiles;
  /** 最初に開くファイル。files に無ければ先頭のファイル。 */
  readonly activeFile?: string;
  /** 見た目の設定 (検証済みのもの)。 */
  readonly settings: EditorSettings;
  /** ⌘/Ctrl+Enter が押された。 */
  onRun(): void;
  /** 編集された (引数は編集されたファイル名)。ドラフト保存 (1-6) の受け口。 */
  onChange?(fileName: string): void;
  /** ファイルの構成か、開いているファイルが変わった。タブの再描画に使う。 */
  onFilesChanged?(fileNames: readonly string[], activeFile: string): void;
}

/** モデルの URI スキーム。実在するファイルではないことを名前で示す。 */
const MODEL_SCHEME = "inmemory";
const MODEL_AUTHORITY = "sketch";

let themesRegistered = false;

/** テーマを Monaco に登録する (多重登録は無害だが一度で足りる)。 */
function registerThemes(): void {
  if (themesRegistered) return;
  themesRegistered = true;
  monaco.editor.defineTheme(DEFAULT_THEME_NAME, DEFAULT_THEME_DATA);
  for (const [name, palette] of Object.entries(PALETTES)) {
    monaco.editor.defineTheme(name, createThemeData(palette));
  }
}

/**
 * JavaScript の意味解析を止める。構文エラーの検出は残す。
 *
 * **型定義を配った後 (`configureP5Types`) も止めたままにしている。** Monaco の既定は
 * strict なので、戻すと `let img;` (`preload` で代入する定番の書き方) や
 * `select("#box").mousePressed(...)` が赤くなる。`noImplicitAny` と
 * `strictNullChecks` を緩めれば消えるところまでは分かっているが、設定パネルの
 * トグルとして出す段階の話なので分けた (Issue #104 の段階 2)。
 *
 * 補完と診断は独立して切れるので、**補完だけ先に出せる**。
 *
 * Monaco 0.56 の既定も同じだが、上流の既定が変わると赤線だらけに転ぶので明示する。
 */
function configureJavaScriptDiagnostics(): void {
  javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });
}

/**
 * 型定義の登録は 1 回で足りる。`javascriptDefaults` はモジュールのグローバルで、
 * エディタを作り直しても言語サービスは生き続ける。
 */
let p5TypesRequested = false;

/**
 * p5.js の型定義を言語サービスへ渡す (Issue #104 / ADR 0021)。
 *
 * これを渡すまで補完の材料は `lib.dom` / `lib.esnext` しか無く、**p5 の API は
 * 1 件も出ない**。渡すと API 補完・引数名・オーバーロード・p5 リファレンスの
 * 説明文つきホバーまで一度に効く。
 *
 * **エディタの初期表示は待たせない**。動的 import の解決後に登録するので、補完は
 * 数百 ms 遅れて効き始める (初期 JS を削る話は Issue #18)。取り込みに失敗しても
 * エディタは動く — 補完の材料が増えないだけ。
 *
 * ファイルを跨ぐ補完のために `setEagerModelSync(true)` を足す案もあったが、
 * **0.56 では要らなかった** (真偽どちらでも `other.js` の関数が `sketch.js` の
 * 候補に出る)。効かない設定は置かない。この振る舞いは
 * e2e/completion.spec.ts が押さえている。
 */
function configureP5Types(): void {
  if (p5TypesRequested) return;
  p5TypesRequested = true;

  import("virtual:p5-types")
    .then(({ default: files }) => {
      for (const file of files) {
        javascriptDefaults.addExtraLib(file.content, file.filePath);
      }
    })
    .catch((error: unknown) => {
      console.warn("p5.js の型定義を読み込めませんでした", error);
    });
}

export class CodeEditor {
  readonly #editor: monaco.editor.IStandaloneCodeEditor;
  /** ファイル名 → モデル。挿入順がタブの並び順になる。 */
  readonly #models = new Map<string, monaco.editor.ITextModel>();
  /** ファイル名 → カーソル・スクロール位置。切り替えても編集位置が飛ばないようにする。 */
  readonly #viewStates = new Map<string, monaco.editor.ICodeEditorViewState>();
  readonly #disposables: monaco.IDisposable[] = [];
  readonly #onFilesChanged: CodeEditorOptions["onFilesChanged"];
  readonly #onChange: CodeEditorOptions["onChange"];
  #activeFile: string;
  #settings: EditorSettings;

  constructor(container: HTMLElement, options: CodeEditorOptions) {
    registerThemes();
    configureJavaScriptDiagnostics();
    configureP5Types();

    this.#onFilesChanged = options.onFilesChanged;
    this.#onChange = options.onChange;
    this.#settings = options.settings;

    const names = Object.keys(options.files);
    if (names.length === 0) {
      throw new Error("ファイルが 1 つもありません");
    }
    for (const name of names) {
      this.#models.set(
        name,
        this.#createModel(name, options.files[name] ?? "")
      );
    }

    const first = names[0] as string;
    this.#activeFile =
      options.activeFile !== undefined && this.#models.has(options.activeFile)
        ? options.activeFile
        : first;

    this.#editor = monaco.editor.create(container, {
      model: this.#models.get(this.#activeFile) ?? null,
      // 設定で変わる見た目はここでまとめて当てる。以下は設定に出さない固定値
      // (スケッチの上に重ねる以上、選べても困るだけのもの)。
      ...editorOptionsFor(this.#settings),
      lineNumbers: "on",
      lineNumbersMinChars: 3,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 12, bottom: 12 },
      renderLineHighlight: "all",
      renderLineHighlightOnlyWhenFocus: false,
      // スケッチの上に重ねるので、文字以外の面はできるだけ描かない。
      occurrencesHighlight: "off",
      selectionHighlight: false,
      folding: false,
      glyphMargin: false,
      lineDecorationsWidth: 10,
      // 括弧の色分けはここでは切れない (エディタではなくモデルのオプション)。
      // 切っているのは settings/editor-options.ts の modelOptionsFor。
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollbar: { vertical: "hidden", horizontal: "hidden" },
      contextmenu: false,
    });

    this.#disposables.push(
      this.#editor.onKeyDown((event) => {
        if (!isRunShortcut(event.browserEvent)) return;
        event.preventDefault();
        event.stopPropagation();
        options.onRun();
      })
    );

    if (this.#onChange !== undefined) {
      // **今付いているモデルの変更しか来ない。** 開いていないファイルへの書き込み
      // (`writeFile`) は自分で伝える。
      this.#disposables.push(
        this.#editor.onDidChangeModelContent(() => {
          this.#onChange?.(this.#activeFile);
        })
      );
    }
  }

  /**
   * 見た目の設定を当て直す。
   *
   * タブ幅はエディタではなくモデルが持つので、開いていないファイルにも当てる
   * (後で開いたときだけ古い幅、という食い違いを作らない)。
   */
  applySettings(settings: EditorSettings): void {
    this.#settings = settings;
    this.#editor.updateOptions(editorOptionsFor(settings));
    const modelOptions = modelOptionsFor(settings);
    for (const model of this.#models.values())
      model.updateOptions(modelOptions);
  }

  /** いま開いているファイル。 */
  get activeFile(): string {
    return this.#activeFile;
  }

  /** ファイル名の一覧 (タブの並び順)。 */
  get fileNames(): readonly string[] {
    return [...this.#models.keys()];
  }

  /** ファイルを開く。未知のファイル名は無視する。 */
  open(fileName: string): void {
    const model = this.#models.get(fileName);
    if (model === undefined || fileName === this.#activeFile) return;

    const state = this.#editor.saveViewState();
    if (state !== null) this.#viewStates.set(this.#activeFile, state);

    this.#activeFile = fileName;
    this.#editor.setModel(model);

    const restored = this.#viewStates.get(fileName);
    if (restored !== undefined) this.#editor.restoreViewState(restored);

    this.#onFilesChanged?.(this.fileNames, this.#activeFile);
  }

  /**
   * ファイルを追加して開く。名前の妥当性は呼び出し側 (file-actions) が済ませる前提で、
   * ここでは構成を壊す重複だけを拒む。
   */
  addFile(fileName: string, content = ""): void {
    if (this.#models.has(fileName)) {
      throw new Error(`${fileName} は既にあります`);
    }
    this.#models.set(fileName, this.#createModel(fileName, content));
    this.#activeFile = fileName;
    this.#editor.setModel(this.#models.get(fileName) ?? null);
    this.#onFilesChanged?.(this.fileNames, this.#activeFile);
  }

  /**
   * ファイル 1 つの中身を書き換える。無ければ足す (Phase 3-4)。
   *
   * `addFile` と違って**開いているファイルは動かさない**。これを使うのは
   * アセットパネルのように**機械が書くファイル** (`assets.json`) で、書くたびに
   * タブが JSON へ飛ぶと、書いていたコードが見えなくなる。
   *
   * 既にあるファイルは `setValue` で丸ごと差し替える。そのファイルの undo 履歴は
   * 切れるが、機械が書いた 1 件の追加を**半分だけ戻せる**方が困る (戻した形が
   * マニフェストとして読めるとは限らない)。
   */
  writeFile(fileName: string, content: string): void {
    const model = this.#models.get(fileName);
    if (model !== undefined) {
      if (model.getValue() === content) return;
      model.setValue(content);
      // **開いていないファイルの変更はエディタのイベントに来ない**
      // (`onDidChangeModelContent` が見るのは今付いているモデルだけ)。伝え損ねると
      // 下書きにも Gist にも書かれないまま、画面のアセットだけが増える。
      if (fileName !== this.#activeFile) this.#onChange?.(fileName);
      return;
    }

    this.#models.set(fileName, this.#createModel(fileName, content));
    this.#onFilesChanged?.(this.fileNames, this.#activeFile);
  }

  /** ファイルを削除する。開いていたら隣のファイルへ移る。 */
  removeFile(fileName: string): void {
    const model = this.#models.get(fileName);
    if (model === undefined) return;

    const nextFile = nextActiveFile(this.fileNames, fileName);
    if (nextFile === null) {
      throw new Error("最後のファイルは削除できません");
    }

    const wasActive = fileName === this.#activeFile;
    // setModel より先に破棄すると、破棄済みモデルを指した一瞬が生まれる。
    if (wasActive) {
      this.#activeFile = nextFile;
      this.#editor.setModel(this.#models.get(nextFile) ?? null);
      const restored = this.#viewStates.get(nextFile);
      if (restored !== undefined) this.#editor.restoreViewState(restored);
    }

    this.#models.delete(fileName);
    this.#viewStates.delete(fileName);
    model.dispose();

    this.#onFilesChanged?.(this.fileNames, this.#activeFile);
  }

  /**
   * ファイルの名前を変える。並び順は変わらない。
   *
   * Monaco のモデル URI は後から変えられないので、内容を移した新しいモデルに
   * 差し替える。**undo 履歴はここで切れる** (カーソル位置は引き継ぐ)。URI に
   * ファイル名を残すのは、拡張子を手掛かりにする言語サービスのため。
   */
  renameFile(fileName: string, newName: string): void {
    const model = this.#models.get(fileName);
    if (model === undefined || fileName === newName) return;
    if (this.#models.has(newName)) {
      throw new Error(`${newName} は既にあります`);
    }

    const wasActive = fileName === this.#activeFile;
    const state = wasActive
      ? this.#editor.saveViewState()
      : (this.#viewStates.get(fileName) ?? null);

    const renamed = this.#createModel(newName, model.getValue());

    // Map は挿入順しか持たないため、並びを保つには作り直すしかない。
    const entries = [...this.#models].map(
      ([name, current]): [string, monaco.editor.ITextModel] =>
        name === fileName ? [newName, renamed] : [name, current]
    );
    this.#models.clear();
    for (const [name, current] of entries) this.#models.set(name, current);

    this.#viewStates.delete(fileName);
    if (state !== null) this.#viewStates.set(newName, state);

    if (wasActive) {
      this.#activeFile = newName;
      this.#editor.setModel(renamed);
      if (state !== null) this.#editor.restoreViewState(state);
    }
    model.dispose();

    this.#onFilesChanged?.(this.fileNames, this.#activeFile);
  }

  /**
   * ファイル構成をまるごと差し替える (ドラフトの破棄・Phase 2 の作品読み込み)。
   *
   * **undo 履歴とカーソル位置は捨てる**。差し替え前の内容へ undo で戻れると、
   * 「破棄したはずのものが混ざる」ことになる。
   */
  setFiles(files: SketchFiles, activeFile?: string): void {
    const names = Object.keys(files);
    if (names.length === 0) {
      throw new Error("ファイルが 1 つもありません");
    }

    // 表示中のモデルを破棄する前に外す。付けたまま捨てると、破棄済みモデルを
    // 指した一瞬が生まれる。
    this.#editor.setModel(null);
    for (const model of this.#models.values()) model.dispose();
    this.#models.clear();
    this.#viewStates.clear();

    for (const name of names) {
      this.#models.set(name, this.#createModel(name, files[name] ?? ""));
    }
    this.#activeFile =
      activeFile !== undefined && this.#models.has(activeFile)
        ? activeFile
        : (names[0] as string);
    this.#editor.setModel(this.#models.get(this.#activeFile) ?? null);

    this.#onFilesChanged?.(this.fileNames, this.#activeFile);
  }

  /** 現在の編集内容。 */
  getFiles(): SketchFiles {
    const files: Record<string, string> = {};
    for (const [name, model] of this.#models) {
      files[name] = model.getValue();
    }
    return files;
  }

  focus(): void {
    this.#editor.focus();
  }

  dispose(): void {
    for (const disposable of this.#disposables) disposable.dispose();
    this.#editor.dispose();
    for (const model of this.#models.values()) model.dispose();
    this.#models.clear();
    this.#viewStates.clear();
  }

  #createModel(fileName: string, content: string): monaco.editor.ITextModel {
    const uri = monaco.Uri.from({
      scheme: MODEL_SCHEME,
      authority: MODEL_AUTHORITY,
      path: `/${fileName}`,
    });
    // Monaco のモデルはグローバルに生きるため、同じ URI が残っていると
    // createModel が失敗する。エディタを作り直したとき (HMR など) の取り残し。
    monaco.editor.getModel(uri)?.dispose();

    const model = monaco.editor.createModel(
      content,
      resolveLanguage(fileName),
      uri
    );
    model.updateOptions(modelOptionsFor(this.#settings));
    return model;
  }
}
