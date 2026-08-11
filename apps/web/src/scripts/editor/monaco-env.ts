/**
 * Monaco の言語サービスワーカーの配線。
 *
 * `self.MonacoEnvironment` はモジュール読み込み時に立てる必要があるため、
 * このモジュール自体が副作用を持つ。Astro の `<script>` は常にクライアント側で
 * 実行される (SSR されない) ので、ここが Worker 前提でも壊れない。
 */

// monaco-editor 0.56 で ESM のエントリが整理され、`esm/vs/...` を直接指す
// 従来のパスは exports から外れた。指定先は package.json の exports に載る形で書く。
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import cssWorker from "monaco-editor/languages/features/css/css.worker?worker";
import htmlWorker from "monaco-editor/languages/features/html/html.worker?worker";
import jsonWorker from "monaco-editor/languages/features/json/json.worker?worker";
import tsWorker from "monaco-editor/languages/features/typescript/ts.worker?worker";

self.MonacoEnvironment = {
  getWorker(_workerId: unknown, label: string): Worker {
    switch (label) {
      case "javascript":
      case "typescript":
        return new tsWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "json":
        return new jsonWorker();
      default:
        return new editorWorker();
    }
  },
};
