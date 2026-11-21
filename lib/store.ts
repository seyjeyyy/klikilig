export interface SavedStrip {
  id: string;
  image: Blob;
  title: string;
}
async function database() {
  return new Promise<IDBDatabase>((ok, fail) => {
    const req = indexedDB.open("klikilig-keepsakes", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("strips", { keyPath: "id" });
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}
export async function saveStrip(item: SavedStrip) {
  const db = await database();
  await new Promise<void>((ok, fail) => {
    const tx = db.transaction("strips", "readwrite");
    tx.objectStore("strips").put(item);
    tx.oncomplete = () => ok();
    tx.onerror = () => fail(tx.error);
  });
  db.close();
}
export async function listStrips(owner: string) {
  const db = await database();
  const data = await new Promise<SavedStrip[]>((ok, fail) => {
    const req = db.transaction("strips").objectStore("strips").getAll();
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
  db.close();
  return data.filter((x) => x.id.startsWith(owner + "/"));
}
export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
