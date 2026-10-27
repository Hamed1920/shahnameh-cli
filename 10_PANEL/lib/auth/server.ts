// BetterAuth, built on first use. Importing this file touches nothing: no database, no env.
// Only loaded when SHM_AUTH=on (lib/actor.ts, the auth route, the login page).
import { betterAuth } from 'better-auth'
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
        role: { type: 'string', required: false, defaultValue: 'client', input: false },
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
