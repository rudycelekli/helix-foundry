import { afterEach, expect, it, vi } from "vitest";
import { MemoryStore, resource, transaction } from "../apps/api/src/store.js";
import { runPipelineJob } from "../apps/api/src/pipeline-jobs.js";
import { queryDatasets } from "../apps/api/src/datasets.js";

vi.mock("../apps/api/src/datasets.js", () => ({ queryDatasets: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function fixture(scope: string) {
  const store = new MemoryStore();
  const job = resource(scope, "job", "Build", { pipelineId: "pipeline", status: "running" }, "job");
  await transaction(store, scope, async (tx) => {
    tx.put(resource(scope, "pipeline", "Output", { inputs: [], sql: "SELECT 1", outputDatasetId: "output" }, "pipeline"));
    tx.put(job);
  });
  let finish!: (value: Awaited<ReturnType<typeof queryDatasets>>) => void;
  let fail!: (error: Error) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  let signal!: AbortSignal;
  vi.mocked(queryDatasets).mockImplementationOnce(async (_store, _scope, _inputs, _sql, options) => {
    signal = options!.signal!;
    started();
    return new Promise((resolve, reject) => {
      finish = resolve; fail = reject;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  return { store, job, ready, finish: () => finish({ version: "result", citations: [], state: "dataset_snapshot", rows: [], profile: { rows: 0, columns: [], sample: [], fingerprint: "fixture" } }),
    fail: () => fail(new Error("test cleanup")), signal: () => signal };
}

it("keeps a healthy build after a transient cancellation status read fails", async () => {
  vi.useFakeTimers();
  const f = await fixture("cancel-read-failure"), get = f.store.get.bind(f.store);
  let reads = 0;
  vi.spyOn(f.store, "get").mockImplementation(async (scope, id) => {
    if (id === "job" && ++reads === 2) throw new Error("temporary status read failure");
    return get(scope, id);
  });
  const settled = runPipelineJob(f.store, "cancel-read-failure", f.job).then(() => undefined, (error) => error);
  await f.ready;
  try {
    await vi.advanceTimersByTimeAsync(2500);
    expect(f.signal().aborted).toBe(false);
    f.finish();
    expect(await settled).toBeUndefined();
    expect((await get("cancel-read-failure", "job"))?.data.status).toBe("succeeded");
  } finally { f.fail(); await settled; }
});

it("serializes slow status reads and stops rescheduling after the build settles", async () => {
  vi.useFakeTimers();
  const f = await fixture("cancel-read-overlap"), get = f.store.get.bind(f.store);
  let reads = 0, active = 0, maximum = 0, polling = true;
  const releases: (() => void)[] = [];
  vi.spyOn(f.store, "get").mockImplementation(async (scope, id) => {
    if (id === "job" && ++reads > 1 && polling) {
      maximum = Math.max(maximum, ++active);
      await new Promise<void>((resolve) => { releases.push(resolve); });
      active--;
    }
    return get(scope, id);
  });
  const settled = runPipelineJob(f.store, "cancel-read-overlap", f.job).then(() => undefined, (error) => error);
  await f.ready;
  try {
    await vi.advanceTimersByTimeAsync(5000);
    expect(maximum).toBe(1);
    polling = false;
    f.finish();
    expect(await settled).toBeUndefined();
    releases.splice(0).forEach((release) => release());
    await vi.advanceTimersByTimeAsync(5000);
    const stoppedAt = reads;
    await vi.advanceTimersByTimeAsync(5000);
    expect(reads).toBe(stoppedAt);
    expect(vi.getTimerCount()).toBe(0);
  } finally { polling = false; releases.splice(0).forEach((release) => release()); f.fail(); await settled; }
});
