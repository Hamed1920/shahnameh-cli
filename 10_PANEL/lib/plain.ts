/**
 * The worker's reasons, as a sentence for Hamed rather than for whoever wrote
 * the worker: no config keys, no shell commands, no file names he never sees.
 *
 * Applied where a reason is shown, not where it is written, so the reasons
 * already in state.json and the result files read well too. A reason nothing
 * here recognises is shown as it is -- the worker's own words beat a guess.
 * Client-safe.
 */

const n = (s: string) => Number(s).toLocaleString('en-GB')

const RULES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^(\d+) credits is more than perJobCostCeilingCredits (\d+)/,
    (m) => `Costs ${n(m[1])} credits, more than the ${n(m[2])} one job may cost. Change the settings, or raise the limit.`],
  [/^(\d+) credits would pass costCeilingCredits (\d+) for the last (\d+) h \((\d+) spent across all projects\)/,
    (m) => `Costs ${n(m[1])} credits, and ${n(m[4])} of the ${n(m[2])} allowed in ${m[3]} hours are spent. It starts by itself as older spending drops out of the window.`],
  [/could not be priced, so it will not generate: (.*)$/,
    (m) => `Higgsfield could not price it, so it will not run: ${plainReason(m[1])}`],
  [/Higgsfield CLI is not installed/i,
    () => 'The Higgsfield tool is not installed on this computer.'],
  [/no Higgsfield workspace is selected/i,
    () => 'Higgsfield needs a workspace chosen on this computer before it can run anything.'],
  [/Higgsfield CLI is not signed in/i,
    () => 'Higgsfield is not signed in on this computer.'],
  [/^Higgsfield did not finish within (.+?); it may still complete and be charged/,
    (m) => `Higgsfield did not finish within ${m[1]}. It may still finish, and be charged, on Higgsfield's side.`],
  [/^SHM_WORKER=off on this machine$/,
    () => 'Workers are switched off on this computer.'],
  [/^SHM_PROJECTS points at a copy without the stub CLI/,
    () => 'The panel is looking at test copies of the films without the test tool, so no worker runs: it would spend real credits.'],
  [/^SHM_ROOT is set for the panel/,
    () => 'The panel was started with a setting that stops it running workers (SHM_ROOT). Start it the usual way.'],
]

export function plainReason(reason: string | null | undefined): string {
  const r = String(reason ?? '').trim()
  if (!r) return ''
  for (const [rx, say] of RULES) {
    const m = r.match(rx)
    if (m) return say(m)
  }
  return r.charAt(0).toUpperCase() + r.slice(1)
}
