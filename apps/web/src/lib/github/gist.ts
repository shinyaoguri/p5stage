/**
 * Gist API のクライアント (Phase 2-3)。
 *
 * **叩くのは Worker で、ブラウザではない** (ADR 0010)。トークンはサーバ側に封じてある
 * ので (ADR 0009) そもそもブラウザからは叩けないし、閲覧のトラフィックを GitHub へ
 * 直接流さない約束 (要件 5.2) とも同じ向きになる。
 *
 * 応答の検証は自前。zod は Phase 3 で `assets.json` を扱うときに入れる。
 */

import type { SketchFiles } from "@p5stage/shared";

import type { GistFilePayload } from "../sketches/gist-payload";

/**
 * 失敗の種類。呼び出し側は**種類で分岐する** (文言で分岐させない)。
 *
 * - `auth` トークンが無効。ログインをやり直してもらうしかない
 * - `not_found` Gist が無い。GitHub 側で消された場合を含む (要件 6 の tombstone)
 * - `rate_limit` レート制限。時間をおけば直る
 * - `rejected` GitHub が内容を受け付けなかった (422)。送る側の問題
 * - `api` それ以外の GitHub 起因
 * - `network` GitHub まで届かなかった
 */
export type GistErrorKind =
  "auth" | "not_found" | "rate_limit" | "rejected" | "api" | "network";

export class GistError extends Error {
  readonly kind: GistErrorKind;

  constructor(kind: GistErrorKind, message: string) {
    super(message);
    this.name = "GistError";
    this.kind = kind;
  }
}

/** 書き込みの結果。`revision` が作品のスナップショット (要件 3.2)。 */
export interface GistRevision {
  readonly id: string;
  /** 人が開ける URL。 */
  readonly url: string;
  /** リビジョンの SHA。履歴の 1 点を指す。 */
  readonly revision: string;
}

/** 読み出した Gist の中身。 */
export interface GistContent extends GistRevision {
  readonly files: SketchFiles;
  /**
   * 大きすぎて中身を取れなかったファイル名 (1MB 超)。
   *
   * 名前だけは分かるので分けて返す。**削除の差分を作るときは名前が要る**一方、
   * 中身を見せる側は「取れていない」ことを知らないと欠けたまま表示してしまう。
   */
  readonly truncated: readonly string[];
  readonly description: string;
}

const API_ROOT = "https://api.github.com";

/**
 * どの資格で GitHub を叩くか。
 *
 * - `user` 利用者自身のトークン。**書き込みは必ずこちら** (要件 5.2)。5,000 回/時/人
 * - `app` OAuth App の client credentials。**公開情報の読み出し専用**。
 *   5,000 回/時/app。閲覧経路の再検証に使う (ADR 0011)
 *
 * 匿名 (資格なし) は選択肢に入れない。60 回/時/IP で、Workers の出口 IP は
 * 多数の利用者と共有される。304 がレート制限を消費しなくなるのも認証付きの場合だけ。
 */
export type GistAuth =
  | { readonly kind: "user"; readonly token: string }
  | {
      readonly kind: "app";
      readonly clientId: string;
      readonly clientSecret: string;
    };

export function userAuth(token: string): GistAuth {
  return { kind: "user", token };
}

export function appAuth(clientId: string, clientSecret: string): GistAuth {
  return { kind: "app", clientId, clientSecret };
}

/** 資格を `Authorization` の値へ移す。 */
export function authorizationValue(auth: GistAuth): string {
  if (auth.kind === "user") return `Bearer ${auth.token}`;
  return `Basic ${btoa(`${auth.clientId}:${auth.clientSecret}`)}`;
}

/** User-Agent は GitHub API の要件 (無いと 403)。 */
function headers(auth: GistAuth): HeadersInit {
  return {
    Authorization: authorizationValue(auth),
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "p5stage",
    "Content-Type": "application/json",
  };
}

