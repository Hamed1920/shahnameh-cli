/** Runs once when the panel's server starts: keep the generation worker running (lib/worker-supervisor.ts). */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Login on needs a database and a secret. Refuse to start rather than fall back to off.
    if (process.env.SHM_AUTH === 'on') {
      const missing = ['DATABASE_URL', 'BETTER_AUTH_SECRET'].filter((k) => !process.env[k])
      if (missing.length) {
        throw new Error(`SHM_AUTH=on but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set. Fill them in .env.local (see README, "Login and database") or unset SHM_AUTH.`)
      }
    }
    const { superviseWorker } = await import('./lib/worker-supervisor')
    superviseWorker()
  }
}
