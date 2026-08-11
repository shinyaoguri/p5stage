/**
 * 実行キャンバスに重なる透過エディタ (要件 3.1)。
 *
 * 移植元 canvastage との違いは 2 つ。
 *
 * - **ファイルごとに `ITextModel` を分ける**。あちらは単一モデルの `setValue` 切替
 *   だったため、タブを移ると undo 履歴が混ざる (別ファイルの編集が戻る) 。
 *   モデルを分けると undo 履歴・カーソル位置・言語がファイル単位で独立する
 * - 見た目の設定は当面ここに固定値で持つ。設定パネル (Issue #11 の 1-5) が
 *   入った時点で、この既定値を上書きする経路を足す
 */

import type { SketchFiles } from "@p5stage/shared";

import "../../styles/editor-overlay.css";
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
  /** ⌘/Ctrl+Enter が押された。 */
  onRun(): void;
  /** 編集された (引数は編集されたファイル名)。ドラフト保存 (1-6) の受け口。 */
  onChange?(fileName: string): void;
  /** ファイルの構成か、開いているファイルが変わった。タブの再描画に使う。 */
  onFilesChanged?(fileNames: readonly string[], activeFile: string): void;
}

/** エディタの見た目の既定値。設定パネル (1-5) が入るまではこれで固定。 */
const EDITOR_FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, monospace";
const EDITOR_FONT_SIZE = 14;
const EDITOR_LINE_HEIGHT = 1.5;
const TAB_SIZE = 2;

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
 * JavaScript の意味解析を止める。
 *
 * p5.js のグローバル関数 (`createCanvas` など) は型定義が無いと未定義扱いになり、
 * 正しいスケッチが赤線だらけになる。構文エラーの検出は残す。
 * 型定義を配って意味解析を戻すかは p5.js の配布方法とあわせて決める (Issue #11)。
 *
 * Monaco 0.56 の既定も同じだが、上流の既定が変わると赤線だらけに転ぶので明示する。
 */
function configureJavaScriptDiagnostics(): void {
  javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
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
  #activeFile: string;

  constructor(container: HTMLElement, options: CodeEditorOptions) {
    registerThemes();
    configureJavaScriptDiagnostics();

    this.#onFilesChanged = options.onFilesChanged;

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
      theme: DEFAULT_THEME_NAME,
      fontFamily: EDITOR_FONT_FAMILY,
      fontSize: EDITOR_FONT_SIZE,
      lineHeight: EDITOR_LINE_HEIGHT * EDITOR_FONT_SIZE,
      tabSize: TAB_SIZE,
      lineNumbers: "on",
      lineNumbersMinChars: 3,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      wordWrap: "on",
      padding: { top: 12, bottom: 12 },
      renderLineHighlight: "all",
      renderLineHighlightOnlyWhenFocus: false,
      // スケッチの上に重ねるので、文字以外の面はできるだけ描かない。
      occurrencesHighlight: "off",
      selectionHighlight: false,
      folding: false,
      glyphMargin: false,
      lineDecorationsWidth: 10,
      guides: {
        indentation: false,
        bracketPairs: false,
        highlightActiveIndentation: false,
        highlightActiveBracketPair: false,
      },
      bracketPairColorization: { enabled: false },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      // 対応括弧の装飾はこの standalone 構成では描画されない (canvastage で確認済み)。
      // 設定項目として復活させるのは 1-5。
      matchBrackets: "never",
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

    if (options.onChange) {
      const onChange = options.onChange;
      this.#disposables.push(
        this.#editor.onDidChangeModelContent(() => {
          onChange(this.#activeFile);
        })
      );
    }
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
    model.updateOptions({ tabSize: TAB_SIZE, insertSpaces: true });
    return model;
  }
}
