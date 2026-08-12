/**
 * 起動時に何から始めるか (Phase 2-3)。
 *
 * エディタが見るものは 3 つある — URL の作品 ID、手元の下書き、Gist に保存された
 * 中身。**別の作品の下書きを持ち込まない**ことがここの肝で、間違えると開いた作品が
 * 黙って別物に置き換わり、そのまま保存すると上書きしてしまう。
 */

import { DEFAULT_SKETCH_FILES } from "@p5stage/shared";
import { describe, expect, it } from "vitest";

import type { SketchDraft } from "../src/scripts/draft/draft";
import {
  chooseStartingPoint,
  sketchIdFromUrl,
} from "../src/scripts/sketch/open-sketch";

const DRAFT_FILES = {
  "index.html": "<!doctype html>",
  "sketch.js": "// 下書き",
};
const REMOTE_FILES = {
  "index.html": "<!doctype html>",
  "sketch.js": "// 保存済み",
};

function draft(sketchId: string | null): SketchDraft {
  return {
    files: DRAFT_FILES,
    activeFile: "index.html",
    savedAt: 1,
    sketchId,
  };
}

describe("sketchIdFromUrl", () => {
  it("?sketch= から読む", () => {
    expect(sketchIdFromUrl("?sketch=SKETCH0000000000")).toBe(
      "SKETCH0000000000"
    );
    expect(sketchIdFromUrl("")).toBeNull();
    expect(sketchIdFromUrl("?sketch=")).toBeNull();
  });
});

describe("chooseStartingPoint", () => {
  it("同じ作品の下書きがあれば、それを続ける", () => {
    // 下書きは保存より新しいことがある。
    const start = chooseStartingPoint({
      sketchId: "SKETCH0000000000",
      draft: draft("SKETCH0000000000"),
      remoteFiles: REMOTE_FILES,
    });

    expect(start.source).toBe("draft");
    expect(start.files).toEqual(DRAFT_FILES);
    expect(start.activeFile).toBe("index.html");
  });

  it("別の作品の下書きは持ち込まない", () => {
    const start = chooseStartingPoint({
      sketchId: "SKETCH0000000000",
      draft: draft("OTHERSKETCH00000"),
      remoteFiles: REMOTE_FILES,
    });

    expect(start.source).toBe("sketch");
    expect(start.files).toEqual(REMOTE_FILES);
  });

  it("保存済みの作品を開いたら sketch.js から見せる", () => {
    const start = chooseStartingPoint({
      sketchId: "SKETCH0000000000",
      draft: null,
      remoteFiles: REMOTE_FILES,
    });

    expect(start.activeFile).toBe("sketch.js");
  });

  it("新規は、保存前の下書きだけを引き継ぐ", () => {
    // 保存済みの作品の下書きを新規に持ち込むと、それを新しい作品として
    // 二重に保存できてしまう。
    expect(
      chooseStartingPoint({
        sketchId: null,
        draft: draft(null),
        remoteFiles: null,
      }).source
    ).toBe("draft");

    const fromOther = chooseStartingPoint({
      sketchId: null,
      draft: draft("SKETCH0000000000"),
      remoteFiles: null,
    });
    expect(fromOther.source).toBe("default");
    expect(fromOther.files).toEqual(DEFAULT_SKETCH_FILES);
  });

  it("読めなかったときは既定のテンプレートで開く", () => {
    // 開けないと、手元の下書きにしか無い変更にも触れなくなる。
    const start = chooseStartingPoint({
      sketchId: "SKETCH0000000000",
      draft: null,
      remoteFiles: null,
    });

    expect(start.source).toBe("default");
    expect(start.files).toEqual(DEFAULT_SKETCH_FILES);
  });
});
