import { cliProblem, hfJson } from '../worker/lib/hf.mjs'

/**
 * Which Higgsfield account this machine's CLI is signed into, and how many credits it has left.
 *
 * Every project on a machine spends from this one account, so it is shown in the sidebar of all of
 * them. It comes from `higgsfield account status`, which takes a second or so, so the answer is kept
 * for a short while and shared by every tab that asks. A failure is kept for a few seconds only, so
 * signing in is noticed soon without hammering the CLI while it is down.
 */
export type Account =
  | { ok: true; email: string; plan: string | null; credits: number | null }
  | { ok: false; reason: string }

const GOOD_MS = 45_000
const BAD_MS = 8_000

let cached: { at: number; value: Account } | null = null
let inflight: Promise<Account> | null = null

async function ask(): Promise<Account> {
  const r = await hfJson(['account', 'status'], { timeoutMs: 20_000 })
  const j = r.json as { email?: unknown; credits?: unknown; subscription_plan_type?: unknown } | null
  if (r.code === 0 && j && typeof j.email === 'string') {
    return {
      ok: true,
      email: j.email,
      plan: typeof j.subscription_plan_type === 'string' ? j.subscription_plan_type : null,
      credits: typeof j.credits === 'number' ? j.credits : null,
    }
  }
  return { ok: false, reason: cliProblem(r.stderr || r.stdout) }
}

export async function getAccount(): Promise<Account> {
  if (cached && Date.now() - cached.at < (cached.value.ok ? GOOD_MS : BAD_MS)) return cached.value
  inflight ??= ask()
    .catch((e: Error): Account => ({ ok: false, reason: String(e?.message ?? e).slice(0, 200) }))
    .then((value) => {
      cached = { at: Date.now(), value }
      return value
    })
    .finally(() => { inflight = null })
  return inflight
}
