'use client'

import { createContext, useContext, useMemo } from 'react'
import { assetUrl as buildAssetUrl, thumbUrl as buildThumbUrl } from '@/lib/asset'
import type { ProjectInfo } from '@/lib/projects'

/**
 * The project the open page belongs to, for client components.
 *
 * Everything under /<project>/ is one film. Media URLs and server actions both
 * carry the project, so two tabs on two projects never write to each other --
 * which is why this is a context and not a module-level variable.
 */
const ProjectContext = createContext<ProjectInfo | null>(null)

export function ProjectProvider({ project, children }: { project: ProjectInfo; children: React.ReactNode }) {
  return <ProjectContext.Provider value={project}>{children}</ProjectContext.Provider>
}

export function useProject(): ProjectInfo {
  const p = useContext(ProjectContext)
  if (!p) throw new Error('useProject must be used inside a project page')
  return p
}

/** Media helpers bound to the open project: assetUrl(rel), thumbUrl(rel, width). */
export function useAssetUrls() {
  const { slug } = useProject()
  return useMemo(
    () => ({
      assetUrl: (rel: string) => buildAssetUrl(slug, rel),
      thumbUrl: (rel: string, width = 96) => buildThumbUrl(slug, rel, width),
    }),
    [slug],
  )
}
