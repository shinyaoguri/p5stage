/**
 * ログインから閲覧までの通し (Phase 2-7)。
 *
 * Phase 2 の完了条件そのもの — **ログイン → 作成 → 保存 (Gist リビジョン) →
 * 別ブラウザの作品ページで閲覧**。他の spec が「ログインが要る操作は踏めない」と
 * 書いて避けてきた道を、ここだけが通しで踏む。
 *
 * GitHub の往復は偽 GitHub が受ける (`fake-github/server.ts` / ADR 0013)。
 * 差し替わっているのは**宛先だけ**で、認可コードの往復も `state` の検証も
 * `__Host-` cookie の発行も本物と同じ経路を通る。
 *
 * 閲覧側を `browser.newContext()` で開くのは、**cookie を持たない人**として見るため。
 * 同じコンテキストで開くと、自分のセッションで見えているだけかもしれない。
 */

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { FAKE_VIEWER } from "./fake-github/viewer";
import {
  accountMenuToggle,
  addFile,
  fileTab,
  hasSketchCanvas,
  login,
  logout,
  openEditor,
  saveAgain,
  saveButton,
  saveNewSketch,
  saveStatus,
  typeIntoEditor,
} from "./helpers";
import { FAKE_GITHUB_ORIGIN, WEB_ORIGIN } from "./origins";

/** 作品ページのコード表示から探す目印。 */
const MARKER = "E2E_FLOW_MARKER";

/** 1 行で書ける形にする (Monaco の自動補完と喧嘩しないため — helpers.ts)。 */
function sketchCode(marker: string): string {
  return `function setup(){ createCanvas(120,120); background(20); noLoop(); } // ${marker}`;
}

/** ログインして、スケッチを書ける状態にする。 */
async function signedInEditor(page: Page): Promise<void> {
  await openEditor(page);
  await login(page);
}

/** 保存パネルに出ている Gist リンクから、正本の Gist ID を取る。 */
async function savedGistId(page: Page): Promise<string> {
  const href = await page
    .getByRole("link", { name: "Gist" })
    .getAttribute("href");
  const id = (href ?? "").split("/").pop() ?? "";
  expect(id).not.toBe("");
  return id;
}

/**
 * **正本 (Gist) に何が書かれたか**を直接見る。
 *
 * 作品ページに出るのは R2 の写しで、これは保存要求の中身をそのまま書いたもの
 * (ADR 0011)。つまり作品ページだけを見ていると「Gist には書けていないのに
 * 正しく見える」状態を見逃す。正本の確認はここでしかできない。
 */
async function readGistFiles(
  request: APIRequestContext,
  gistId: string
): Promise<Record<string, string>> {
  // 偽 GitHub は資格の無い要求を 401 で返す。中身は問わないので app 側の形で足りる。
  const response = await request.get(`${FAKE_GITHUB_ORIGIN}/gists/${gistId}`, {
    headers: { Authorization: "Basic e2e" },
  });
  expect(response.status()).toBe(200);

  const body = (await response.json()) as {
    files: Record<string, { content: string }>;
  };
  return Object.fromEntries(
    Object.entries(body.files).map(([name, file]) => [name, file.content])
  );
}

test.describe("ログインの往復", () => {
  test("認可から戻るとログイン済みになり、セッションは __Host- cookie に載る", async ({
    page,
    context,
  }) => {
    await signedInEditor(page);

    // 誰としてログインしているかは、操作列ではアバター 1 つに畳んである (#41 の 2)。
    // 文字では出ないので、ボタンの名前 (ホバーと支援技術が読むもの) で確かめる。
    await expect(accountMenuToggle(page)).toHaveAttribute(
      "aria-label",
      new RegExp(FAKE_VIEWER.login)
    );

    const session = (await context.cookies()).find(
      (cookie) => cookie.name === "__Host-p5stage_session"
    );
    // 属性が 1 つでも欠けるとブラウザが `__Host-` として扱わず、
    // 実行オリジン (same-site) から上書きできてしまう (ADR 0008)。
    expect(session).toMatchObject({
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    });
    expect(session?.domain).toBe("localhost");
  });

  test("ログアウトすると未ログインに戻る", async ({ page }) => {
    await signedInEditor(page);

    await logout(page);

    await expect(page.locator("#login")).toBeVisible();
    await expect(accountMenuToggle(page)).toHaveCount(0);
  });
});

