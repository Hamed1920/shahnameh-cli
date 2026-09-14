/**
 * The slice of INDEXING.md the panel needs to validate an upload before it is
 * recorded. The worker applies the same rules again when it files the upload
 * (worker/lib/promote.mjs) -- this copy exists so the reviewer sees a mistake
 * while the form is still open, not after the decision is logged.
 */

export const KINDS = ['CHR', 'GRP', 'LOC', 'PRP', 'CRT', 'COS', 'VEH', 'FX', 'REF'] as const
export type Kind = (typeof KINDS)[number]

export const KIND_LABEL: Record<Kind, string> = {
  CHR: 'Character',
  GRP: 'Group',
  LOC: 'Location',
  PRP: 'Prop',
  CRT: 'Creature',
  COS: 'Costume',
  VEH: 'Vehicle',
  FX: 'Effect',
  REF: 'Reference board',
}

/** RENDER is reserved for promoted generations; an upload is never one. */
export const UPLOAD_ROLES = ['HERO', 'TURNAROUND', 'PLATE', 'DETAIL', 'BOARD'] as const
export type UploadRole = (typeof UPLOAD_ROLES)[number]

export const UPLOAD_EXT = ['.png', '.jpg', '.jpeg', '.webp'] as const
export const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp'
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export const MAX_UPLOADS = 8

/** Registry text is read by PowerShell 5.1, which mangles non-ASCII. */
export const isAscii = (s: string) => /^[\x20-\x7E]*$/.test(s)

export const entitySlug = (s: string) =>
  String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40).replace(/-+$/, '')

export const descriptorSlug = (s: string) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48).replace(/-+$/, '') || 'upload'

/** Tags split on the Latin comma and the Persian one, so a Farsi list works too. */
export const splitTags = (s: string) =>
  String(s || '').split(/[,،]/).map((t) => t.trim()).filter(Boolean)
