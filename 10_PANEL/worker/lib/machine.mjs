import os from 'node:os'

/**
 * Which machine this is. Every machine runs its own workers with its own
 * Higgsfield account, and every record the panel or a worker writes says which
 * machine wrote it, so only that machine's worker ever acts on it: two machines
 * syncing through git never both approve, generate or file the same thing.
 *
 * SHM_MACHINE overrides the host name (a sandbox that plays two machines on one PC).
 * Lower case letters, digits and hyphens, so it can be part of a file name
 * (queue/state.<machine>.json).
 */
export function machineName(raw = process.env.SHM_MACHINE || os.hostname()) {
  const name = String(raw ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return name || 'machine'
}

export const MACHINE = machineName()

/**
 * Whose record this is: 'mine' (this machine's worker acts on it), 'other'
 * (another machine's worker does; this one leaves it alone), or 'old' (no
 * machine: written by a panel from before machines were named). Everything old
 * that was already processed stays processed; an old one that was not is never
 * guessed at, since two machines could both act on it.
 */
export function ownerOf(record) {
  if (!record?.machine) return 'old'
  return record.machine === MACHINE ? 'mine' : 'other'
}

/**
 * Who acts on a request is decided by what it is about, not only by who clicked:
 * approving or discarding a batch belongs to the machine that submitted it, and
 * everything in a studio session to the machine that started the session. So
 * Approve pressed on two machines for one batch reaches one worker, which queues
 * it once and refuses the second as already queued -- never two generations.
 * Everything else belongs to the machine that wrote it.
 */
export function requestOwners(requests) {
  const batch = new Map()
  const session = new Map()
  for (const r of requests) {
    if (r?.type === 'batch.submit' && r.batchId && !batch.has(r.batchId)) batch.set(r.batchId, r.machine ?? null)
    if (r?.type?.startsWith('studio.') && r.sessionId && !session.has(r.sessionId)) session.set(r.sessionId, r.machine ?? null)
  }
  return (req) => {
    if ((req?.type === 'batch.approve' || req?.type === 'batch.discard') && batch.has(req.batchId)) {
      return ownerOf({ machine: batch.get(req.batchId) })
    }
    if (req?.type?.startsWith('studio.') && session.has(req.sessionId)) {
      const started = session.get(req.sessionId)
      // A session from before machines were named can still be ended: closing only
      // puts unpicked results away, so the machine that asks does it.
      if (!started && req.type === 'studio.close') return ownerOf(req)
      return ownerOf({ machine: started })
    }
    return ownerOf(req)
  }
}

export const OLD_PANEL ='made by an older version of the panel, before each machine ran its own worker; nothing was done with it. Do it again.'