test.describe("保存から閲覧まで", () => {
  test("保存の状態は保存アイコン自身が持つ", async ({ page }) => {
    await signedInEditor(page);

    // まだ一度も保存していない。
    await expect(saveButton(page)).toHaveAttribute(
      "data-save-status",
      "unsaved"
    );

    await saveNewSketch(page, "状態の見え方", "unlisted");
    // 保存できた = 緑 (#41 の 6)。
    await expect(saveButton(page)).toHaveAttribute("data-save-status", "saved");

    await typeIntoEditor(page, sketchCode("E2E_DIRTY"));

    // 書き換えたら未保存の変更 = 橙のドット。文字で出していた頃と違い、書いて
    // いる間ずっと同じ場所に出続けるものではない。
    await expect(saveButton(page)).toHaveAttribute("data-save-status", "dirty");
    // **色もドットも読み上げられない**ので、文字は支援技術向けに残してある。
    await expect(saveStatus(page)).toHaveText("未保存の変更があります");
    // 押したときに何が起きるかだけでなく、今どうなっているかも名前から読める。
    await expect(saveButton(page)).toHaveAttribute(
      "aria-label",
      "保存 (未保存の変更があります)"
    );
  });

  test("保存した作品を、未ログインの別ブラウザが開いて実行できる", async ({
    page,
    browser,
    request,
  }) => {
    await signedInEditor(page);
    await typeIntoEditor(page, sketchCode(MARKER));

    const id = await saveNewSketch(page, "通しの作品", "public");

    // 正本が自分の GitHub にあることが画面から辿れる (要件 3.1)。
    await expect(page.getByRole("link", { name: "Gist" })).toHaveAttribute(
      "href",
      /gist\.github\.com\//
    );
    // その Gist に中身が入っている (正本は Gist — ADR 0002)。
    // ファイル名で引くときは**キーの一覧**を見る。`toHaveProperty` はドットを
    // パスの区切りとして読むので、拡張子付きの名前とは噛み合わない。
    const gistFiles = await readGistFiles(request, await savedGistId(page));
    expect(gistFiles["sketch.js"]).toContain(MARKER);
    expect(Object.keys(gistFiles)).toContain("index.html");

    // ここから先は cookie を持たない人として見る。
    const viewer = await browser.newContext({ baseURL: WEB_ORIGIN });
    const viewerPage = await viewer.newPage();
    try {
      // 恒久リンクから入っても正典 URL に着く (ADR 0011)。
      await viewerPage.goto(`/s/${id}`);
      expect(new URL(viewerPage.url()).pathname).toBe(
        `/@${FAKE_VIEWER.login}/${id}`
      );

      await expect(viewerPage.locator("h1")).toHaveText("通しの作品");
      await expect(viewerPage.locator(".sketch-author")).toContainText(
        FAKE_VIEWER.login
      );
      // 中身は R2 の写しから出る (閲覧経路は GitHub を叩かない — ADR 0011)。
      await expect(
        viewerPage.locator('.sketch-file[data-file="sketch.js"]')
      ).toContainText(MARKER);

      await expect
        .poll(() => hasSketchCanvas(viewerPage), { timeout: 15_000 })
        .toBe(true);
    } finally {
      await viewer.close();
    }
  });

  test("保存し直すと、正本も閲覧者に見える中身も新しくなる", async ({
    page,
    browser,
    request,
  }) => {
    await signedInEditor(page);
    await typeIntoEditor(page, sketchCode("BEFORE_MARKER"));
    const id = await saveNewSketch(page, "書き直す作品", "public");
    const gistId = await savedGistId(page);

    // 2 回目は既存の Gist への PATCH になり、新しいリビジョンが配信に載る。
    await typeIntoEditor(page, sketchCode("AFTER_MARKER"));
    await saveAgain(page);

    // 正本が書き変わっていること (作品ページだけ見ていると、Gist へ届いて
    // いなくても写しのおかげで正しく見えてしまう)。
    expect((await readGistFiles(request, gistId))["sketch.js"]).toContain(
      "AFTER_MARKER"
    );

    const viewer = await browser.newContext({ baseURL: WEB_ORIGIN });
    const viewerPage = await viewer.newPage();
    try {
      await viewerPage.goto(`/@${FAKE_VIEWER.login}/${id}`);

      const code = viewerPage.locator('.sketch-file[data-file="sketch.js"]');
      await expect(code).toContainText("AFTER_MARKER");
      await expect(code).not.toContainText("BEFORE_MARKER");
    } finally {
      await viewer.close();
    }
  });

  test("エディタで消したファイルは Gist からも消える", async ({
    page,
    browser,
    request,
  }) => {
    // PATCH は**送らなかったファイルを残す**ので、消えた名前に null を送る必要がある
    // (gist-payload.ts)。ここが抜けると Gist にファイルが残り、次に開いたとき甦る。
    await signedInEditor(page);
    await addFile(page, "memo.txt");
    await typeIntoEditor(page, "消えるはずのファイル");

    const id = await saveNewSketch(page, "ファイルを消す作品", "public");
    const gistId = await savedGistId(page);
    expect(Object.keys(await readGistFiles(request, gistId))).toContain(
      "memo.txt"
    );

    page.once("dialog", (dialog) => void dialog.accept());
    await fileTab(page, "memo.txt").locator(".file-tab-remove").click();
    await saveAgain(page);

    // 正本から消えていること。写し (R2) は保存要求の中身をそのまま書くので、
    // 作品ページだけ見ていると Gist に残ったままでも消えたように見える。
    const names = Object.keys(await readGistFiles(request, gistId));
    expect(names).not.toContain("memo.txt");
    expect(names).toContain("sketch.js");

    const viewer = await browser.newContext({ baseURL: WEB_ORIGIN });
    const viewerPage = await viewer.newPage();
    try {
      await viewerPage.goto(`/@${FAKE_VIEWER.login}/${id}`);

      await expect(
        viewerPage.locator('.sketch-tab[data-file="sketch.js"]')
      ).toBeVisible();
      await expect(
        viewerPage.locator('.sketch-tab[data-file="memo.txt"]')
      ).toHaveCount(0);
    } finally {
      await viewer.close();
    }
  });
});

