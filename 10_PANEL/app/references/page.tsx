import { getCatalog, getLibrary } from '@/lib/store'
import { ReferenceLibrary } from './reference-library'

export const dynamic = 'force-dynamic'

export default async function ReferencesPage() {
  const [data, catalog] = await Promise.all([getLibrary(), getCatalog()])
  return <ReferenceLibrary data={data} catalog={catalog} />
}
