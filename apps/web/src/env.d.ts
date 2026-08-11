/// <reference types="astro/client" />

// バインディングと変数の型 (グローバルの `Env`) は wrangler.jsonc から
// `wrangler types` が worker-configuration.d.ts に生成する (tsconfig の include 経由で拾う)。
// 値には `import { env } from "cloudflare:workers"` で触る。

type Runtime = import("@astrojs/cloudflare").Runtime;

declare namespace App {
  // Astro の App.Locals に宣言マージで Cloudflare の実行コンテキストを足すための空 interface。
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Locals extends Runtime {}
}
