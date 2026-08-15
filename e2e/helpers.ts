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

/** 実行・停止ボタン (画面上部中央)。 */
export function runButton(page: Page): Locator {
  return page.locator("#run");
}

/**
 * 指定の世代が画面に出るまで待つ。
 *
 * `data-generation` が進むのは、本体 → ランナーの `run` に対してランナーが
 * `rendered` を返したときだけ。つまりこれを待つことが、往復のハンドシェイクが
 * 通ったことの確認になる (ADR 0007)。
 *
 * `実行 #n` の文字を消した後も、待ち合わせの材料は要る (#41 の 6)。文字ではなく
 * 属性を見るので、意匠を変えてもここは落ちない。
 */
export function expectGeneration(page: Page, gen: number): Promise<void> {
  return expect(runButton(page)).toHaveAttribute(
    "data-generation",
    String(gen)
  );
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

/**
 * ログインする (Phase 2-7)。
 *
 * 認可の往復は偽 GitHub が受ける (`fake-github/server.ts` / ADR 0013)。**押す順序も
 * 含めて本物と同じ道**を通る — 同意を読んでから GitHub へ進み、`state` を持って戻り、
 * `__Host-` の cookie でログイン済みになる。
 */
export async function login(page: Page): Promise<void> {
  // ログイン状態を引き終わるまで待つ。引き終える前は「まだ分からない」状態の姿で、
  // ログインの導線が出てよい時点はここでしか分からない (#51)。
  await expect(
    page.locator(".account-panel[data-ready='true']")
  ).toBeAttached();
  await openAccountMenu(page);
  await page.locator("#login").click();
  // ここはリンク (トップレベル遷移で cookie を確実に載せるため)。
  await page.locator("#login-consent .account-consent-proceed").click();

  await expect(accountMenuToggle(page)).toBeVisible();
}

/**
 * アカウントメニューの開閉ボタン (#87 の段階 2)。
 *
 * **ログインしていなくても同じボタン**。ログインすると人のアイコンがアバターに
 * 替わるだけで、押す場所は動かない。
 */
export function accountMenuToggle(page: Page): Locator {
  return page.locator("#account-menu-toggle");
}

/**
 * アカウントメニューを開く。
 *
 * 開いている面は押し直すと閉じてしまうので、**閉じているときだけ押す**。
 */
export async function openAccountMenu(page: Page): Promise<void> {
  const toggle = accountMenuToggle(page);
  if ((await toggle.getAttribute("aria-expanded")) === "true") return;
  await toggle.click();
  await expect(page.locator("#account-menu")).toBeVisible();
}

/**
 * 「新しいスケッチ」を押す (アカウントメニューの中にある — #87 の段階 2)。
 *
 * 押した先の確認ダイアログは呼ぶ側が扱う (`page.on("dialog")` を張る場所が
 * テストごとに違う)。
 */
export async function newSketch(page: Page): Promise<void> {
  await openAccountMenu(page);
  await page.locator("#new").click();
}

/** 「Gist から開く」を押して、尋ねる面が出るまで待つ。 */
export async function openAdopt(page: Page): Promise<void> {
  await openAccountMenu(page);
  await page.locator("#adopt").click();
  await expect(page.locator("#adopt-dialog")).toBeVisible();
}

/**
 * ログアウトする。
 *
 * **ログアウトの口はアカウントメニューの中にある。** アバターを押すこと自体は
 * メニューを開くだけで、押しただけでセッションは切れない。
 */
export async function logout(page: Page): Promise<void> {
  await accountMenuToggle(page).click();
  await page.locator("#logout").click();
}

/**
 * 保存の状態を支援技術へ渡している文字 (#41 の 6)。
 *
 * 画面に出ているのは保存アイコンの色とドットだけで、この文字は読み上げ専用
 * (`.save-status-sr` で面積を潰してある)。**色は読み上げられない**ので、ここが
 * 空になっていないことにも意味がある。
 */
export function saveStatus(page: Page): Locator {
  return page.locator("#save-status");
}

/** 保存ボタン。色とドットの状態は `data-save-status` から読む (#41 の 6)。 */
export function saveButton(page: Page): Locator {
  return page.locator("#save");
}

/** 下書きの印 (書く前は出ていない)。時刻は `data-saved-at` から読む。 */
export function draftIndicator(page: Page): Locator {
  return page.locator("#draft-status");
}

/**
 * 保存先の Gist を開くリンク (Gist が付いている間だけ出る)。
 *
 * 行き先は作品メニューの中 (#87 の段階 3)。**閉じていても DOM には居る**ので、
 * href を読むだけならメニューを開かなくてよい。掴むのは名前ではなく id
 * (意匠と言い回しから切り離す)。
 */
export function gistLink(page: Page): Locator {
  return page.locator("#gist-link");
}

/** 直すまで続く条件を示す警告アイコン (出ている条件が無ければ隠れている)。 */
export function warningIndicator(page: Page): Locator {
  return page.locator("#warnings");
}

/** 作品の名前 (画面上部中央の入力欄)。 */
export function projectName(page: Page): Locator {
  return page.locator("#project-name");
}

/**
 * 作品の名前を付け替える。
 *
 * `fill` ではなく打ち込むのは、`input` イベントを 1 文字ずつ起こして**普段どおりの
 * リネーム**を踏むため (`fill` は 1 回しか起こさない)。
 */
export async function setProjectName(page: Page, name: string): Promise<void> {
  const input = projectName(page);
  await input.click();
  await input.press("ControlOrMeta+a");
  await input.pressSequentially(name);
  await expect(input).toHaveValue(name);
}

/**
 * 初回の保存。作品 ID を返す。
 *
 * 尋ねられるのは公開範囲だけ (後から変えられない — ADR 0010)。名前は画面上部の
 * 入力欄が常時持つので、ここでは押す前に付け替える (#41 の 3)。
 */
export async function saveNewSketch(
  page: Page,
  title: string,
  visibility: "public" | "unlisted"
): Promise<string> {
  // 名前は画面上部の入力欄が常時持つ (#41 の 3)。保存ダイアログでは尋ねられない。
  await setProjectName(page, title);
  await page.locator("#save").click();
  await expect(page.locator("#save-dialog-title")).toHaveText(title);
  await page
    .locator(`#save-dialog input[name="visibility"][value="${visibility}"]`)
    .check();
  await page.locator("#save-confirm").click();

  await expect(saveButton(page)).toHaveAttribute("data-save-status", "saved");

  // 保存できると URL に作品 ID が載る (open-sketch.ts)。
  const id = new URL(page.url()).searchParams.get("sketch");
  if (id === null) throw new Error("保存後の URL に作品 ID がありません");
  return id;
}

/**
 * 2 回目以降の保存 (尋ねられることは無い)。**保存すべきものがある状態で呼ぶ**。
 *
 * 押す前に `saved` が外れていることを確かめるのは、前回の保存と区別するため。
 * それを見ないと押す前の状態のまま通ってしまう。外れた後の状態は経緯で変わる
 * (編集後なら `dirty`、Gist を外した後なら `unsaved`) ので、外れたことだけを見る。
 */
export async function saveAgain(page: Page): Promise<void> {
  await expect(saveButton(page)).not.toHaveAttribute(
    "data-save-status",
    "saved"
  );
  await page.locator("#save").click();
  await expect(saveButton(page)).toHaveAttribute("data-save-status", "saved");
}

/**
 * 出ているトースト (#41 の 5)。
 *
 * 消える動きの最中 (`toast-exit`) は数えない。あれは DOM からまだ外れていないだけで、
 * 利用者にとっては終わった知らせ。`data-type` で絞れる — 色ではなくそちらを見るのは、
 * 意匠を変えてもテストが落ちないようにするため。
 */
export function toasts(
  page: Page,
  type?: "info" | "success" | "error"
): Locator {
  const kind = type === undefined ? "" : `[data-type="${type}"]`;
  return page.locator(`#toast-container .toast${kind}:not(.toast-exit)`);
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

/**
 * 下書きを消す。**保存済みの作品から離れて新しい作品を始めた状態**を作る。
 *
 * 下書きは `drafts/current` の 1 つきりなので、`/edit` を開き直すだけでは直前の
 * 作品がそのまま戻ってくる。作品を切り替えたときに画面から何が見えなくなるかを
 * 確かめたい場面 (3-5a の参照台帳) では、ここまで消してから開き直す。
 */
export function clearStoredDraft(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("p5stage");
        request.onerror = () => reject(new Error("IndexedDB を開けません"));
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("drafts")) {
            db.close();
            resolve();
            return;
          }
          const remove = db
            .transaction("drafts", "readwrite")
            .objectStore("drafts")
            .delete("current");
          remove.onsuccess = () => {
            db.close();
            resolve();
          };
          remove.onerror = () => {
            db.close();
            reject(new Error("下書きを消せません"));
          };
        };
      })
  );
}

