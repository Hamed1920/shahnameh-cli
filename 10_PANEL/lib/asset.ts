/**
 * Media helpers shared by the review and decided views.
 *
 * Project files live outside `public/`, so every one of them is served through
 * the `/api/asset` route rather than linked directly. Keep this module free of
 * `node:` imports -- it is used from client components too.
 */

/** Serve a project-relative path through the guarded asset route. */
export function assetUrl(rel: string) {
  return `/api/asset?path=${encodeURIComponent(rel)}`
}

export function isVideo(p: string) {
  return /\.(mp4|mov|webm)$/i.test(p)
}
