import { requireProject } from '@/lib/projects'
import { getCatalog, getLibrary, getWorkerConfig, listStudioSessions } from '@/lib/store'
import { ReferenceLibrary } from './reference-library'
import { StudioLauncher } from './studio-launcher'

export const dynamic = 'force-dynamic'

export default async function ReferencesPage({ params }: PageProps<'/[project]/references'>) {
  const pr = await requireProject((await params).project)
  const [data, catalog, cfg, sessions] = await Promise.all([getLibrary(pr), getCatalog(pr), getWorkerConfig(), listStudioSessions(pr)])
  const studioCfg = {
    pinned: (cfg.pinnedModels as string[] | undefined) ?? [],
    aspectRatios: (cfg.aspectRatios as string[] | undefined) ?? ['1:1', '16:9', '9:16'],
    defaultImageModel: String(cfg.defaultImageModel ?? 'nano_banana_pro'),
  }
  return (
    <div className="space-y-6">
      <StudioLauncher catalog={catalog} cfg={studioCfg} sessions={sessions} />
      <ReferenceLibrary data={data} catalog={catalog} />
    </div>
  )
}
