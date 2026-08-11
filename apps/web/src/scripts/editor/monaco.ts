/**
 * Monaco の読み込み口。
 *
 * `monaco-editor` の既定エントリは 90 以上の言語定義を全部積むため、
 * エディタを開くだけで 1MB 近い JS (gzip 後) を読むことになる。ライブコーディングの
 * 体験は初期表示の速さに直結するので、0.56 で入った tree-shakeable な
 * エントリを使い、スケッチで使う言語だけを積む。
 *
 * 言語を足すときは languages.ts の対応表とここの import を一緒に増やす。
 */

import * as monaco from "monaco-editor/editor";

// エディタ本体の機能 (検索・補完・複数カーソルなど) は一式入れる。
import "monaco-editor/features/register.all";

// 構文ハイライト。languages.ts が返す言語 ID と対になる。
import "monaco-editor/languages/definitions/css/register";
import "monaco-editor/languages/definitions/html/register";
import "monaco-editor/languages/definitions/javascript/register";
import "monaco-editor/languages/definitions/markdown/register";
import "monaco-editor/languages/definitions/typescript/register";

// 言語サービス (補完・診断)。ワーカーの配線は monaco-env.ts。
// JSON は言語定義が独立しておらず、この register が言語ごと登録する。
import "monaco-editor/languages/features/css/register";
import "monaco-editor/languages/features/html/register";
import "monaco-editor/languages/features/json/register";
export { javascriptDefaults } from "monaco-editor/languages/features/typescript/register";

import "./monaco-env";

export { monaco };
