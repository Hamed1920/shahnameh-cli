import { getAssets, getEntities } from '@/lib/store'
import { Reveal } from '@/components/ui/reveal'
import { Table, Td, Th, Thead, Tr } from '@/components/ui/table'
import { Badge, PageHeader, SectionHeading } from '@/components/ui/text'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  CHR: 'Characters',
  GRP: 'Groups',
  LOC: 'Locations',
  PRP: 'Props',
  CRT: 'Creatures',
  COS: 'Costumes',
  VEH: 'Vehicles',
  FX: 'Effects',
  REF: 'Reference',
}

export default async function EntitiesPage() {
  const [entities, assets] = await Promise.all([getEntities(), getAssets()])
  const kinds = [...new Set(entities.map((e) => e.kind))]

  return (
    <div className="space-y-16">
      <PageHeader
        title="Index"
        eyebrow="Registry"
        meta={`${entities.length} entities · ${assets.length} assets`}
      >
        Every entity in <code className="font-mono text-[13px] text-fg">ENTITIES.csv</code>, grouped by
        kind, with the looks registered against it. The main look is filled.
      </PageHeader>

      {kinds.map((kind, ki) => (
        <Reveal key={kind} index={ki}>
          <section>
            <SectionHeading count={entities.filter((e) => e.kind === kind).length}>{KIND_LABEL[kind] ?? kind}</SectionHeading>
            <Table>
              <Thead>
                <tr>
                  {/* Fixed widths, so the columns line up from one kind's table to the next. */}
                  <Th className="w-64">ID</Th>
                  <Th>Name</Th>
                  <Th className="w-32">Status</Th>
                  <Th className="w-52">Variants</Th>
                  <Th className="w-64">Flags</Th>
                </tr>
              </Thead>
              <tbody>
                {entities
                  .filter((e) => e.kind === kind)
                  .map((e) => {
                    const mine = assets.filter((a) => a.entity_id === e.id)
                    const variants = [...new Set(mine.map((a) => a.variant))].sort()
                    return (
                      <Tr key={e.id}>
                        <Td className="font-mono text-xs whitespace-nowrap">
                          <div className="font-medium text-fg">{e.short_id}</div>
                          <div className="mt-1 text-faint">{e.id}</div>
                        </Td>
                        <Td>
                          <div className="text-[15px] text-fg">{e.name}</div>
                          <div className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted">
                            {e.description.slice(0, 160)}
                            {e.description.length > 160 ? '…' : ''}
                          </div>
                        </Td>
                        <Td className="font-mono text-[11px] tracking-wide text-muted">{e.status}</Td>
                        <Td>
                          {variants.length === 0 ? (
                            <span className="text-xs text-faint">none</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {variants.map((v) => (
                                <Badge
                                  key={v}
                                  tone={v === e.canonical_variant ? 'accent' : 'muted'}
                                  className="font-mono"
                                >
                                  {v}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </Td>
                        <Td>{e.flags && <Badge tone="bad">{e.flags}</Badge>}</Td>
                      </Tr>
                    )
                  })}
              </tbody>
            </Table>
          </section>
        </Reveal>
      ))}
    </div>
  )
}
