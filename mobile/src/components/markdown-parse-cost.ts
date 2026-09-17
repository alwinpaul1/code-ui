/**
 * The fastest of several runs of `work`, in milliseconds.
 *
 * Why the fastest and not one run or a mean: these budgets exist to catch a
 * parser that got genuinely slower, and they are asserted on a shared CI runner
 * that can be several times slower than a laptop for reasons that have nothing
 * to do with the parser. On 2026-09-17 the 1000-item budget failed the 0.6.5
 * release at 16.79 ms against a 16 ms frame, while the same parse measured
 * 1.95-6.18 ms locally across nine samples. That is scheduler noise reported as
 * a regression, and it blocked a release that fixed three real defects.
 *
 * The minimum is the sample least polluted by preemption, so it still fails when
 * the parser is really slower — a parse that costs 20 ms costs 20 ms at its best
 * too — while a single unlucky sample can no longer fail a build.
 *
 * Keep the budgets themselves honest: they are frame budgets, and raising one to
 * make a build pass would retire the only check that this stays fast.
 */
export function fastestRunMs(work: () => void, runs = 5): number {
  let fastest = Number.POSITIVE_INFINITY
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now()
    work()
    const elapsed = performance.now() - started
    if (elapsed < fastest) {
      fastest = elapsed
    }
  }
  return fastest
}
