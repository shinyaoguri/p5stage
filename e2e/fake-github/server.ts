/**
 * E2E 用の偽 GitHub (Phase 2-7 / ADR 0013)。
 *
 * Phase 2 の完了条件は「ログイン → 作成 → 保存 → 別ブラウザの作品ページで閲覧」。
 * GitHub を叩くのは **Worker (サーバ)** なので (ADR 0010)、ブラウザ側の仕掛けでは
 * その往復を差し替えられない。宛先ごと差し替えて、ここが GitHub の代わりに答える。
 *
 * 本物に似せるのは**実装が実際に見ている形だけ**。
 *
 * - 認可コードは 1 往復で使い切る (使い回しは `error` 付きの 200 で返す — 本物の罠)
 * - 書き込みの応答に `history[0].version` を載せる (これが作品のリビジョン)
 * - PATCH は**送られなかったファイルを残す**。`null` のファイルだけ消す
 * - `If-None-Match` が合えば 304 (配信の再検証がここを踏む)
 *
 * **知らないパスは 500 にして stderr に出す**。実装が新しい GitHub の口を叩き始めたら、
 * 黙って本物へ出ていくのではなくテストが落ちて気付ける形にする。
 *
 * Node で直接動かす (型注釈は実行時に落とされる)。ポートは第 1 引数。
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

// Node が直接実行するファイルなので、相対 import には拡張子が要る
// (spec 側は他の e2e ファイルと同じく拡張子なしで読む)。
import {
  BLOCKED_GIST_ID,
  FAKE_AUTHOR,
  FAKE_VIEWER,
  FOREIGN_ASSET_GIST_ID,
  FOREIGN_GIST_ID,
  FOREIGN_UNLISTED_GIST_ID,
} from "./viewer.ts";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  console.error("usage: node e2e/fake-github/server.ts <port>");
  process.exit(1);
}

/** GitHub の応答の形 (snake_case) に移した利用者。 */
const VIEWER = {
  id: FAKE_VIEWER.id,
  login: FAKE_VIEWER.login,
  avatar_url: FAKE_VIEWER.avatarUrl,
};

/** 交換後に配るトークン。実装が付け忘れたら分かるよう、素性の分かる値にする。 */
const ACCESS_TOKEN = "gho_e2e_access_token";

/** GitHub の応答の形に移した、種の作品の作者 (Phase 4-3)。 */
const AUTHOR = { id: FAKE_AUTHOR.id, login: FAKE_AUTHOR.login };

interface FakeGist {
  readonly id: string;
  description: string;
  readonly isPublic: boolean;
  /** ファイル名 → 中身。 */
  readonly files: Map<string, string>;
  /** 最新リビジョンの SHA。 */
  version: string;
  /**
   * 持ち主 (Phase 4-3)。
   *
   * ここまでは利用者 1 人しか出てこなかったので固定で足りていたが、フォークは
   * **他人の Gist** を相手にする (自分のものは fork できない — #44)。持ち主を
   * Gist 側に持たせないと、その状況を作れない。
   */
  readonly owner: { readonly id: number; readonly login: string };
}

const gists = new Map<string, FakeGist>();
/** 発行済みの認可コード (使うと消える)。 */
const authorizationCodes = new Set<string>();
let sequence = 0;

/** 本物と同じ形 (40 桁 hex) にする。実装は文字列としてしか見ない。 */
function nextVersion(): string {
  sequence += 1;
  return sequence.toString(16).padStart(40, "0");
}

/**
 * Gist の ID。
 *
 * 本物と同じく **16 進 32 桁**にする。取り込み (2-6) が受け付ける形がそれで
 * (`gist-ref.ts`)、素性の分かる文字を混ぜると弾かれてしまう。先頭の `e2e` は
 * 16 進としても読める並びなので、目印として残せる。
 *
 * **連番にしない**。このサーバは実行のたびに立ち上がり直すが、D1 は
 * `--persist-to` で残る。連番だと 2 回目の実行が前回と同じ ID を作り、
 * `sketches.gist_id` の UNIQUE 制約にぶつかる。
 */
function nextGistId(): string {
  return `e2e${randomUUID().replaceAll("-", "").slice(3)}`;
}