test.describe("正本の出入り (Phase 2-6)", () => {
  test("Gist を外すと作品ページから中身が消え、次の保存で新しい Gist ができる", async ({
    page,
    browser,
  }) => {
    await signedInEditor(page);
    await typeIntoEditor(page, sketchCode(MARKER));
    const id = await saveNewSketch(page, "外す作品", "public");

    const firstGist = await page
      .getByRole("link", { name: "Gist" })
      .getAttribute("href");

    // 確認の 1 行目は「どちらも削除しません」(ADR 0012)。
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("どちらも削除しません");
      void dialog.accept();
    });
    await page.locator("#detach").click();
    await expect(page.locator("#detach")).toBeHidden();

    const viewer = await browser.newContext({ baseURL: WEB_ORIGIN });
    const viewerPage = await viewer.newPage();
    try {
      // 写しだけ配り続けると、切り離したのに閲覧者から見て何も変わらない (ADR 0012)。
      await viewerPage.goto(`/@${FAKE_VIEWER.login}/${id}`);
      await expect(viewerPage.locator(".sketch-notice")).toContainText(
        "まだ保存されていません"
      );
      await expect(viewerPage.locator(".sketch-file")).toHaveCount(0);
    } finally {
      await viewer.close();
    }

    // 外した後の保存は**新しい Gist**を作る (元の Gist はそのまま残っている)。
    await typeIntoEditor(page, sketchCode("REATTACHED_MARKER"));
    await saveAgain(page);

    await expect(page.getByRole("link", { name: "Gist" })).not.toHaveAttribute(
      "href",
      String(firstGist)
    );
  });

  test("外した Gist を取り込み直すと、その Gist を正本にした作品ができる", async ({
    page,
  }) => {
    await signedInEditor(page);
    await typeIntoEditor(page, sketchCode("ADOPTED_MARKER"));
    const first = await saveNewSketch(page, "取り込む作品", "public");

    const gistUrl = await page
      .getByRole("link", { name: "Gist" })
      .getAttribute("href");
    expect(gistUrl).not.toBeNull();

    // 外しておかないと「既に取り込まれている Gist」として断られる (adopt.ts)。
    page.once("dialog", (dialog) => void dialog.accept());
    await page.locator("#detach").click();
    await expect(page.locator("#detach")).toBeHidden();

    await page.locator("#adopt").click();
    await page.locator("#adopt-ref").fill(String(gistUrl));
    await page.locator("#adopt-confirm").click();

    // 別の作品として立ち上がり、その Gist が正本になる。取り込みは「開き直した」
    // のと同じ扱いなので、時刻の付かない「保存済み」になる。時刻が付くかどうかは
    // アイコンの色に出ないので、支援技術へ渡している文字の方で見る (#41 の 6)。
    await expect(saveButton(page)).toHaveAttribute("data-save-status", "saved");
    await expect(saveStatus(page)).toHaveText("保存済み");
    const adopted = new URL(page.url()).searchParams.get("sketch");
    expect(adopted).not.toBe(first);

    await expect(page.getByRole("link", { name: "Gist" })).toHaveAttribute(
      "href",
      String(gistUrl)
    );
    // 取り込んだ中身がそのままエディタに載る (もう一度 GitHub を読みに行かない)。
    await expect(page.locator("#editor")).toContainText("ADOPTED_MARKER");
  });
});
