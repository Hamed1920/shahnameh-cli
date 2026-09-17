/**
 * Credits spent on generations in the last `hours`, from JOB_LEDGER.csv rows.
 * The spend ceiling is a rolling window over this, not state.spentCredits: that
 * is a lifetime total, and with a worker that never stops it only ever grows, so
 * a ceiling on it eventually holds every job for good.
 *
 * Every project spends from the same Higgsfield account, so callers pass the
 * rows of every project's ledger, not just their own. Pure.
 */
export function spentInWindow(rows, hours, now = Date.now()) {
  const since = now - hours * 3600_000
  let total = 0
  for (const r of rows) {
    if (r.state !== 'GENERATED') continue
    const cost = parseFloat(r.cost)
    const at = Date.parse(r.ingested)
    if (Number.isFinite(cost) && Number.isFinite(at) && at >= since) total += cost
  }
  return total
}
