import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateBatch, serializeBatch } from "./batch.js";

/** Parameters the committed fixture was generated with. */
const FIXTURE = { dir: "data/fixtures/seed-42", seed: 42, jobs: 40, customers: 4 };
const repoRoot = join(import.meta.dirname, "../../..");

describe("committed fixture", () => {
  it(`matches a fresh generation byte for byte (regenerate: pnpm generate -- --seed ${FIXTURE.seed} --jobs ${FIXTURE.jobs} --out ${FIXTURE.dir})`, async () => {
    const expected = serializeBatch(
      generateBatch({ seed: FIXTURE.seed, jobs: FIXTURE.jobs, customers: FIXTURE.customers }),
    );
    for (const [name, text] of Object.entries(expected)) {
      const actual = await readFile(join(repoRoot, FIXTURE.dir, name), "utf8");
      expect(actual, name).toBe(text);
    }
  });
});
