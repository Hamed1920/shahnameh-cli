'use client'

import { installCatalog, type ModelCatalog } from '@/lib/models'

/**
 * Installs the server's newer model catalogue before anything below renders
 * (lib/catalog.ts). Done during render on purpose: it has to be in place for
 * this same pass, on the server's HTML render and in the browser alike, and
 * installing the same catalogue twice is a no-op.
 */
export function CatalogSync({ catalog, children }: { catalog: ModelCatalog | null; children: React.ReactNode }) {
  installCatalog(catalog)
  return children
}
