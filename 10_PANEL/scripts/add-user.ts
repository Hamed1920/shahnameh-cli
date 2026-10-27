// Create or update a person who can sign in. Idempotent.
//   npm run auth:add-user -- --email a@b.c --name "Hamed" --role owner [--project shahnameh-cli ...] [--password ...]
// No --password: a new account gets a random one, printed once. An existing account keeps its
// password unless --password is given. Reads DATABASE_URL from .env.local.
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { hashPassword } from 'better-auth/crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '../lib/db/client.ts'
import { account, projectMember, user } from '../lib/db/schema.ts'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string' },
    project: { type: 'string', multiple: true },
    password: { type: 'string' },
  },
})

const email = values.email?.trim().toLowerCase()
const role = values.role ?? 'supervisor'
if (!email || !values.name) throw new Error('Usage: --email <email> --name <name> [--role owner|production|director|supervisor] [--project <slug> ...] [--password <pw>]')
if (!['owner', 'production', 'director', 'supervisor'].includes(role)) throw new Error(`Unknown role "${role}": use owner, production, director or supervisor.`)
if (values.password !== undefined && values.password.length < 8) throw new Error('--password must be at least 8 characters.')

const db = getDb()
const [existing] = await db.select().from(user).where(eq(user.email, email))
let userId: string
let printed: string | null = null

if (existing) {
  userId = existing.id
  await db.update(user).set({ name: values.name, role, updatedAt: new Date() }).where(eq(user.id, userId))
  const [cred] = await db.select().from(account).where(eq(account.userId, userId))
  if (values.password !== undefined) {
    const hash = await hashPassword(values.password)
    if (cred && cred.providerId === 'credential') await db.update(account).set({ password: hash, updatedAt: new Date() }).where(eq(account.id, cred.id))
    else await db.insert(account).values({ id: randomUUID(), accountId: userId, providerId: 'credential', userId, password: hash })
  }
  console.log(`Updated ${email} (${role}).`)
} else {
  userId = randomUUID()
  const password = values.password ?? randomBytes(12).toString('base64url')
  if (values.password === undefined) printed = password
  await db.insert(user).values({ id: userId, name: values.name, email, emailVerified: true, role })
  await db.insert(account).values({ id: randomUUID(), accountId: userId, providerId: 'credential', userId, password: await hashPassword(password) })
  console.log(`Created ${email} (${role}).`)
}

for (const slug of values.project ?? []) {
  await db.insert(projectMember).values({ projectSlug: slug, userId }).onConflictDoNothing()
  console.log(`  member of ${slug}`)
}
if (role === 'owner' && values.project?.length) console.log('  (owners see every project; membership is only a record)')
if (printed) console.log(`Password (shown once): ${printed}`)

process.exit(0)
