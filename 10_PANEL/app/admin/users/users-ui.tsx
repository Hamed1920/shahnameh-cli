'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { Td, Tr } from '@/components/ui/table'
import { SectionHeading } from '@/components/ui/text'
import { changeDisabled, changeProjects, changeRole, createAccount, resetAccountPassword } from './actions'

const ROLES = ['owner', 'production', 'director', 'supervisor']
const SELECT = 'h-8 rounded-md border border-edge-strong bg-ink px-2 text-[13px] text-fg focus:border-fg/45 focus:outline-none'

type Proj = { slug: string; name: string }
type U = { id: string; name: string; email: string; role: string; disabled: boolean; projects: string[] }
type R = { ok: true; password?: string } | { ok: false; error: string }

export function UserRowView({ u, projects, me }: { u: U; projects: Proj[]; me: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(f: () => Promise<R>) {
    setBusy(true)
    setError(null)
    const r = await f().catch((e: Error) => ({ ok: false as const, error: e.message }))
    setBusy(false)
    if (!r.ok) setError(r.error)
    else if (r.password) setPassword(r.password)
    router.refresh()
  }

  const toggleProject = (slug: string, on: boolean) =>
    run(() => changeProjects(u.id, on ? [...u.projects, slug] : u.projects.filter((s) => s !== slug)))

  return (
    <Tr className={u.disabled ? 'opacity-60' : undefined}>
      <Td className="whitespace-nowrap text-fg">{u.name}{u.id === me && <span className="ml-2 text-xs text-faint">you</span>}</Td>
      <Td className="font-mono text-[12px] text-muted">{u.email}</Td>
      <Td>
        <select aria-label={`Role of ${u.name}`} className={SELECT} value={u.role} disabled={busy} onChange={(e) => run(() => changeRole(u.id, e.target.value))}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </Td>
      <Td>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {projects.map((p) => (
            <label key={p.slug} className="flex cursor-pointer items-center gap-1.5 text-[13px] text-muted">
              <input type="checkbox" checked={u.projects.includes(p.slug)} disabled={busy} onChange={(e) => toggleProject(p.slug, e.target.checked)} />
              {p.name}
            </label>
          ))}
          {u.role === 'owner' && <span className="text-xs text-faint">(owners open every film)</span>}
        </div>
      </Td>
      <Td>
        <Button type="button" size="sm" tone={u.disabled ? 'accent' : 'outline'} disabled={busy} onClick={() => run(() => changeDisabled(u.id, !u.disabled))}>
          {u.disabled ? 'Disabled · enable' : 'Active · disable'}
        </Button>
      </Td>
      <Td className="text-right">
        <Button type="button" size="sm" tone="ghost" disabled={busy} onClick={() => run(() => resetAccountPassword(u.id))}>Reset password</Button>
        {password && (
          <p className="mt-2 text-xs text-muted">New password, shown once: <code className="font-mono text-fg select-all">{password}</code></p>
        )}
        {error && <p role="alert" className="mt-2 text-xs text-bad">{error}</p>}
      </Td>
    </Tr>
  )
}

export function NewAccount({ projects }: { projects: Proj[] }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('production')
  const [picked, setPicked] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [made, setMade] = useState<{ email: string; password: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setMade(null)
    const r = await createAccount({ email, name, role, projects: picked }).catch((x: Error) => ({ ok: false as const, error: x.message }))
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setMade({ email, password: r.password ?? '' })
    setEmail(''); setName(''); setPicked([])
    router.refresh()
  }

  return (
    <section>
      <SectionHeading>New account</SectionHeading>
      <form onSubmit={submit} className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <label className="space-y-2"><span className="block text-[12.5px] text-muted">Email</span>
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="space-y-2"><span className="block text-[12.5px] text-muted">Name</span>
          <Input required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="space-y-2"><span className="block text-[12.5px] text-muted">Role</span>
          <select className={SELECT + ' block w-full'} value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select></label>
        <fieldset className="space-y-2">
          <legend className="text-[12.5px] text-muted">Projects</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {projects.map((p) => (
              <label key={p.slug} className="flex cursor-pointer items-center gap-1.5 text-[13px] text-muted">
                <input type="checkbox" checked={picked.includes(p.slug)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.slug] : picked.filter((s) => s !== p.slug))} />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sm:col-span-2">
          <Button type="submit" tone="accent" pending={busy} pendingLabel="Creating">Create account</Button>
        </div>
        {error && <p role="alert" className="text-sm text-bad sm:col-span-2">{error}</p>}
        {made && (
          <p className="text-sm text-muted sm:col-span-2">
            Created {made.email}. Password, shown once: <code className="font-mono text-fg select-all">{made.password}</code>
          </p>
        )}
      </form>
    </section>
  )
}
