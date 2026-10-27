/**
 * Does a release cover a file? Pure: no database, no disk, so `npm test` runs it.
 *
 * A release is a kind and a ref:
 *   take     the file name without its extension (assetToRef(path).take)
 *   shot     EPnnn-SCnnn-SHnnnn  (shot numbers repeat in every scene, so the scene is part of it)
 *   episode  EPnnn
 * A shot or episode release covers every take filed under it.
 */
import type { AssetRef } from './asset-ref.ts'

export type ReleaseKind = 'take' | 'shot' | 'episode'
export type ReleaseKey = { kind: ReleaseKind; ref: string }

export const RELEASE_KINDS: readonly ReleaseKind[] = ['take', 'shot', 'episode']

const SHOT_REF = /^(EP\d{3})-(SC\d{3})-(SH\d{4})$/
const EPISODE_REF = /^EP\d{3}$/
const TAKE_REF = /^[A-Za-z0-9._-]{1,200}$/

/** Is this ref well formed for its kind? */
export function validRef(kind: string, ref: string): boolean {
  if (kind === 'take') return TAKE_REF.test(ref) && !ref.includes('..')
  if (kind === 'shot') return SHOT_REF.test(ref)
  if (kind === 'episode') return EPISODE_REF.test(ref)
  return false
}

/** The ref of a shot release, from the parts an asset path gives. Null when one is missing. */
export function shotRefOf(a: AssetRef): string | null {
  return a.episode && a.scene && a.shot ? `${a.episode}-${a.scene}-${a.shot}` : null
}

/** Is `a` covered by any of these (live) releases? */
export function refCovers(releases: readonly ReleaseKey[], a: AssetRef): boolean {
  const shot = shotRefOf(a)
  return releases.some((r) => {
    if (r.kind === 'take') return a.take !== undefined && a.take === r.ref
    if (r.kind === 'shot') return shot !== null && shot === r.ref
    if (r.kind === 'episode') return a.episode !== undefined && a.episode === r.ref
    return false
  })
}
