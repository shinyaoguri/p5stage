/**
 * スケッチ文書へ差し込むブリッジスクリプト。
 *
 * ここで作る文字列は**スケッチ文書の中で**動く。ランナーとスケッチはどちらも
 * preview オリジンなので (ADR 0007)、両者の postMessage は同一オリジン間の通信になる。
 * 本体まで届けるのはランナーの仕事で、ブリッジは親 (= ランナー) までしか知らない。
 */

/**
 * `<script>` の中へ埋め込むときに潰す文字。
 * `<` は `</script>` で文書が閉じてしまうのを防ぐため。U+2028 / U+2029 は
 * JS の行終端として解釈されるため。
 */
const SCRIPT_ESCAPES: readonly (readonly [string, string])[] = [
  ["<", "\\u003c"],
  [String.fromCharCode(0x2028), "\\u2028"],
  [String.fromCharCode(0x2029), "\\u2029"],
];

/** 値を `<script>` の中へ安全に埋め込める JSON 文字列にする。 */
export function serializeForScript(value: unknown): string {
  let json = JSON.stringify(value);
  for (const [from, to] of SCRIPT_ESCAPES) {
    json = json.split(from).join(to);
  }
  return json;
}

/**
 * console 出力と未捕捉エラーを親 (ランナー) へ転送する。
 * 元の console も呼ぶので、devtools では通常どおり見える。
 */
export function consoleBridgeScript(runnerOrigin: string): string {
  return `<script>
(function () {
  var TARGET = ${serializeForScript(runnerOrigin)};
  var LEVELS = ["log", "info", "warn", "error", "debug"];

  function stringify(value) {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (value instanceof Error) return value.stack || String(value);
    if (typeof value === "object") {
      try {
        return JSON.stringify(value, null, 2);
      } catch (e) {
        return String(value);
      }
    }
    return String(value);
  }

  function send(level, args) {
    try {
      window.parent.postMessage(
        {
          source: "p5stage-sketch",
          level: level,
          message: Array.prototype.map.call(args, stringify).join(" "),
          timestamp: Date.now(),
        },
        TARGET
      );
    } catch (e) {
      /* 転送に失敗してもスケッチの実行は続ける */
    }
  }

  LEVELS.forEach(function (level) {
    var original = console[level] ? console[level].bind(console) : null;
    console[level] = function () {
      if (original) original.apply(null, arguments);
      send(level, arguments);
    };
  });

  window.addEventListener("error", function (event) {
    var where = event.lineno ? " (line " + event.lineno + ")" : "";
    send("error", [String(event.message) + where]);
  });

  window.addEventListener("unhandledrejection", function (event) {
    send("error", ["Unhandled promise rejection: " + stringify(event.reason)]);
  });
})();
</script>`;
}

/**
 * `fetch` / `XMLHttpRequest` を差し替え、スケッチ内のファイルへの参照を
 * 実行時 URL (blob) へ振り替える。p5 の loadJSON / loadStrings / loadShader 用。
 *
 * @param runtimeUrls 絶対 URL → 実行時 URL (buildRuntimeUrlMap の出力)
 */
export function fileLoaderBridgeScript(
  runtimeUrls: Record<string, string>
): string {
  return `<script>
(function () {
  var URLS = ${serializeForScript(runtimeUrls)};

  function resolve(input) {
    if (typeof input !== "string") return null;
    try {
      return URLS[new URL(input, document.baseURI).href] || null;
    } catch (e) {
      return null;
    }
  }

  var nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      var target = typeof input === "string" ? input : input && input.url;
      var mapped = resolve(target);
      return mapped
        ? nativeFetch.call(window, mapped, init)
        : nativeFetch.apply(window, arguments);
    };
  }

  var nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    var mapped = resolve(url);
    if (mapped) args[1] = mapped;
    return nativeOpen.apply(this, args);
  };
})();
</script>`;
}