/**
 * 設定ドロワー (#41 の 4)。
 *
 * 面は操作列の中ではなく body 直下にあるので、トグルと同じ祖先では指せない。
 */
export const settingsDrawer = (page: Page): Locator =>
  page.locator("#settings-panel-body");

/** 設定パネルを開く。 */
export async function openSettings(page: Page): Promise<void> {
  await page.locator("#settings .settings-panel-toggle").click();
  await expect(settingsDrawer(page)).toBeVisible();
}

/** アセットドロワー (Phase 3-4)。設定と同じく body 直下にある。 */
export const assetsDrawer = (page: Page): Locator =>
  page.locator("#assets-panel-body");

/**
 * 作品メニューを開く (#87 の段階 3)。
 *
 * 中央のバー (実行ボタンと名前の右) から下りる面。開いている面を押し直すと
 * 閉じてしまうので、**閉じているときだけ押す**。
 */
export async function openWorkMenu(page: Page): Promise<void> {
  const toggle = page.locator("#work-menu-toggle");
  if ((await toggle.getAttribute("aria-expanded")) === "true") return;
  await toggle.click();
  await expect(page.locator("#work-menu")).toBeVisible();
}

/** アセットパネルを開く (開く口は作品メニューの中)。 */
export async function openAssets(page: Page): Promise<void> {
  await openWorkMenu(page);
  await page.locator("#assets-toggle").click();
  await expect(assetsDrawer(page)).toBeVisible();
}

