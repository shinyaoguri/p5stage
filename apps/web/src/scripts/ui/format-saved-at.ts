/**
 * 保存できた時刻の書式。
 *
 * 「いつの続きか」が分かればよいので月日と分まで。年を出すと、クロームの狭い
 * 場所 (ホバーの文面・実行ボタンと同じ行) で折り返す。
 *
 * 下書き・保存・復元の知らせが同じ材料を出すので、書式は 1 か所で決める
 * (#41 の 6 でそれぞれの置き場が散った後も、読む人には同じ「時刻」であるため)。
 */
export function formatSavedAt(savedAt: number): string {
  return new Date(savedAt).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
