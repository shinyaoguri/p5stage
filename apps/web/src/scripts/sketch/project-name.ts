/**
 * 作品の既定の名前 (#41 の 3)。
 *
 * 移植元は canvastage の `project-name.ts`。**保存する前から名前を持たせる**ための
 * もので、そうしないと画面上のリネーム欄が「保存するまで空」になり、常時編集できる
 * 意味が無くなる。
 *
 * 「無題のスケッチ」のような固定の既定にしないのは、作品が増えたときに見分けが
 * つかなくなるため。読める語の組み合わせにしておくと、自分で名前を付けなかった
 * 作品でも一覧で区別できる。
 */

/** 形容詞 (最大 6 文字)。 */
const ADJECTIVES = [
  "neon",
  "calm",
  "wild",
  "soft",
  "bold",
  "dim",
  "raw",
  "warm",
  "cool",
  "deep",
  "pale",
  "dark",
  "thin",
  "vast",
  "tiny",
  "hazy",
  "opal",
  "mint",
  "ruby",
  "aqua",
  "gilt",
  "ashy",
  "icy",
  "airy",
  "silky",
  "dusty",
  "vivid",
  "lucid",
  "rapid",
  "quiet",
  "misty",
  "coral",
  "amber",
  "foggy",
  "rosy",
  "mossy",
  "milky",
  "rusty",
  "crisp",
  "stark",
  "lunar",
  "solar",
  "polar",
  "tidal",
  "sonic",
  "pixel",
  "cyber",
  "retro",
  "micro",
  "ultra",
] as const;

/** 名詞 (最大 5 文字)。 */
const NOUNS = [
  "wave",
  "glow",
  "echo",
  "flux",
  "node",
  "loop",
  "mesh",
  "beam",
  "orb",
  "arc",
  "haze",
  "mist",
  "void",
  "dust",
  "foam",
  "seed",
  "leaf",
  "vine",
  "moss",
  "twig",
  "reef",
  "dune",
  "cave",
  "lake",
  "rain",
  "star",
  "moon",
  "dawn",
  "dusk",
  "noon",
  "fire",
  "ash",
  "ice",
  "wind",
  "bolt",
  "rune",
  "glyph",
  "prism",
  "shard",
  "bloom",
  "pulse",
  "drift",
  "spark",
  "flare",
  "trail",
  "pixel",
  "voxel",
  "grid",
  "cell",
  "field",
] as const;

const ID_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";

/** 末尾に付ける 36 進 3 桁 (46656 通り)。 */
function randomId(random: () => number): string {
  let id = "";
  for (let i = 0; i < 3; i += 1) {
    id += ID_CHARS[Math.floor(random() * ID_CHARS.length)];
  }
  return id;
}

/** 一覧に出したときの見分けが付く長さの上限 (`adj-noun-xxx` = 最大 16 文字)。 */
export const GENERATED_NAME_MAX_LENGTH = 16;

/**
 * `adj-noun-xxx` の形で名前を作る。
 *
 * 乱数を引数で受けるのは、桁や文字種を**実際に生成した文字列で**確かめられる
 * ようにするため (テストで固定した値を流し込める)。
 */
export function generateProjectName(
  random: () => number = Math.random
): string {
  const adjective = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(random() * NOUNS.length)];
  return `${adjective}-${noun}-${randomId(random)}`;
}
