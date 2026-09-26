import { loadCatalog } from '../worker/lib/models.mjs'
import { bundledFetchedAt, installCatalog, type ModelCatalog } from './models'

/**
 * The model catalogue as the worker last wrote it, read on the server.
 *
 * A production build carries the copy it was built with (lib/models.ts), and
 * the worker refreshes the file daily. This re-reads it when it changes
 * (loadCatalog is memoised by mtime), installs it for server code, and returns
 * it when it differs from the build's copy so the layout can pass it on to the
 * browser. Null when the build's copy is current: nothing extra to send.
 */
export function freshCatalog(): ModelCatalog | null {
  const disk = loadCatalog() as ModelCatalog | null
  installCatalog(disk)
  return disk?.models && disk.fetchedAt !== bundledFetchedAt ? disk : null
}
