/**
 * Credits spent on generations in the last `hours`, from JOB_LEDGER.csv rows.
 * The spend ceiling is a rolling window over this, not state.spentCredits: that
 * is a lifetime total, and with a worker that never stops it only ever grows, so
 * a ceiling on it eventually holds every job for good.
 *
 * Every project spends from the same Higgsfield account, so callers pass the
 * rows of every project's ledger, not just their own. Pure.
 *
 * Counted: GENERATED, and the two outcomes Higgsfield may still have charged for --
 * NO_RESULT (the job came back without a file: failed, filtered) and TIMED_OUT
 * (the worker gave up waiting). Guessing high only holds a job a little early;
 * guessing low could pass the ceiling. FAILED (the CLI refused the job) is not.
 */
export const CHARGED_STATES = new Set(['GENERATED', 'NO_RESULT', 'TIMED_OUT'])

/**
 * @param {Record<string, string>[]} rows
 * @param {number} hours
 * @param {number} [now]
 * @param {string | null} [machine]
 */
export function spentInWindow(rows, hours, now = Date.now(), machine = null) {
  const since = now - hours * 3600_000
  let total = 0
  for (const r of rows) {
    if (!CHARGED_STATES.has(r.state)) continue
    // Each machine spends from its own Higgsfield account, so with `machine` given
    // only its rows count. A row with no machine predates that and counts for all.
    if (machine && r.machine && r.machine !== machine) continue
    const cost = parseFloat(r.cost)
    const at = Date.parse(r.ingested)
    if (Number.isFinite(cost) && Number.isFinite(at) && at >= since) total += cost
  }
  return total
}
