import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openBatchSources } from "./json-batch.js";
import { collectJobContexts, type Sources } from "./sources.js";

const FIXTURE = join(import.meta.dirname, "../../../../data/fixtures/seed-42");
const SOURCE_FILES = ["quoting.json", "ops.json", "billing.json", "msa.json"];
let tmp = "";

afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("openBatchSources", () => {
  it("works without fault labels or the portal store present", async () => {
    tmp = await mkdtemp(join(tmpdir(), "valwell-agent-"));
    for (const f of SOURCE_FILES) await copyFile(join(FIXTURE, f), join(tmp, f));
    const { contexts, skipped } = collectJobContexts(await openBatchSources(tmp));
    expect(contexts).toHaveLength(40);
    expect(skipped).toEqual([]);
  });
});

describe("collectJobContexts", () => {
  it("gathers every document for a job", async () => {
    const { contexts } = collectJobContexts(await openBatchSources(FIXTURE));
    const ctx = contexts[0];
    expect(ctx?.quotes.every((q) => q.jobId === ctx.job.id)).toBe(true);
    expect(ctx?.workOrder.jobId).toBe(ctx?.job.id);
    expect(ctx?.invoice.jobId).toBe(ctx?.job.id);
    expect(ctx?.rules.customerId).toBe(ctx?.job.customerId);
    expect(ctx?.priceBook.every((p) => p.customerId === ctx.job.customerId)).toBe(true);
  });

  it("reports jobs with missing documents as incomplete instead of guessing", async () => {
    const real = await openBatchSources(FIXTURE);
    const firstJob = real.ops.jobs()[0]?.id;
    const sources: Sources = {
      ...real,
      billing: {
        invoiceForJob: (id) => (id === firstJob ? undefined : real.billing.invoiceForJob(id)),
      },
    };
    const { contexts, skipped } = collectJobContexts(sources);
    expect(contexts).toHaveLength(39);
    expect(skipped).toEqual([
      {
        jobId: firstJob,
        invoiceId: null,
        status: "INCOMPLETE",
        issues: [
          {
            code: "MISSING_RECORD",
            invoiceLineId: null,
            message: `no invoice on file for ${firstJob}`,
          },
        ],
      },
    ]);
  });
});
