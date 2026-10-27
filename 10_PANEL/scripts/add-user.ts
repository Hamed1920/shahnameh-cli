// Create or update a person who can sign in. Idempotent.
//   npm run auth:add-user -- --email a@b.c --name "Hamed" --role owner [--project shahnameh-cli ...] [--password ...]
// No --password: a new account gets a random one, printed once. An existing account keeps its
// password unless --password is given. Reads DATABASE_URL from .env.local.
import { existsSync } from 'node:fs'
import { parseArgs } from 'node:util'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const { upsertUser } = await import('../lib/pd-users.ts')

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

const r = await upsertUser({ email, name: values.name, role, projects: values.project, password: values.password })
console.log(`${r.created ? 'Created' : 'Updated'} ${email} (${role}).`)
for (const slug of values.project ?? []) console.log(`  member of ${slug}`)
if (role === 'owner' && values.project?.length) console.log('  (owners see every project; membership is only a record)')
if (r.generatedPassword) console.log(`Password (shown once): ${r.generatedPassword}`)

process.exit(0)
