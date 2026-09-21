/**
 * Media helpers shared by the review and decided views.
 *
 * Project files live outside `public/`, so every one of them is served through
 * the project's `/<project>/api/asset` route rather than linked directly. Client
 * components get the project from useProject() (components/project-context.tsx). Keep this module free of
 * `node:` imports -- it is used from client components too.
 */

/** Serve a project-relative path through that project's guarded asset route. */
export function assetUrl(project: string, rel: string) {
  return `/${project}/api/asset?path=${encodeURIComponent(rel)}`
}

/** A small JPEG of a project image, for chips and lists (the original can be several MB). */
export function thumbUrl(project: string, rel: string, width = 96) {
  return `/${project}/api/thumb?path=${encodeURIComponent(rel)}&w=${width}`
}

export function isVideo(p: string) {
  return /\.(mp4|mov|webm)$/i.test(p)
}

/**
 * Whether a take is filed as footage in an episode.
 *
 * The only thing that can change episode. "It has a file" is not the same
 * question and was the wrong one: an approved 480p draft has a file, in
 * 09_OUTPUT/_drafts, and the worker -- which looks in the episode's shots
 * folder -- has nothing to carry. Offering one refused a whole batch of moves
 * because of a single row.
 */
export function isFiledShot(file: string | null | undefined): boolean {
  return /^07_EPISODES\/[^/]+\/shots\//.test(String(file ?? ''))
}
