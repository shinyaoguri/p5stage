/**
 * GitHub OAuth (Web application flow) の口。
 *
 * GitHub App ではなく **OAuth App** を使う。GitHub App は Gist API に対応しておらず、
 * 正本を Gist に置く設計 (ADR 0002) と噛み合わないため。
 *
 * scope は `gist` だけに絞る。これでもユーザーの**全 Gist への書き込み権限**になるので、
 * 認可へ送り出す画面でその旨を明示する義務がある (要件 3.6)。
 */

/** 要求する権限。増やすときは要件 3.6 の明示 UI も一緒に直す。 */
export const OAUTH_SCOPE = "gist";

/** OAuth の往復が失敗したことを表す。理由は利用者に見せる文言にする。 */
export class GitHubOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubOAuthError";
  }
}

export interface AuthorizeUrlOptions {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  /** GitHub の web 側 (`origins.ts`)。 */
  readonly webOrigin: string;
}

/** 認可画面の URL を組み立てる。 */
export function buildAuthorizeUrl(options: AuthorizeUrlOptions): string {
  const url = new URL("/login/oauth/authorize", options.webOrigin);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("scope", OAUTH_SCOPE);
  url.searchParams.set("state", options.state);
  return url.href;
}

export interface ExchangeCodeOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly redirectUri: string;
  /** GitHub の web 側 (`origins.ts`)。トークン交換は API 側ではない。 */
  readonly webOrigin: string;
}

/**
 * 認可コードをアクセストークンに交換する。
 *
 * GitHub は失敗も HTTP 200 で返し、本文の `error` に理由を入れてくる。
 * ステータスだけ見ていると「トークンが undefined のまま先へ進む」ので、本文で判定する。
 */
export async function exchangeCodeForToken(
  options: ExchangeCodeOptions
): Promise<string> {
  const url = new URL("/login/oauth/access_token", options.webOrigin);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: options.code,
      redirect_uri: options.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new GitHubOAuthError(
      `GitHub がトークンを返しませんでした (${response.status})`
    );
  }

  const body = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (typeof body.access_token !== "string" || body.access_token === "") {
    throw new GitHubOAuthError(
      body.error_description ?? body.error ?? "トークンを取得できませんでした"
    );
  }

  return body.access_token;
}

/** ログインしたユーザー。`login` は改名で変わるので、同一性は `id` で見る。 */
export interface GitHubViewer {
  readonly id: number;
  readonly login: string;
  readonly avatarUrl: string | null;
}

/**
 * トークンの持ち主を引く。
 *
 * User-Agent は GitHub API の要件 (無いと 403)。
 */
export async function fetchViewer(
  apiOrigin: string,
  token: string
): Promise<GitHubViewer> {
  const response = await fetch(new URL("/user", apiOrigin), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "p5stage",
    },
  });

  if (!response.ok) {
    throw new GitHubOAuthError(
      `GitHub のユーザー情報を取得できませんでした (${response.status})`
    );
  }

  const body = (await response.json()) as {
    id?: number;
    login?: string;
    avatar_url?: string;
  };

  if (typeof body.id !== "number" || typeof body.login !== "string") {
    throw new GitHubOAuthError("GitHub の応答を解釈できませんでした");
  }

  return {
    id: body.id,
    login: body.login,
    avatarUrl: body.avatar_url ?? null,
  };
}
