/**
 * E2E から見たエディタの操作。
 *
 * 掴み方は表示名ではなく構造で決める。`data-file` / `data-setting-key` は
 * そのために振ってあるもので (1-3 / 1-5)、ラベルの言い回しを変えただけで
 * テストが落ちないようにする。
 */

import { expect, type Frame, type Locator, type Page } from "@playwright/test";

/** ランナーが `srcdoc` で作るスケッチ文書の URL。 */
const SKETCH_FRAME_URL = "about:srcdoc";

/** エディタを開き、最初の実行が画面に出るまで待つ。 */
export async function openEditor(page: Page): Promise<void> {
  await page.goto("/edit");
  await expectGeneration(page, 1);
}

/**
 * 指定の世代が画面に出るまで待つ。
 *
 * 表示が `実行 #n` に変わるのは、本体 → ランナーの `run` に対してランナーが
 * `rendered` を返したときだけ。つまりこれを待つことが、往復のハンドシェイクが
 * 通ったことの確認になる (ADR 0007)。
 */
export function expectGeneration(page: Page, gen: number): Promise<void> {
  return expect(page.locator("#status")).toHaveText(`実行 #${gen}`);
}

/** 実行 iframe (本体が置く 1 枚。中身は別オリジンのランナー)。 */
export function previewFrame(page: Page): Locator {
  return page.locator("#stage iframe.preview-frame");
}

/** ランナー文書。別オリジンなので、掴んだ後にできるのは evaluate だけ。 */
export function runnerFrame(page: Page, previewOrigin: string): Frame {
  const frame = page
    .frames()
    .find((candidate) => candidate.url().startsWith(previewOrigin));
  if (frame === undefined) {
    throw new Error(`ランナー文書が見つかりません (${previewOrigin})`);
  }
  return frame;
}

/**
 * スケッチが canvas を描いているか。
 *
 * ランナーはダブルバッファで 2 枚のフレームを持ち、表示していない方は
 * `srcdoc` を空にして止める。どちらが表に出ているかは演出の途中で入れ替わるので、
 * 「中身のあるフレームが 1 つでもあるか」で見る。
 */
export async function hasSketchCanvas(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    if (frame.url() !== SKETCH_FRAME_URL) continue;
    try {
      if ((await frame.locator("canvas").count()) > 0) return true;
    } catch {
      // 差し替えの途中でフレームが外れた。次の呼び出しで見直す。
    }
  }
  return false;
}

/**
 * Monaco の編集ショートカットで使う修飾キー。
 *
 * Monaco は `navigator.userAgent` を見て割り当てを変える (mac は ⌘、他は Ctrl)。
 * Playwright の Desktop Chrome は **Windows の userAgent を名乗る**ので、
 * 手元が mac でも効くのは Ctrl 側になる。Playwright の `ControlOrMeta` は
 * 実行中の OS で決まるため、mac で走らせると Monaco の判定とずれる。
 * Monaco と同じ材料 (userAgent) から引いて、どちらでも同じテストが通るようにする。
 *
 * 実行ショートカット (⌘/Ctrl+Enter) だけは本体が keydown を直接見て両方を
 * 受け付けるので (run-shortcut.ts)、そちらは `ControlOrMeta` のままでよい。
 */
export async function editorModifier(page: Page): Promise<"Meta" | "Control"> {
  const isMac = await page.evaluate(() =>
    navigator.userAgent.includes("Macintosh")
  );
  return isMac ? "Meta" : "Control";
}

/**
 * いま開いているファイルの内容を丸ごと書き換える。
 *
 * Monaco は括弧と引用符を自動で閉じ、閉じ側を打つと自動挿入ぶんを乗り越える。
 * 釣り合いの取れた 1 行はそのまま入るが、**改行を挟むブロック**は自動インデントと
 * 閉じ括弧の位置がずれる。E2E から流し込むコードは 1 行で書ける形に留める。
 */
export async function typeIntoEditor(page: Page, code: string): Promise<void> {
  const modifier = await editorModifier(page);
  await page.locator("#editor .view-lines").click();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press("Delete");
  await page.keyboard.type(code);
}

/** ファイルタブ (name はファイル名)。 */
export function fileTab(page: Page, name: string): Locator {
  return page.locator(`#file-tabs [role="tab"][data-file="${name}"]`);
}

/** タブに並んでいるファイル名。 */
export function fileTabNames(page: Page): Locator {
  return page.locator("#file-tabs .file-tab-name");
}

/** ファイルを追加して開く。 */
export async function addFile(page: Page, name: string): Promise<void> {
  await page.locator("#file-tabs .file-tab-add").click();
  const input = page.locator("#file-tabs .file-tab-input");
  await input.fill(name);
  await input.press("Enter");
  await expect(fileTab(page, name)).toHaveAttribute("aria-selected", "true");
}

/** ファイルを開く。 */
export async function openFile(page: Page, name: string): Promise<void> {
  await fileTab(page, name).click();
  await expect(fileTab(page, name)).toHaveAttribute("aria-selected", "true");
}

/** コンソールパネル。出力が 1 件も無いときは丸ごと隠れる。 */
export function consolePanel(page: Page): Locator {
  return page.locator("#console");
}

/** コンソールに出ている行。 */
export function consoleLines(page: Page): Locator {
  return page.locator("#console .console-panel-lines li");
}

/**
 * 保存済みの値を IndexedDB から直に読む。無ければ null。
 *
 * 画面の表示は「書くと決めた」時点で出るので、書けたことを画面越しに待つと
 * 実際の書き込みが着地する前にリロードしてしまう。保存先を直接見て待つ。
 */
function readStored(
  page: Page,
  storeName: string,
  key: string
): Promise<unknown> {
  return page.evaluate(
    ({ storeName, key }) =>
      new Promise<unknown>((resolve, reject) => {
        // バージョンを指定せずに開く (upgrade を起こさず、今ある姿を読む)。
        const request = indexedDB.open("p5stage");
        request.onerror = () => reject(new Error("IndexedDB を開けません"));
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve(null);
            return;
          }
          const read = db
            .transaction(storeName, "readonly")
            .objectStore(storeName)
            .get(key);
          read.onsuccess = () => {
            db.close();
            resolve(read.result ?? null);
          };
          read.onerror = () => {
            db.close();
            reject(new Error(`${storeName}/${key} を読めません`));
          };
        };
      }),
    { storeName, key }
  );
}

/** 保存済みの下書き。 */
export function readStoredDraft(page: Page): Promise<unknown> {
  return readStored(page, "drafts", "current");
}

/** 保存済みのエディタ設定。 */
export function readStoredSettings(page: Page): Promise<unknown> {
  return readStored(page, "settings", "editor");
}

/** 設定パネルを開く。 */
export async function openSettings(page: Page): Promise<void> {
  await page.locator("#settings .settings-panel-toggle").click();
  await expect(page.locator("#settings .settings-panel-body")).toBeVisible();
}

/** 設定 1 項目のコントロール。 */
export function settingControl(page: Page, key: string): Locator {
  return page.locator(
    `#settings [data-setting-key="${key}"] :is(input, select)`
  );
}
