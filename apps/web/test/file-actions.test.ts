import {
  ASSET_MANIFEST_FILE,
  ENTRY_FILE,
  MAX_FILE_COUNT,
} from "@p5stage/shared";
import { describe, expect, it } from "vitest";

import {
  checkAddFile,
  checkRemoveFile,
  checkRenameFile,
  isManagedFile,
  isProtectedFile,
  nextActiveFile,
  suggestFileName,
} from "../src/scripts/editor/file-actions";

/** 既定 3 ファイルの並び (タブの並び順と同じ)。 */
const DEFAULT = [ENTRY_FILE, "style.css", "sketch.js"];

describe("isProtectedFile", () => {
  it("実行の起点だけを保護する", () => {
    expect(isProtectedFile(ENTRY_FILE)).toBe(true);
    expect(isProtectedFile("sketch.js")).toBe(false);
    expect(isProtectedFile("style.css")).toBe(false);
  });
});

describe("isManagedFile", () => {
  it("アセットの一覧だけを p5stage の持ち物として扱う", () => {
    expect(isManagedFile(ASSET_MANIFEST_FILE)).toBe(true);
    expect(isManagedFile("data.json")).toBe(false);
  });
});

describe("checkAddFile", () => {
  it("新しい名前を受け付ける", () => {
    expect(checkAddFile("shader.glsl", DEFAULT)).toBeNull();
  });

  it("既にある名前を拒む", () => {
    expect(checkAddFile("sketch.js", DEFAULT)).toContain("既にあります");
  });

  it("ファイル名として不正な理由をそのまま返す", () => {
    expect(checkAddFile("lib/util.js", DEFAULT)).toContain("フォルダ");
    expect(checkAddFile("", DEFAULT)).toContain("入力");
  });

  it("アセットの一覧の名前は手で作れない (予約名)", () => {
    expect(checkAddFile(ASSET_MANIFEST_FILE, DEFAULT)).toContain(
      ASSET_MANIFEST_FILE
    );
  });

  it("ファイル数の上限で止める", () => {
    const full = Array.from({ length: MAX_FILE_COUNT }, (_, i) => `f${i}.txt`);
    expect(checkAddFile("one-more.txt", full)).toContain("上限");
  });
});

describe("checkRenameFile", () => {
  it("別の名前へ変えられる", () => {
    expect(checkRenameFile("sketch.js", "main.js", DEFAULT)).toBeNull();
  });

  it("実行の起点は名前を変えられない", () => {
    expect(checkRenameFile(ENTRY_FILE, "main.html", DEFAULT)).toContain(
      ENTRY_FILE
    );
  });

  it("同じ名前は操作の取り消しと同じなので拒まない", () => {
    expect(checkRenameFile("sketch.js", "sketch.js", DEFAULT)).toBeNull();
  });

  it("他のファイルとぶつかる名前を拒む", () => {
    expect(checkRenameFile("sketch.js", "style.css", DEFAULT)).toContain(
      "既にあります"
    );
  });

  it("ファイル名として不正な理由をそのまま返す", () => {
    expect(checkRenameFile("sketch.js", " main.js", DEFAULT)).toContain("空白");
  });

  it("アセットの一覧は名前を変えられない (黙ってアセットが消えるため)", () => {
    const files = [...DEFAULT, ASSET_MANIFEST_FILE];
    expect(
      checkRenameFile(ASSET_MANIFEST_FILE, "assets2.json", files)
    ).toContain(ASSET_MANIFEST_FILE);
  });

  it("アセットの一覧の名前へは変えられない (予約名)", () => {
    expect(
      checkRenameFile("sketch.js", ASSET_MANIFEST_FILE, DEFAULT)
    ).toContain(ASSET_MANIFEST_FILE);
  });

  it("無いファイルは対象にできない", () => {
    expect(checkRenameFile("missing.js", "main.js", DEFAULT)).toContain(
      "ありません"
    );
  });
});

describe("checkRemoveFile", () => {
  it("追加したファイルは削除できる", () => {
    expect(checkRemoveFile("style.css", DEFAULT)).toBeNull();
  });

  it("実行の起点は削除できない", () => {
    expect(checkRemoveFile(ENTRY_FILE, DEFAULT)).toContain(ENTRY_FILE);
  });

  it("無いファイルは削除できない", () => {
    expect(checkRemoveFile("missing.js", DEFAULT)).toContain("ありません");
  });
});

describe("nextActiveFile", () => {
  it("消したタブの位置 (右隣) を開く", () => {
    expect(nextActiveFile(DEFAULT, "style.css")).toBe("sketch.js");
  });

  it("末尾を消したときは左隣に寄る", () => {
    expect(nextActiveFile(DEFAULT, "sketch.js")).toBe("style.css");
  });

  it("最後の 1 つを消すと開くファイルが無い", () => {
    expect(nextActiveFile(["sketch.js"], "sketch.js")).toBeNull();
  });

  it("無いファイルには答えない", () => {
    expect(nextActiveFile(DEFAULT, "missing.js")).toBeNull();
  });
});

describe("suggestFileName", () => {
  it("既定の構成では untitled.js を勧める", () => {
    expect(suggestFileName(DEFAULT)).toBe("untitled.js");
  });

  it("ぶつかるときは連番で空きを探す", () => {
    expect(suggestFileName([...DEFAULT, "untitled.js"])).toBe("untitled-2.js");
    expect(suggestFileName([...DEFAULT, "untitled.js", "untitled-2.js"])).toBe(
      "untitled-3.js"
    );
  });
});