/**
 * GitHub からの返事を種類に分ける。
 *
 * レート制限は 403 でも来る (二次レート制限)。ステータスだけでは認可の失敗と
 * 区別が付かないので、残数のヘッダを見て分ける。
 */
async function toGistError(response: Response): Promise<GistError> {
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (
    response.status === 429 ||
    (response.status === 403 && remaining === "0")
  ) {
    return new GistError(
      "rate_limit",
      "GitHub の利用制限に達しました。時間をおいてお試しください"
    );
  }
  if (response.status === 401) {
    return new GistError(
      "auth",
      "GitHub の認証が切れました。ログインし直してください"
    );
  }
  if (response.status === 404) {
    return new GistError("not_found", "Gist が見つかりません");
  }

  const message = await response
    .json()
    .then((body) => (body as { message?: string }).message)
    .catch(() => undefined);

  if (response.status === 422) {
    return new GistError(
      "rejected",
      message ?? "GitHub が内容を受け付けませんでした"
    );
  }
  return new GistError(
    "api",
    message ?? `GitHub API エラー (${response.status})`
  );
}

async function callGistApi(
  url: string,
  token: string,
  init: RequestInit
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: headers(userAuth(token)) });
  } catch {
    throw new GistError("network", "GitHub に接続できませんでした");
  }

  if (!response.ok) throw await toGistError(response);

  try {
    return await response.json();
  } catch {
    throw new GistError("api", "GitHub の応答を解釈できませんでした");
  }
}

interface RawGist {
  id?: unknown;
  html_url?: unknown;
  description?: unknown;
  history?: unknown;
  files?: unknown;
}

/**
 * 書き込みの応答から、作ったリビジョンを取り出す。
 *
 * `history[0]` が最新。ここが読めないと「保存できたが、どのリビジョンか分からない」に
 * なる。後から辿れない保存は履歴として意味を持たないので、欠けていれば失敗にする。
 */
export function parseGistRevision(value: unknown): GistRevision {
  const gist = (value ?? {}) as RawGist;
  const history = Array.isArray(gist.history) ? gist.history : [];
  const version = (history[0] as { version?: unknown } | undefined)?.version;

  if (
    typeof gist.id !== "string" ||
    typeof gist.html_url !== "string" ||
    typeof version !== "string"
  ) {
    throw new GistError("api", "GitHub の応答が想定と違う形でした");
  }

  return { id: gist.id, url: gist.html_url, revision: version };
}

/** 読み出しの応答を、スケッチのファイル構成へ移す。 */
export function parseGistContent(value: unknown): GistContent {
  const revision = parseGistRevision(value);
  const gist = (value ?? {}) as RawGist;

  if (typeof gist.files !== "object" || gist.files === null) {
    throw new GistError("api", "GitHub の応答が想定と違う形でした");
  }

  const files: Record<string, string> = {};
  const truncated: string[] = [];

  for (const [name, raw] of Object.entries(
    gist.files as Record<string, unknown>
  )) {
    // 削除されたファイルは null で並ぶことがある。
    if (typeof raw !== "object" || raw === null) continue;
    const file = raw as { content?: unknown; truncated?: unknown };

    if (file.truncated === true || typeof file.content !== "string") {
      truncated.push(name);
      continue;
    }
    files[name] = file.content;
  }

  return {
    ...revision,
    files,
    truncated,
    description: typeof gist.description === "string" ? gist.description : "",
  };
}

export interface CreateGistOptions {
  readonly token: string;
  readonly files: GistFilePayload;
  readonly description: string;
  /**
   * 公開 Gist にするか。
   *
   * **作成時にしか決められない**。GitHub は後から公開範囲を変えられないので、
   * 作品の公開範囲もここで固定される (ADR 0010)。
   */
  readonly isPublic: boolean;
}

