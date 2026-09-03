import { getAssets, getEntities } from '@/lib/store'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  CHR: 'Characters', GRP: 'Groups', LOC: 'Locations', PRP: 'Props',
  CRT: 'Creatures', COS: 'Costumes', VEH: 'Vehicles', FX: 'Effects', REF: 'Reference',
}

export default async function EntitiesPage() {
  const [entities, assets] = await Promise.all([getEntities(), getAssets()])
  const kinds = [...new Set(entities.map((e) => e.kind))]

  return (
    <div className="space-y-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Index</h1>
        <span className="text-sm text-[var(--color-muted)]">
          {entities.length} entities · {assets.length} assets
        </span>
      </div>

      {kinds.map((kind) => (
        <section key={kind}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-accent)]">
            {KIND_LABEL[kind] ?? kind}
          </h2>
          <div className="overflow-x-auto rounded-lg border border-[var(--color-edge)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-panel)] text-left text-xs uppercase text-[var(--color-muted)]">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Variants</th>
                  <th className="px-3 py-2">Flags</th>
                </tr>
              </thead>
              <tbody>
                {entities.filter((e) => e.kind === kind).map((e) => {
                  const mine = assets.filter((a) => a.entity_id === e.id)
                  const variants = [...new Set(mine.map((a) => a.variant))].sort()
                  return (
                    <tr key={e.id} className="border-t border-[var(--color-edge)] align-top">
                      <td className="px-3 py-2 font-mono text-xs">
                        <div className="text-white">{e.short_id}</div>
                        <div className="text-[var(--color-muted)]">{e.id}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{e.name}</div>
                        <div className="max-w-xl text-xs text-[var(--color-muted)]">
                          {e.description.slice(0, 160)}
                          {e.description.length > 160 ? '…' : ''}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">{e.status}</td>
                      <td className="px-3 py-2 text-xs">
                        {variants.length === 0 ? (
                          <span className="text-[var(--color-muted)]">none</span>
                        ) : (
                          variants.map((v) => (
                            <span
                              key={v}
                              className={
                                v === e.canonical_variant
                                  ? 'mr-1 rounded bg-[var(--color-accent)]/20 px-1 text-[var(--color-accent)]'
                                  : 'mr-1 text-[var(--color-muted)]'
                              }
                            >
                              {v}
                            </span>
                          ))
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--color-bad)]">{e.flags}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
