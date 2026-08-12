/**
 * セッションとトークンの守り方 (ADR 0009)。
 *
 * ここが守るのは 2 つ。
 *
 * - **cookie の値は DB に置かない**。置くのはその SHA-256 で、突き合わせは毎回ハッシュして引く。
 *   DB のダンプが漏れてもセッションを乗っ取れない
 * - **GitHub のアクセストークンは平文で置かない**。AES-GCM の封筒に入れる。鍵は
 *   `GITHUB_CLIENT_SECRET` から HKDF で導出するので、専用の secret を増やさずに済む
 *
 * Web Crypto しか使わない (Workers / Node 22 のどちらでも同じ実装が動く)。
 */

/** セッション ID の長さ (バイト)。128 bit の推測不可能性があれば足りる。 */
const SESSION_ID_BYTES = 32;

/** AES-GCM の nonce 長 (バイト)。GCM の推奨値。 */
const IV_BYTES = 12;

/**
 * HKDF の `info`。鍵の用途を分離するためのラベルで、
 * 同じ Client Secret から別用途の鍵を導出しても互いに影響しないようにする。
 */
const KEY_INFO = "p5stage:github-token:v1";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** 推測不可能なセッション ID を作る (cookie に載せる生の値)。 */
export function generateSessionId(): string {
  const bytes = new Uint8Array(SESSION_ID_BYTES);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/**
 * cookie の値から DB のキーを作る。
 *
 * ソルトは付けない。入力が 256 bit の乱数で、辞書攻撃の対象になる低エントロピーな
 * 秘密ではないため (パスワードとは前提が違う)。
 */
export async function hashSessionId(rawId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(rawId));
  return toHex(new Uint8Array(digest));
}

/**
 * トークンの封筒に使う鍵を導出する。
 *
 * Client Secret をロテートすると既存の封筒は開かなくなる。そのときは再ログインで
 * 復旧する (ADR 0009)。
 */
export async function deriveTokenKey(clientSecret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(clientSecret),
    "HKDF",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      // salt は空でよい。入力が既に一様ランダムな高エントロピーの秘密のため。
      salt: new Uint8Array(0),
      info: encoder.encode(KEY_INFO),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * 封筒に入れたトークン。DB にはこの 2 つをそのまま格納する。
 *
 * 型引数を `ArrayBuffer` に固定するのは、Web Crypto が受け取る `BufferSource` が
 * `SharedArrayBuffer` 由来のビューを許さないため (既定の `ArrayBufferLike` のままだと
 * 渡せない)。
 */
export interface SealedToken {
  readonly ciphertext: Uint8Array<ArrayBuffer>;
  readonly iv: Uint8Array<ArrayBuffer>;
}

/** トークンを封筒に入れる。nonce は毎回引き直す (使い回すと GCM が壊れる)。 */
export async function sealToken(
  key: CryptoKey,
  token: string
): Promise<SealedToken> {
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(token)
  );

  return { ciphertext: new Uint8Array(ciphertext), iv };
}

/** 開けられない封筒 (鍵が変わった / 中身が壊れている)。 */
export class SealedTokenError extends Error {
  constructor() {
    super("トークンを復号できません");
    this.name = "SealedTokenError";
  }
}

/**
 * 封筒からトークンを取り出す。
 *
 * 開けられない場合に投げるのは、鍵のロテートと改竄を呼び出し側で区別しないため。
 * どちらも「このセッションは使えない」で同じ扱いになる。
 */
export async function openToken(
  key: CryptoKey,
  sealed: SealedToken
): Promise<string> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.iv },
      key,
      sealed.ciphertext
    );
    return decoder.decode(plaintext);
  } catch {
    throw new SealedTokenError();
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}
