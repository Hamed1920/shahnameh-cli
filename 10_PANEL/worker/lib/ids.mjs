/**
 * The ID grammar every project shares (docs/INDEXING.md). Only the project
 * code -- the SHM in SHM-CHR-001-ZAHHAK -- differs between projects; kinds,
 * folders, the EP/SQ/SC/SH shape and the rules below are the same everywhere.
 *
 * Pure and dependency-free: the worker, the panel's server and the panel's
 * browser code all import this one copy.
 */

/** @type {readonly ['CHR', 'GRP', 'LOC', 'PRP', 'CRT', 'COS', 'VEH', 'FX', 'REF']} */
export const KINDS = ['CHR', 'GRP', 'LOC', 'PRP', 'CRT', 'COS', 'VEH', 'FX', 'REF']

/** Mirrors $ShmFolderFor in tools/Shm-Common.ps1. */
/** @type {Record<string, string>} */
export const FOLDER_FOR = {
  CHR: '01_CHARACTERS', GRP: '02_GROUPS', LOC: '03_LOCATIONS', PRP: '04_PROPS',
  CRT: '05_CREATURES', COS: '06_COSTUMES', VEH: '04_PROPS', FX: '08_REFERENCE', REF: '08_REFERENCE',
}

/** Every folder a project has, in order. */
export const PROJECT_FOLDERS = [
  '00_PROJECT', '01_CHARACTERS', '02_GROUPS', '03_LOCATIONS', '04_PROPS', '05_CREATURES',
  '06_COSTUMES', '07_EPISODES', '08_REFERENCE', '09_OUTPUT', '99_INBOX',
]

// ---------------------------------------------------------------- project code and slug

export const CODE_RX = /^[A-Z]{2,4}$/
/** A code that reads as part of an ID would make IDs ambiguous. */
export const RESERVED_CODES = [...KINDS, 'EP', 'SC', 'SH', 'SQ', 'NEW', 'NEXT', 'JOB']

export const SLUG_RX = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/
/** Names a project folder cannot take. */
export const RESERVED_SLUGS = [
  // Panel pages, so a project can never shadow one...
  'api', 'new', 'review', 'decided', 'references', 'entities', 'learnings', 'prompts', 'queue', 'gallery',
  // ...and the system's own folders, which sit beside the projects.
  'tools', 'docs', 'templates', 'node_modules',
]

/** @param {string} code @returns {string | null} why the code cannot be used */
export function codeProblem(code) {
  const c = String(code ?? '')
  if (!CODE_RX.test(c)) return 'The code is 2 to 4 capital letters, like SHM.'
  if (RESERVED_CODES.includes(c)) return `${c} is already a word in IDs; pick another code.`
  return null
}

/** @param {string} slug @returns {string | null} why the slug cannot be used */
export function slugProblem(slug) {
  const s = String(slug ?? '')
  if (!SLUG_RX.test(s)) return 'The folder name uses lowercase letters, digits and dashes (up to 40), like my-film.'
  if (RESERVED_SLUGS.includes(s)) return `"${s}" is a panel page name; pick another folder name.`
  return null
}

/** @param {string} name */
export function suggestSlug(name) {
  return String(name ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
}

/**
 * Initials of the name's words, padded from its letters, e.g. "The Silk Road"
 * -> TSR, "Rostam" -> ROS. Skips codes in `taken` and reserved ones.
 * @param {string} name @param {string[]} [taken]
 */
export function suggestCode(name, taken = []) {
  const letters = String(name ?? '').toUpperCase().normalize('NFKD').replace(/[^A-Z\s]/g, '')
  const words = letters.split(/\s+/).filter(Boolean)
  const flat = words.join('')
  const tries = []
  if (words.length >= 2) tries.push(words.map((w) => w[0]).join('').slice(0, 4))
  if (flat.length >= 3) tries.push(flat.slice(0, 3))
  if (flat.length >= 4) tries.push(flat.slice(0, 4), flat[0] + flat.slice(-2))
  for (const t of tries) if (!codeProblem(t) && !taken.includes(t)) return t
  const base = (flat + 'XX').slice(0, 2)
  for (let i = 0; i < 26; i++) {
    const t = base + String.fromCharCode(65 + i)
    if (!codeProblem(t) && !taken.includes(t)) return t
  }
  return ''
}

// ---------------------------------------------------------------- IDs

const esc = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * @typedef {{
 *   prefix: RegExp, entity: RegExp, shot: RegExp, episodePrefix: RegExp,
 *   shotParts: RegExp, sceneAtStart: RegExp, sceneAnywhere: RegExp, shotAnywhere: RegExp,
 *   shotFileStart: RegExp,
 * }} IdRx
 */

/** @type {Map<string, IdRx>} */
const cache = new Map()

/** Every ID pattern, for one project code. @param {string} code @returns {IdRx} */
export function idRx(code) {
  const hit = cache.get(code)
  if (hit) return hit
  const c = esc(String(code))
  const rx = {
    /** The code and its dash at the start of an id. */
    prefix: new RegExp(`^${c}-`),
    /** CODE-KIND-NNN-SLUG */
    entity: new RegExp(`^${c}-(${KINDS.join('|')})-(\\d{3})-([A-Z0-9-]+)$`),
    /** CODE-EP001, CODE-EP001-SC010, CODE-EP001-SQ02-SC010-SH0010 ... */
    shot: new RegExp(`^${c}-EP\\d{3}(-SQ\\d{2})?(-SC\\d{3})?(-SH\\d{4})?$`),
    episodePrefix: new RegExp(`^${c}-EP\\d{3}`),
    /** [episode, scene?, shot?] of an id that starts with an episode. */
    shotParts: new RegExp(`^${c}-(EP\\d{3})(?:-(SC\\d{3}))?(?:-(SH\\d{4}))?`),
    /** [episode, scene number] at the start. */
    sceneAtStart: new RegExp(`^${c}-(EP\\d{3})-SC(\\d{3})`),
    /** [episode, scene number] anywhere, e.g. inside a file name. */
    sceneAnywhere: new RegExp(`${c}-(EP\\d{3})-SC(\\d{3})`),
    /** [ep digits, scene digits, shot digits] anywhere, any case. */
    shotAnywhere: new RegExp(`${c}-EP(\\d{3})-SC(\\d{3})-SH(\\d{4})`, 'i'),
    /** A full shot id at the start of a file name. */
    shotFileStart: new RegExp(`^${c}-EP\\d{3}-SC\\d{3}-SH\\d{4}`),
  }
  cache.set(code, rx)
  return rx
}

/** @param {string} code @param {string} kind @param {string} nnn @param {string} slug */
export const entityId = (code, kind, nnn, slug) => `${code}-${kind}-${nnn}-${slug}`

/** A scene's single shot: CODE-EP001-SC014-SH0010. @param {string} code @param {string} episode @param {number | string} scene */
export const shotId = (code, episode, scene) => `${code}-${episode}-SC${String(scene).padStart(3, '0')}-SH0010`

/** CHR-001-ZAHHAK from SHM-CHR-001-ZAHHAK. @param {string} code @param {string} id */
export const stripCode = (code, id) => String(id ?? '').replace(idRx(code).prefix, '')
