import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Table, Th, Thead } from '@/components/ui/table'
import { PageHeader } from '@/components/ui/text'
import { gate } from '@/lib/actor'
import { authEnabled } from '@/lib/actor-core'
import { listProjects } from '@/lib/projects'
import { NewAccount, UserRowView } from './users-ui'

export const dynamic = 'force-dynamic'

/** Accounts: who can sign in, as what, and on which films. Owner only, and only with login on. */
export default async function UsersPage() {
  if (!authEnabled()) notFound()
  const g = await gate(null, 'users.manage')
  if (!g.ok) notFound()
  const { listUsers } = await import('@/lib/pd-users')
  const [users, projects] = await Promise.all([listUsers(), listProjects()])
  const slugs = projects.map((p) => ({ slug: p.slug, name: p.name }))

  return (
    <main className="scroll-pane flex-1">
      <div className="mx-auto max-w-[1400px] space-y-12 px-6 pt-10 pb-24 lg:px-12">
        <PageHeader title="Accounts" eyebrow={<Link href="/" className="hover:text-fg">&larr; Films</Link>}>
          Who can sign in, what they are, and which films they can open. A disabled account is signed out at once.
        </PageHeader>

        <Table>
          <Thead>
            <tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Projects</Th><Th>Status</Th><Th><span className="sr-only">Password</span></Th></tr>
          </Thead>
          <tbody>
            {users.map((u) => (
              <UserRowView key={u.id} u={{ id: u.id, name: u.name, email: u.email, role: u.role, disabled: u.disabled, projects: u.projects }} projects={slugs} me={g.actor.id} />
            ))}
          </tbody>
        </Table>

        <NewAccount projects={slugs} />
      </div>
    </main>
  )
}