function etagOf(gist: FakeGist): string {
  return `"${gist.version}"`;
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

async function readJson(
  req: IncomingMessage
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

/** 本物の応答の形。実装の `parseGistContent` が読む項目だけ埋める。 */
function gistBody(gist: FakeGist): unknown {
  const files: Record<string, unknown> = {};
  for (const [name, content] of gist.files) {
    files[name] = {
      filename: name,
      content,
      truncated: false,
      size: content.length,
    };
  }
  return {
    id: gist.id,
    html_url: `https://gist.github.com/${gist.owner.login}/${gist.id}`,
    description: gist.description,
    public: gist.isPublic,
    owner: gist.owner,
    files,
    history: [{ version: gist.version }],
  };
}

/**
 * fork の応答 (Phase 4-3)。**読み出しと同じ形にしない**。
 *
 * 本物の `POST /gists/{id}/forks` が返すのは base-gist 相当で、`history` も
 * `files[].content` も入らない。ここを GET と同じ本文にすると、**E2E は通るのに
 * 本番だけが落ちる**経路ができる (実装はここから ID だけを読み、中身と版は
 * 改めて GET で取り直す)。
 */
function forkBody(gist: FakeGist): unknown {
  const files: Record<string, unknown> = {};
  for (const [name, content] of gist.files) {
    files[name] = { filename: name, truncated: false, size: content.length };
  }
  return {
    id: gist.id,
    html_url: `https://gist.github.com/${gist.owner.login}/${gist.id}`,
    description: gist.description,
    public: gist.isPublic,
    owner: gist.owner,
    files,
  };
}

/**
 * 資格を確かめる。
 *
 * 利用者のトークン (`Bearer`) と OAuth App の client credentials (`Basic`) の
 * どちらかが要る。**匿名は通さない** — 実装が資格を付け忘れたら、本物では
 * レート制限に化けて気付きにくい形で壊れるため、ここで落として見えるようにする。
 */
function hasCredentials(req: IncomingMessage): boolean {
  const value = req.headers.authorization ?? "";
  if (value === `Bearer ${ACCESS_TOKEN}`) return true;
  return value.startsWith("Basic ");
}

/** ファイルの更新を今の Gist に当てる (PATCH の意味論)。 */
function applyFiles(gist: FakeGist, raw: unknown): void {
  if (typeof raw !== "object" || raw === null) return;

  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    // null は削除。送られなかったファイルは触らない。
    if (value === null) {
      gist.files.delete(name);
      continue;
    }
    const content = (value as { content?: unknown }).content;
    if (typeof content === "string") gist.files.set(name, content);
  }
}

function handleGists(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  body: Record<string, unknown>
): boolean {
  if (!hasCredentials(req)) {
    json(res, 401, { message: "Requires authentication" });
    return true;
  }

  if (path === "/gists" && req.method === "POST") {
    const gist: FakeGist = {
      id: nextGistId(),
      description: typeof body.description === "string" ? body.description : "",
      isPublic: body.public === true,
      files: new Map(),
      version: nextVersion(),
      owner: VIEWER,
    };
    applyFiles(gist, body.files);
    gists.set(gist.id, gist);
    json(res, 201, gistBody(gist), { ETag: etagOf(gist) });
    return true;
  }

  const forkMatch = /^\/gists\/([^/]+)\/forks$/.exec(path);
  if (forkMatch !== null && req.method === "POST") {
    const source = gists.get(decodeURIComponent(forkMatch[1] ?? ""));
    if (source === undefined) {
      json(res, 404, { message: "Not Found" });
      return true;
    }

    /*
     * 本物と同じ断り方 (#44 の出発点)。
     *
     * 実装が **Gist の持ち主**で経路を分けている限りここへは来ない。
     * **来ないことを守る**ための口として置く。
     */
    if (source.owner.id === VIEWER.id) {
      json(res, 422, { message: "You cannot fork your own gist." });
      return true;
    }

    const fork: FakeGist = {
      id: nextGistId(),
      description: source.description,
      // 元が secret なら fork も secret (公開範囲の意図しない昇格は起きない — #44)。
      isPublic: source.isPublic,
      files: new Map(source.files),
      version: nextVersion(),
      owner: VIEWER,
    };
    gists.set(fork.id, fork);
    json(res, 201, forkBody(fork), { ETag: etagOf(fork) });
    return true;
  }

  const match = /^\/gists\/([^/]+)$/.exec(path);
  if (match === null) return false;

  const id = decodeURIComponent(match[1] ?? "");
  const gist = gists.get(id);
  if (gist === undefined) {
    json(res, 404, { message: "Not Found" });
    return true;
  }

  if (req.method === "GET") {
    // 条件付き GET。合えば中身を返さない (本物ではレート制限も消費しない)。
    if (req.headers["if-none-match"] === etagOf(gist)) {
      res.writeHead(304, { ETag: etagOf(gist) });
      res.end();
      return true;
    }
    json(res, 200, gistBody(gist), { ETag: etagOf(gist) });
    return true;
  }

  if (req.method === "PATCH") {
    applyFiles(gist, body.files);
    if (typeof body.description === "string")
      gist.description = body.description;
    // 保存のたびにリビジョンが進む = 履歴が増える (要件 3.2)。
    gist.version = nextVersion();
    json(res, 200, gistBody(gist), { ETag: etagOf(gist) });
    return true;
  }

  if (req.method === "DELETE") {
    gists.delete(id);
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}

/**
 * 他人の Gist を 1 つ置く (Phase 4-3)。
 *
 * D1 と R2 の種 (`e2e/seed.sql` / `seed-content.json`) が持つ作品と `gist_id` で
 * 対応する。フォークは GitHub 側にも実物がないと fork API まで辿り着けない。
 *
 * **中身は R2 の種と同じファイルから読む。** 書き写すと、片方だけ直したときに
 * 「作品ページで見たものと、フォークで複製されるもの」が静かにずれる。
 *
 * 既にある種の Gist (`e2e-gist-public` など) はここに登録しない。あれらが GitHub 側に
 * **無い**ことを前提にしたテストがあり、版もこちらの連番とは合わない。
 */
function seedForeignGists(): void {
  for (const [id, description, isPublic, content, owner] of [
    [
      FOREIGN_GIST_ID,
      "E2E 他人のスケッチ",
      true,
      "../seed-content.json",
      AUTHOR,
    ],
    // fork は元が secret なら secret になる。系譜の見せ方が変わる側。
    [
      FOREIGN_UNLISTED_GIST_ID,
      "E2E 他人の限定公開スケッチ",
      false,
      "../seed-content.json",
      AUTHOR,
    ],
    // アセットを使う方。フォークで他人の blob が計上されるかを見る側。
    [
      FOREIGN_ASSET_GIST_ID,
      "E2E 他人のアセット作品",
      true,
      "../seed-content-assets.json",
      AUTHOR,
    ],
    // 作者が GitHub 側で壊した自分の Gist (#70)。配信の再検証がこれを拾う。
    // **持ち主はログインする人**で、上の 3 つ (他人の Gist) とはそこが違う。
    [
      BLOCKED_GIST_ID,
      "E2E 壊れたマニフェストの作品",
      true,
      "../seed-content-assets.json",
      VIEWER,
    ],
  ] as const) {
    const files = JSON.parse(
      readFileSync(new URL(content, import.meta.url), "utf8")
    ) as Record<string, string>;

    gists.set(id, {
      id,
      description,
      isPublic,
      files: new Map(Object.entries(files)),
      version: nextVersion(),
      owner,
    });
  }
}

seedForeignGists();

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const path = url.pathname;
    const body =
      req.method === "POST" || req.method === "PATCH"
        ? await readJson(req)
        : {};

    // 認可画面の代わり。本物はここで人が「許可」を押す。
    if (path === "/login/oauth/authorize" && req.method === "GET") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state") ?? "";
      if (redirectUri === null) {
        json(res, 400, { message: "redirect_uri is required" });
        return;
      }
      sequence += 1;
      const code = `e2e-code-${sequence}`;
      authorizationCodes.add(code);

      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      back.searchParams.set("state", state);
      res.writeHead(302, { Location: back.href });
      res.end();
      return;
    }

    if (path === "/login/oauth/access_token" && req.method === "POST") {
      const code = typeof body.code === "string" ? body.code : "";
      // 使い回しは**エラー本文つきの 200**。本物と同じ返し方にしておく
      // (ステータスだけ見ている実装はここで気付ける)。
      if (!authorizationCodes.delete(code)) {
        json(res, 200, {
          error: "bad_verification_code",
          error_description: "The code passed is incorrect or expired.",
        });
        return;
      }
      json(res, 200, {
        access_token: ACCESS_TOKEN,
        token_type: "bearer",
        scope: "gist",
      });
      return;
    }

    if (path === "/user" && req.method === "GET") {
      if (!hasCredentials(req)) {
        json(res, 401, { message: "Requires authentication" });
        return;
      }
      json(res, 200, VIEWER);
      return;
    }

    if (path === "/gists" || path.startsWith("/gists/")) {
      if (handleGists(req, res, path, body)) return;
    }

    // 実装が新しい口を叩き始めた。黙って本物へ出ていく形にしない。
    console.error(`[fake-github] 未対応の要求: ${req.method} ${path}`);
    json(res, 500, { message: "fake-github does not implement this endpoint" });
  })();
});

server.listen(port, () => {
  console.log(`[fake-github] ready on http://localhost:${port}`);
});
