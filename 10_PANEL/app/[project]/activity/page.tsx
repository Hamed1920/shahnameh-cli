import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EmptyState } from '@/components/ui/card'
import { Table, Td, Th, Thead, Tr } from '@/components/ui/table'
import { PageHeader } from '@/components/ui/text'
import { requireCan } from '@/lib/actor'
import { authEnabled, Forbidden } from '@/lib/actor-core'
import { formatDetail } from '@/lib/audit-detail'
import { requireProject } from '@/lib/projects'

export const dynamic = 'force-dynamic'

const PAGE = 50
const when = (d: Date) => d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const INPUT = 'h-9 rounded-md border border-edge-strong bg-white/[0.02] px-3 text-sm text-fg focus:border-fg/45 focus:outline-none'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined

/**
 * The Activity Log: every important action taken in this project, newest first. Owner only, and
 * only with login on (there are no database audit rows otherwise). Filters and paging are in the URL.
 */
export default async function ActivityLogPage({ params, searchParams }: PageProps<'/[project]/activity'>) {
  if (!authEnabled()) notFound()
  const pr = await requireProject((await params).project)
  try {
    await requireCan(pr.slug, 'audit.view')
  } catch (e) {
    if (e instanceof Forbidden) notFound()
    throw e
  }
  const sp = await searchParams
  const action = one(sp.action)
  const actor = one(sp.actor)
  const object = one(sp.object)
  const offset = Math.max(0, Number.parseInt(one(sp.offset) ?? '0', 10) || 0)

  const { queryAudit, auditActions } = await import('@/lib/pd-activity')
  const [{ rows, more }, actions] = await Promise.all([
    queryAudit({ project: pr.slug, action, actor, object, limit: PAGE, offset }),
    auditActions(pr.slug),
  ])

  const base = `/${pr.slug}/activity`
  const link = (o: number) => {
    const q = new URLSearchParams()
    if (action) q.set('action', action)
    if (actor) q.set('actor', actor)
    if (object) q.set('object', object)
    if (o > 0) q.set('offset', String(o))
    const s = q.toString()
    return s ? `${base}?${s}` : base
  }

  return (
    <div className="space-y-10">
      <PageHeader title="Activity log" eyebrow={`Audit · ${pr.code}`}>
        Every important action in this film: who did it, to what, and what changed. Nothing here can be edited.
      </PageHeader>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="space-y-1.5"><span className="block text-xs text-faint">Action</span>
          <select name="action" defaultValue={action ?? ''} className={INPUT}>
            <option value="">All</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select></label>
        <label className="space-y-1.5"><span className="block text-xs text-faint">Who</span>
          <input name="actor" defaultValue={actor ?? ''} placeholder="name" className={INPUT} /></label>
        <label className="space-y-1.5"><span className="block text-xs text-faint">Object id</span>
          <input name="object" defaultValue={object ?? ''} placeholder="PD-S01-B003" className={INPUT} /></label>
        <button type="submit" className="focus-ring h-9 cursor-pointer rounded-md border border-edge-strong px-4 text-sm text-fg/90 hover:bg-white/[0.04]">Filter</button>
        {(action || actor || object) && <Link href={base} className="pb-2 text-sm text-muted hover:text-fg">Clear</Link>}
      </form>

      {rows.length === 0 ? (
        <EmptyState>Nothing logged{action || actor || object ? ' for these filters' : ' yet'}.</EmptyState>
      ) : (
        <Table>
          <Thead>
            <tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Object</Th><Th>Detail</Th></tr>
          </Thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="font-mono text-[11.5px] whitespace-nowrap text-muted">{when(r.createdAt)}</Td>
                <Td className="whitespace-nowrap text-fg">{r.actorName}</Td>
                <Td className="font-mono text-[11.5px] whitespace-nowrap text-muted">{r.action}</Td>
                <Td className="font-mono text-[11.5px] whitespace-nowrap text-muted">{r.objectType} <span className="text-fg/90">{r.objectId}</span></Td>
                <Td className="text-[12.5px] text-fg/80" dir="auto">{formatDetail(r.detail)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {(offset > 0 || more) && (
        <nav className="flex items-center gap-6 text-sm">
          {offset > 0 && <Link href={link(Math.max(0, offset - PAGE))} className="text-muted hover:text-fg">&larr; Newer</Link>}
          {more && <Link href={link(offset + PAGE)} className="text-muted hover:text-fg">Older &rarr;</Link>}
        </nav>
      )}
    </div>
  )
}
