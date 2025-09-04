import { describe, expect, test } from "vitest";
import { Window as HappyWindow } from "happy-dom";
import { JSDOM } from "jsdom";

const HTML = `<!doctype html><html><body><article><h1>Hi</h1><p>${"x ".repeat(
  5000
)}</p></article></body></html>`;

const pretty = (b: number) => (b / (1024 * 1024)).toFixed(2) + " MB";
const mem = () => process.memoryUsage();

async function forceGC() {
  try {
    // @ts-ignore
    if (typeof Bun !== "undefined" && typeof Bun.gc === "function") Bun.gc(true);
    // @ts-ignore
    if (typeof globalThis.gc === "function") globalThis.gc();
  } catch {}
  await new Promise((r) => setTimeout(r, 10));
}

async function runHappyDom(iterations: number) {
  for (let i = 0; i < iterations; i++) {
    const win = new HappyWindow();
    const doc = win.document;
    doc.write(HTML);
    doc.close();
  }
}

async function runJSDOM(iterations: number) {
  for (let i = 0; i < iterations; i++) {
    const dom = new JSDOM(HTML);
    const { document: doc } = dom.window;
    dom.window.close();
  }
}

async function runOneCycle(iterations: number, label: string, run: (iterations: number) => Promise<void>) {
  await forceGC();

  await run(iterations);

  await forceGC();
  const memorySnapshot = mem();

  console.log(`${label}: heap=${pretty(memorySnapshot.heapUsed)}, rss=${pretty(memorySnapshot.rss)}`);
  return { heapUsed: memorySnapshot.heapUsed, rss: memorySnapshot.rss };
}

async function runAllCycles(cycles: number, iterationsPerCycle: number, label: string, run: (iterations: number) => Promise<void>) {
  const results: Array<{ heapUsed: number; rss: number }> = [];
  for (let i = 1; i <= cycles; i++) {
    results.push(await runOneCycle(iterationsPerCycle, `${label} cycle ${i}`, run));
  }
  return results;
}
type ThresholdsMB = {
  heap: number;
  rss: number;
}
describe("DOM libraries memory behavior", () => {
  const cases = [
    { label: 'jsdom', runner: runJSDOM },
    { label: 'happydom', runner: runHappyDom },
  ]

  const thresholdsMB: ThresholdsMB = {
    heap: 10,
    rss: 15
  }
  test.each(cases)(
    '$label memory change over time is below threshold',
    async ({ label, runner }) => {
      const results = await runAllCycles(40, 100, label, runner)

      // Calculate deltas between adjacent cycles
      const heapDeltas: number[] = [];
      const rssDeltas: number[] = [];
      for (let i = 1; i < results.length; i++) {
        const prev = results[i - 1];
        const curr = results[i];
        if (prev && curr) {
          heapDeltas.push(curr.heapUsed - prev.heapUsed);
          rssDeltas.push(curr.rss - prev.rss);
        } else {
          console.warn(`Missing result for cycle ${i}`);
        }
      }

      // Average delta per cycle
      const heapSum = heapDeltas.reduce((a, b) => a + b, 0);
      const rssSum = rssDeltas.reduce((a, b) => a + b, 0);
      const heapAvg = heapDeltas.length ? heapSum / heapDeltas.length : 0;
      const rssAvg = rssDeltas.length ? rssSum / rssDeltas.length : 0;

      console.log(`Average heap delta per cycle: ${pretty(heapAvg)}`);
      console.log(`Average RSS delta per cycle: ${pretty(rssAvg)}`);

      // Thresholds for average stabilization (tune as needed)
      const heapDeltaThreshold = thresholdsMB.heap * 1024 * 1024;
      const rssDeltaThreshold = thresholdsMB.rss * 1024 * 1024;

      // The average delta should be close to zero (stabilizing)
      expect.soft(Math.abs(heapAvg), `heap average delta per cycle not stabilized: ${pretty(heapAvg)}`).toBeLessThan(heapDeltaThreshold);
      expect.soft(Math.abs(rssAvg), `rss average delta per cycle not stabilized: ${pretty(rssAvg)}`).toBeLessThan(rssDeltaThreshold);
    },
    300_000
  );
});