/** Runs once when the panel's server starts: keep the generation worker running (lib/worker-supervisor.ts). */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { superviseWorker } = await import('./lib/worker-supervisor')
    superviseWorker()
  }
}
