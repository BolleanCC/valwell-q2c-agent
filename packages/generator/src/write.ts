import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type BatchFiles, serializeBatch } from "./batch.js";

/** Write every file of a batch into `dir` (created if missing). Returns the paths written. */
export async function writeBatch(dir: string, files: BatchFiles): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const [name, text] of Object.entries(serializeBatch(files))) {
    const path = join(dir, name);
    await writeFile(path, text, "utf8");
    written.push(path);
  }
  return written;
}