/**
 * Gist を外す (開く口は作品メニューの中)。
 *
 * 確認ダイアログの応答は呼ぶ側が張る (`page.once("dialog", ...)`)。
 */
export async function detachGist(page: Page): Promise<void> {
  await openWorkMenu(page);
  await page.locator("#detach").click();
}

/** タグのダイアログを開く (開く口は作品メニューの中)。 */
export async function openTags(page: Page): Promise<void> {
  await openWorkMenu(page);
  await page.locator("#tags").click();
  await expect(page.locator("#tags-dialog")).toBeVisible();
}

/**
 * アセットパネルを閉じる。
 *
 * 開いたまま保存へ進めない — 面は画面上部の操作列に重なるので、`#save` を押そうと
 * するとパネルが受け取ってしまう (`hidden` にしない面なので、見えていないことでは
 * なく重なりが問題になる)。開くときの `#assets-toggle` もその下に隠れるので、
 * 閉じるのは面が持つ × から。
 */
export async function closeAssets(page: Page): Promise<void> {
  await assetsDrawer(page).locator(".assets-panel-close").click();
  await expect(assetsDrawer(page)).not.toHaveClass(/is-open/);
}

/** 一覧に並ぶアセット 1 件 (name はコードから引く名前)。 */
export function assetRow(page: Page, name: string): Locator {
  return assetsDrawer(page).locator(`.assets-row[data-asset="${name}"]`);
}

/**
 * 「持っているアセット」を開く (Phase 3-4b)。
 *
 * 作品の一覧の下に畳んで置いてある面なので、**開くまで中身は無い**。
 */
export async function openOwnedAssets(page: Page): Promise<void> {
  const summary = assetsDrawer(page).locator(".assets-owned-summary");
  await expect(summary).toBeVisible();
  if (!(await assetsDrawer(page).locator(".assets-owned[open]").count())) {
    await summary.click();
  }
  await expect(assetsDrawer(page).locator(".assets-owned[open]")).toBeVisible();
}

/**
 * 持っているアセット 1 件 (sha256 で掴む)。
 *
 * 作品の一覧が名前で掴めるのに対してこちらが sha256 なのは、**blob が名前を
 * 持たない**ため (名前は各作品の `assets.json` 側にある)。
 */
export function ownedAssetRow(page: Page, sha256: string): Locator {
  return assetsDrawer(page).locator(
    `.assets-owned-row[data-sha256="${sha256}"]`
  );
}

/**
 * 設定 1 項目のコントロール。
 *
 * 群はアコーディオンで、既定では畳んである群がある。**畳んでいれば開いてから**
 * 返す — 呼ぶ側が「その項目がどの群にあり、その群が開いているか」を知っている
 * 必要は無い。
 */
export async function settingControl(
  page: Page,
  key: string
): Promise<Locator> {
  const group = page.locator(
    `#settings-panel-body .settings-group:has([data-setting-key="${key}"])`
  );
  if ((await group.getAttribute("class"))?.includes("is-collapsed") === true) {
    await group.locator(".settings-group-toggle").click();
  }
  return group.locator(`[data-setting-key="${key}"] :is(input, select)`);
}
