import { blockInternalId, parseBlockDisplayId } from './structure.ts'

/**
 * A Prompts-page target for a Sequence / Block project. People type PD-S01-B003; the worker only
 * knows the internal shot id PD-EP001-SC003-SH0010. The conversion happens in the panel, before
 * the batch is sent, never in the worker.
 */

/** The internal shot id for a block display id, or null when `target` is not one. */
export function blockTargetToInternal(code: string, target: string): string | null {
  const p = parseBlockDisplayId(code, String(target ?? '').trim())
  return p ? blockInternalId(code, p.seq, p.block) : null
}

/** The target as the worker should receive it: a block display id becomes its internal id. */
export function workerTarget(code: string, target: string): string {
  const t = String(target ?? '').trim()
  return blockTargetToInternal(code, t) ?? t
}

export const PICK_A_BLOCK = 'Pick a block (PD-S01-B003) — new scenes are made on the Sequence page.'