export async function createGist(
  options: CreateGistOptions
): Promise<GistRevision> {
  const body = await callGistApi(`${API_ROOT}/gists`, options.token, {
    method: "POST",
    body: JSON.stringify({
      description: options.description,
      public: options.isPublic,
      files: options.files,
    }),
  });
  return parseGistRevision(body);
}

export interface UpdateGistOptions {
  readonly token: string;
  readonly gistId: string;
  readonly files: GistFilePayload;
  readonly description: string;
}

export async function updateGist(
  options: UpdateGistOptions
): Promise<GistRevision> {
  const body = await callGistApi(
    `${API_ROOT}/gists/${encodeURIComponent(options.gistId)}`,
    options.token,
    {
      method: "PATCH",
      body: JSON.stringify({
        description: options.description,
        files: options.files,
      }),
    }
  );
  return parseGistRevision(body);
}

/**
 * Gist を消す。
 *
 * 使うのは**作ったばかりの Gist の後始末**だけ (作品に紐付ける競争に負けたとき)。
 * 利用者の Gist を消す操作なので、それ以外の用途で呼ばない。
 */
export async function deleteGist(token: string, gistId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}/gists/${encodeURIComponent(gistId)}`, {
      method: "DELETE",
      headers: headers(userAuth(token)),
    });
  } catch {
    throw new GistError("network", "GitHub に接続できませんでした");
  }
  // 消えていれば目的は果たされている。
  if (!response.ok && response.status !== 404)
    throw await toGistError(response);
}

/**
 * 所有者として Gist を読む (編集の再開・保存前の差分作り)。
 *
 * トークンを付けて読む。secret gist は URL を知っていれば匿名でも読めるが、匿名の
 * レート制限は IP ごと 60 回/時で、Workers の出口 IP は多数の利用者で共有される。
 * 認証付きなら利用者ごと 5000 回/時になるので、**読みも本人のトークンで**行う。
 *
 * 閲覧者への配信はこの口を使わない (トークンを持つ人がいない) → `fetchGistForDelivery`。
 */
export async function fetchGist(
  token: string,
  gistId: string
): Promise<GistContent> {
  const body = await callGistApi(
    `${API_ROOT}/gists/${encodeURIComponent(gistId)}`,
    token,
    { method: "GET" }
  );
  return parseGistContent(body);
}

/** 条件付き GET の結果。変わっていなければ中身は来ない。 */
export type ConditionalGist =
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "changed";
      readonly content: GistContent;
      /** 次の問い合わせに付ける値。無ければ次は無条件の GET になる。 */
      readonly etag: string | null;
    };

/**
 * 配信のために Gist を読み直す (ADR 0011)。
 *
 * 閲覧者はログインしていないので、**利用者のトークンは使えない**。OAuth App の
 * client credentials で叩き、5,000 回/時/app の枠に載せる。
 *
 * `etag` を渡すと条件付き GET になる。**変わっていなければ 304 で、認証付きなら
 * レート制限を消費しない**。これが効くおかげで、GitHub の消費が閲覧数ではなく
 * 「実際に中身が変わった回数」に比例する形になる。
 */
export async function fetchGistForDelivery(
  auth: GistAuth,
  gistId: string,
  etag: string | null
): Promise<ConditionalGist> {
  const requestHeaders = new Headers(headers(auth));
  if (etag !== null) requestHeaders.set("If-None-Match", etag);

  let response: Response;
  try {
    response = await fetch(`${API_ROOT}/gists/${encodeURIComponent(gistId)}`, {
      method: "GET",
      headers: requestHeaders,
    });
  } catch {
    throw new GistError("network", "GitHub に接続できませんでした");
  }

  if (response.status === 304) return { kind: "unchanged" };
  if (!response.ok) throw await toGistError(response);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new GistError("api", "GitHub の応答を解釈できませんでした");
  }

  return {
    kind: "changed",
    content: parseGistContent(body),
    etag: response.headers.get("etag"),
  };
}
