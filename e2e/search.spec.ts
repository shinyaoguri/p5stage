/**
 * 検索 (Phase 5 / ADR 0020)。言葉から作品へ辿る発見の線。
 *
 * ここで確かめるのは 4 つ。**未ログインで引けること**、引ける先が
 * タイトル・説明・タグの 3 つであること、**一覧の選定が他の一覧と揃っていること**
 * (限定公開・未保存・削除済みは同じ語で当たっても出ない)、そして
 * **保存した作品がその場で索引に載ること** (同期はトリガーが持つ — migrations/0012)。
 *
 * 読み側の種は `e2e/seed.sql` が置く。索引そのものは種が触らない — 種が
 * `sketches` へ入れた時点でトリガーが載せるので、**索引を別に蒔く道は無い方が
 * 正しい** (蒔けてしまうと、同期が壊れていても種のおかげで緑になる)。
 */

import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { login, openEditor, saveNewSketch } from "./helpers";

/** 種として置いてある作品 (e2e/seed.sql)。 */
const PUBLIC_TITLE = "E2E 公開スケッチ";
const UNLISTED_TITLE = "E2E 限定公開スケッチ";

test.describe("言葉で探す", () => {
  test("未ログインでタイトルの一部から引ける", async ({ page }) => {
    await page.goto("/search?q=" + encodeURIComponent("公開スケッチ"));

    await expect(page.getByRole("link", { name: PUBLIC_TITLE })).toBeVisible();
  });

  test("説明の言葉でも引ける", async ({ page }) => {
    // 種の説明は「E2E のための作品です。」。タイトルにはこの言葉が無いので、
    // 当たったなら説明が索引に入っている。
    await page.goto("/search?q=" + encodeURIComponent("ための作品"));

    await expect(page.getByRole("link", { name: PUBLIC_TITLE })).toBeVisible();
  });

  test("タグの言葉でも引ける", async ({ page }) => {
    // 種のタグ `e2e-別のタグ` から。タイトルにも説明にも無い言葉なので、
    // タグが索引に入っていなければ当たらない。
    await page.goto("/search?q=" + encodeURIComponent("別のタグ"));

    await expect(page.getByRole("link", { name: PUBLIC_TITLE })).toBeVisible();
  });

  test("日本語の 3 文字でも引ける (trigram の窓と同じ長さ)", async ({
    page,
  }) => {
    await page.goto("/search?q=" + encodeURIComponent("スケッチ"));

    await expect(page.getByRole("link", { name: PUBLIC_TITLE })).toBeVisible();
  });
});

test.describe("検索結果の選定", () => {
  test("限定公開は同じ言葉で当たっても出ない", async ({ page }) => {
    // 「限定公開スケッチ」は「公開スケッチ」を含むので、**索引の上では当たる**。
    // それでも出ないことを見る (絞りは `sketches.visibility` 側 — ADR 0020)。
    await page.goto("/search?q=" + encodeURIComponent("公開スケッチ"));

    // 結果が空だから無い、と区別する。公開の種が出た上で他が無いことを見る。
    await expect(page.getByRole("link", { name: PUBLIC_TITLE })).toBeVisible();
    await expect(page.getByText(UNLISTED_TITLE)).toHaveCount(0);
  });

  test("未保存・削除済みの作品は出ない", async ({ page }) => {
    for (const word of ["未保存スケ", "削除済みス"]) {
      await page.goto("/search?q=" + encodeURIComponent(word));

      await expect(page.getByText("見つかりませんでした")).toBeVisible();
    }
  });

  test("当てはまる作品が無ければそう言う", async ({ page }) => {
    await page.goto(
      "/search?q=" + encodeURIComponent("みつからないはずの言葉")
    );

    await expect(page.getByText("見つかりませんでした")).toBeVisible();
  });

  test("2 文字の語は引かずに案内する", async ({ page }) => {
    // trigram の索引に 2 文字以下の語は無い。「0 件でした」と言うと、
    // 打ち方の問題が「そんな作品は無い」に化ける。
    await page.goto("/search?q=" + encodeURIComponent("公開"));

    await expect(
      page.getByText("3 文字以上の語で探してください")
    ).toBeVisible();
    await expect(page.getByRole("link", { name: PUBLIC_TITLE })).toHaveCount(0);
  });

  test("短くて除いた語は理由として出す", async ({ page }) => {
    await page.goto("/search?q=" + encodeURIComponent("公開スケッチ 波"));

    await expect(page.getByText("検索語から除きました")).toBeVisible();
    await expect(page.getByRole("link", { name: PUBLIC_TITLE })).toBeVisible();
  });
});

test.describe("検索への動線", () => {
  test("トップページの入力欄から検索できる", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("searchbox").fill("公開スケッチ");
    await page.getByRole("button", { name: "検索" }).click();

    await expect(page).toHaveURL(
      `/search?q=${encodeURIComponent("公開スケッチ")}`
    );
    await expect(page.getByRole("link", { name: PUBLIC_TITLE })).toBeVisible();
  });
});

test.describe("保存した作品の索引", () => {
  test("保存した作品がその場で検索に出る", async ({ page }) => {
    // 索引の同期はトリガーが持つ (migrations/0012)。保存の口から呼ぶ形にして
    // いないので、**ここが緑であることが同期の唯一の証拠**になる。
    // 語は実行ごとに変える — 前の実行が残した作品と取り違えると、同期が
    // 壊れていても緑になる。
    const word = `e2e${randomUUID().slice(0, 8)}`;
    const title = `E2E 検索の作品 ${word}`;

    await openEditor(page);
    await login(page);
    await saveNewSketch(page, title, "public");

    await page.goto(`/search?q=${encodeURIComponent(word)}`);

    await expect(page.getByRole("link", { name: title })).toBeVisible();
  });
});
