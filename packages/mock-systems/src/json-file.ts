import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";

/** Read and validate one store file. Each mock system calls this only for its own file. */
export async function readStoreFile<S extends z.ZodType>(
  dir: string,
  fileName: string,
  schema: S,
): Promise<z.infer<S>> {
  const path = join(dir, fileName);
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid store file ${path}: ${result.error.message}`);
  }
  return result.data;
}
