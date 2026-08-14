/**
 * 回収の匙加減 (Phase 3-5b)。
 *
 * D1 も R2 も触らない純ロジックだけを置く。回収の本体 (`gc.ts`) は Cron からしか
 * 走らず、境界を試すには**孤児を作って何日も待つ**しかないので、判断のところだけを
 * ここに出して単体テストで固定する。
 */

/**
 * 猶予の既定 (7 日)。
 *
 * 手放した実体をもう一度持ち込む道は開いていて (同じ中身なら転送も要らない — 3-1)、
 * 「消したつもりが違った」に気付くのは作品を開き直したときになる。週をまたいで
 * 気付ける長さにしておく。設定は `ASSET_GC_GRACE_HOURS` (wrangler.jsonc) が持ち、
 * ここはそれが読めなかったときの保険。
 */
export const DEFAULT_GC_GRACE_HOURS = 24 * 7;

const HOUR_MS = 60 * 60 * 1000;

/**
 * 1 回の起動で印を立てる上限。
 *
 * `blobs` の全走査になるので、多いほど 1 回が重い。回収そのものは猶予の分だけ遅れて
 * よく、取りこぼしは次の起動が拾う。
 */
export const MARK_LIMIT = 500;

/**
 * 1 回の起動で回収する上限。
 *
 * 1 件ごとに R2 の削除と D1 の削除で 2 往復するので、印を立てる側より小さくする。
 */
export const SWEEP_LIMIT = 200;

/**
 * 1 回の起動でバックフィルが読むリビジョンの数。
 *
 * 1 件ごとに R2 の読み出しが要る (中身のマニフェストを見る)。R2 の `list` は 1 回に
 * 1000 件まで返せるが、**読む方が重い**のでそちらに合わせる。
 */
export const BACKFILL_LIMIT = 200;

/**
 * 設定値 (時間) をミリ秒に直す。読めなければ既定。
 *
 * 0 を許すのは E2E のため — 猶予を待たずに回収させないと、回収されることを実ブラウザ
 * から確かめられない。負や数でない値は設定の書き損じなので、**短い方へ倒さず**既定に
 * 戻す (書き損じで回収が早まる方が、遅れるより取り返しがつかない)。
 */
export function graceMillis(hours: string | undefined): number {
  // 空文字を弾くのは `Number("")` が 0 になるため。**設定を消したつもりが「猶予無し」
  // になる**のが、この関数でいちばん起きやすい書き損じ。
  if (hours === undefined || hours.trim() === "") {
    return DEFAULT_GC_GRACE_HOURS * HOUR_MS;
  }

  const value = Number(hours);
  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_GC_GRACE_HOURS * HOUR_MS;
  }

  return value * HOUR_MS;
}

/**
 * この時刻より前に印が付いたものが回収の対象。
 *
 * 猶予 0 なら「今この瞬間に印が付いたもの」まで含む (同じ起動で印を立てて回収する)。
 */
export function orphanCutoff(now: number, graceMs: number): number {
  return now - graceMs;
}
