import { requireProject } from '@/lib/projects'
import { getCatalog, getLibrary } from '@/lib/store'
import { ReferenceLibrary } from './reference-library'

export const dynamic = 'force-dynamic'

export default async function ReferencesPage({ params }: PageProps<'/[project]/references'>) {
  const pr = await requireProject((await params).project)
  const [data, catalog] = await Promise.all([getLibrary(pr), getCatalog(pr)])
  return <ReferenceLibrary data={data} catalog={catalog} />
}
