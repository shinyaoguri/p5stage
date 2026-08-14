/**
 * 画面上部中央の実行ボタンと作品の名前 (#41 の 3) の回帰テスト。
 *
 * 状態を文字で出さなくなった分、**アイコンとボタンの名前が状態そのもの**になる。
 * ここが合っていないと、動いているのか・画面が古いのかを知る手掛かりが無くなる。
 *
 * 名前が保存を跨いで残ることも見る。自動生成した名前が消えると、保存するたびに
 * 別の作品として並ぶ。
 */

import { expect, test } from "@playwright/test";

import {
  consolePanel,
  hasSketchCanvas,
  login,
  openEditor,
  projectName,
  readStoredDraft,
  saveNewSketch,
  setProjectName,
  typeIntoEditor,
} from "./helpers";

test.describe("実行ボタン", () => {
  test("開いた直後は動いているので、押すと止まる", async ({ page }) => {
    await openEditor(page);
    await expect.poll(() => hasSketchCanvas(page)).toBe(true);

    const button = page.locator("#run");
    // 実行中は ■。文字が無いので、名前が「今押すと何が起きるか」を持つ。
    await expect(button).toHaveAttribute("aria-label", "停止");

    await button.click();

    await expect(button).toHaveAttribute("aria-label", /^実行/);
    await expect.poll(() => hasSketchCanvas(page)).toBe(false);

    // 止まった状態から押すと動き出す。
    await button.click();
    await expect(button).toHaveAttribute("aria-label", "停止");
    await expect.poll(() => hasSketchCanvas(page)).toBe(true);
  });

  test("実行してから書き換えると、画面が古いことをドットで示す", async ({
    page,
  }) => {
    await openEditor(page);

    const button = page.locator("#run");
    await expect(button).not.toHaveClass(/is-stale/);

    await typeIntoEditor(page, 'console.log("e2e-stale");');
    await expect(button).toHaveClass(/is-stale/);

    // 実行すれば画面が今の中身に追いつくので、印は消える。
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(consolePanel(page)).toContainText("e2e-stale");
    await expect(button).not.toHaveClass(/is-stale/);
  });

  test("止めている間はドットを出さない", async ({ page }) => {
    await openEditor(page);

    await typeIntoEditor(page, 'console.log("e2e-stopped");');
    await expect(page.locator("#run")).toHaveClass(/is-stale/);

    // 止まっている間は「画面が古い」という状態そのものが無い。
    await page.locator("#run").click();
    await expect(page.locator("#run")).not.toHaveClass(/is-stale/);
  });
});

test.describe("作品の名前", () => {
  test("保存前から名前が付いている", async ({ page }) => {
    await openEditor(page);

    // adj-noun-xxx。固定の「無題」ではないので、作品が増えても見分けが付く。
    // 保存するまで空欄、では常時リネームできる意味が無い。
    expect(await projectName(page).inputValue()).toMatch(
      /^[a-z]+-[a-z]+-[0-9a-z]{3}$/
    );
  });

  test("付けた名前は保存前でもリロードを跨いで残る", async ({ page }) => {
    await openEditor(page);
    await setProjectName(page, "e2e-手で付けた名前");

    // 名前の置き場は下書き。載るまで待たずにリロードすると、書けなかったのか
    // 復元できなかったのか切り分けられない。
    await expect
      .poll(async () => {
        const draft = (await readStoredDraft(page)) as {
          title?: string;
        } | null;
        return draft?.title ?? null;
      })
      .toBe("e2e-手で付けた名前");

    await page.reload();
    await expect(projectName(page)).toHaveValue("e2e-手で付けた名前");
  });

  test("空にして離れると元の名前に戻る", async ({ page }) => {
    await openEditor(page);
    const before = await projectName(page).inputValue();

    const input = projectName(page);
    await input.click();
    await input.press("ControlOrMeta+a");
    await input.press("Delete");
    await input.blur();

    // 空のまま置くと名前の無い作品になる。サーバ側も空を既定名へ倒すので、
    // 画面と食い違わないよう戻す。
    await expect(input).toHaveValue(before);
  });

  test("保存した後に付け替えると、作品ページにも新しい名前が出る", async ({
    page,
  }) => {
    await openEditor(page);
    await login(page);
    const id = await saveNewSketch(page, "e2e-元の名前", "public");

    await setProjectName(page, "e2e-付け替えた名前");
    // 書き戻しは手が止まってから。着地を待たずに開くと前の名前が出る。
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`/api/sketches/${id}`);
          if (!response.ok()) return null;
          const body = (await response.json()) as {
            sketch?: { title?: string };
          };
          return body.sketch?.title ?? null;
        },
        { message: "名前が正本へ書き戻されていません" }
      )
      .toBe("e2e-付け替えた名前");
  });
});
