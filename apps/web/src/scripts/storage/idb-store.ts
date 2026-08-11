/**
 * ブラウザ内の永続化 (IndexedDB) の薄いラッパ。
 *
 * 移植元は canvastage の idb-store.ts。あちらは「1 ストア = 1 DB」で version を
 * 固定していたが、p5stage はここに設定 (1-5) とドラフト (1-6) の両方を載せる。
 * DB を 1 つにして、**ストアの一覧をこのファイルが正本として持つ**形に変えた。
 * ストアを足すときは `STORE_NAMES` に足して `DB_VERSION` を上げる
 * (upgrade は不足しているストアだけを作るので、既存のデータは残る)。
 *
 * ここに置くのは失われても作り直せるものだけ。IndexedDB は容量圧迫や
 * プライベートブラウジングで読めなくなることがあり、呼び出し側は
 * 「保存できなかった」を通常の分岐として扱う。
 */

import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "p5stage";
const DB_VERSION = 1;

/** 使うオブジェクトストア。追加時は DB_VERSION も上げる。 */
const STORE_NAMES = ["settings"] as const;

export type StoreName = (typeof STORE_NAMES)[number];

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDatabase(): Promise<IDBPDatabase> {
  if (dbPromise === null) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const name of STORE_NAMES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      },
    });
    // 失敗した Promise を握り続けると、以降の読み書きが同じ失敗を再利用して
    // 永久に回復しない。捨てて次回やり直せるようにする (canvastage の知見)。
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

export interface Store<V> {
  get(key: string): Promise<V | undefined>;
  put(key: string, value: V): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createStore<V>(storeName: StoreName): Store<V> {
  return {
    async get(key) {
      const db = await getDatabase();
      return (await db.get(storeName, key)) as V | undefined;
    },
    async put(key, value) {
      const db = await getDatabase();
      await db.put(storeName, value, key);
    },
    async delete(key) {
      const db = await getDatabase();
      await db.delete(storeName, key);
    },
  };
}
