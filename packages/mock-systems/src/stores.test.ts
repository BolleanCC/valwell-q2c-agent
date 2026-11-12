import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openBillingStore, openMsaStore, openOpsStore, openQuotingStore } from "./stores.js";

const FIXTURE = join(import.meta.dirname, "../../../data/fixtures/seed-42");
const dirs: string[] = [];

/** A temp dir holding only the named store file, proving each opener reads nothing else. */
async function isolated(fileName: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "valwell-store-"));
  dirs.push(dir);
  await copyFile(join(FIXTURE, fileName), join(dir, fileName));
  return dir;
}

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe("JSON-backed stores", () => {
  let jobId = "";
  let customerId = "";

  beforeAll(async () => {
    const ops = await openOpsStore(await isolated("ops.json"));
    const first = ops.jobs()[0];
    jobId = first?.id ?? "";
    customerId = first?.customerId ?? "";
  });

  it("ops store returns jobs and their work orders", async () => {
    const ops = await openOpsStore(await isolated("ops.json"));
    expect(ops.jobs()).toHaveLength(40);
    expect(ops.job(jobId)?.id).toBe(jobId);
    expect(ops.workOrderForJob(jobId)?.jobId).toBe(jobId);
    expect(ops.job("JOB-9999")).toBeUndefined();
  });

  it("quoting store returns a customer's price book, quotes and change orders", async () => {
    const quoting = await openQuotingStore(await isolated("quoting.json"));
    const book = quoting.priceBook(customerId);
    expect(book.length).toBeGreaterThan(0);
    expect(book.every((p) => p.customerId === customerId)).toBe(true);
    expect(quoting.quotesForJob(jobId).map((q) => q.stage)).toEqual(["TDI", "REPAIR"]);
    expect(Array.isArray(quoting.changeOrdersForJob(jobId))).toBe(true);
  });

  it("billing store returns invoices by id and job", async () => {
    const billing = await openBillingStore(await isolated("billing.json"));
    const inv = billing.invoiceForJob(jobId);
    expect(inv?.jobId).toBe(jobId);
    expect(billing.invoice(inv?.id ?? "")).toEqual(inv);
    expect(billing.invoices()).toHaveLength(40);
  });

  it("MSA store returns rules per customer", async () => {
    const msa = await openMsaStore(await isolated("msa.json"));
    expect(msa.rulesFor(customerId)?.customerId).toBe(customerId);
    expect(msa.customers().length).toBe(4);
  });

  it("rejects a store file that fails schema validation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "valwell-store-"));
    dirs.push(dir);
    await writeFile(join(dir, "ops.json"), JSON.stringify({ jobs: [{ id: "" }], workOrders: [] }));
    await expect(openOpsStore(dir)).rejects.toThrow(/Invalid store file/);
  });
});
