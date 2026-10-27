// BetterAuth, built on first use. Importing this file touches nothing: no database, no env.
// Only loaded when SHM_AUTH=on (lib/actor.ts, the auth route, the login page).
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { getDb } from '../db/client.ts'
import * as schema from '../db/schema.ts'

function makeAuth() {
  const origins = ['http://localhost:3000', 'http://127.0.0.1:3000']
  if (process.env.BETTER_AUTH_URL) origins.push(process.env.BETTER_AUTH_URL)
  return betterAuth({
    database: drizzleAdapter(getDb(), { provider: 'pg', schema }),
    // Accounts are made by `npm run auth:add-user`, never by visitors.
    emailAndPassword: { enabled: true, disableSignUp: true },
    user: {
      additionalFields: {
        role: { type: 'string', required: false, defaultValue: 'supervisor', input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // No session is made for a disabled account, so sign-in is refused.
          before: async (s) => {
            const [u] = await getDb().select({ disabled: schema.user.disabled }).from(schema.user).where(eq(schema.user.id, s.userId))
            if (u?.disabled) throw new APIError('FORBIDDEN', { message: 'This account is disabled.' })
          },
        },
      },
    },
    trustedOrigins: origins,
    plugins: [nextCookies()], // keep last
  })
}

let auth: ReturnType<typeof makeAuth> | undefined

export function getAuth() {
  return (auth ??= makeAuth())
}
