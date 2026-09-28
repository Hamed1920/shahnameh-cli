---
name: higgsfield-login
description: Log this machine into Higgsfield when it is not signed in, opening the sign-in page in the browser automatically, then select the account's workspace and confirm the plan and credits. Stops early if a login already works; switching accounts is /higgsfield-switch. Use when the user says "/higgsfield-login", "log into higgsfield", "connect higgsfield", "sign in to higgsfield", or when a generation fails with "Not authenticated", "No workspace selected" or "workspace_membership_required".
---

# Higgsfield login

Gets the `higgsfield` CLI signed in and ready to spend, end to end. The CLI's own `auth login`
opens the browser; the person only has to finish signing in there. Everything around it — checking
first, the workspace step people miss, and confirming which account it is — is done here.

Reference: `docs/reference/HIGGSFIELD-CLI.md`. There is no `auth status`; probe with `auth token`.

## 1. Check what is signed in now

```bash
higgsfield auth token >/dev/null 2>&1; echo "exit=$?"
higgsfield account status 2>&1
```

- **Signed in and `account status` prints `email — plan, N credits`:** report that account and stop,
  **unless** the user asked to switch or said it is the wrong account. Then go to step 2.
- **Signed in but `account status` fails** with `No workspace selected.` or
  `workspace_membership_required`: skip to step 4 — the login is fine, the workspace is not.
- **Not signed in** (`auth token` exit is not 0, "Not authenticated."): go to step 3.

If `higgsfield` itself is not found, install it first: `npm i -g @higgsfield/cli`.

## 2. Switching accounts: log out first

```bash
higgsfield auth logout
```

Say which account was signed in before, so the switch is on the record. Workers keep running;
until the new login completes any generation they try fails for lack of a login, and spends nothing.

## 3. Log in — opens the browser

Run it **in the background** (it waits for the browser to call back on `localhost:8765`):

```bash
higgsfield auth login
```

It prints `Opening browser for authentication...` and a fallback URL. Read the output once and give
the person that URL in case no browser window appeared. Tell them: sign in with the account they
want; if the browser is already signed into a different Higgsfield account, sign out there first or
it will hand back the old one.

Do not poll. The background task finishes with `Successfully authenticated.` when they are done;
continue from there. If it fails or times out, say so with its output and offer to run it again.

## 4. Select the workspace — the step that is easy to miss

A fresh login, or a switch, can leave no workspace (or the previous account's) selected, and then
every `cost`, `generate` and `account` call fails.

```bash
higgsfield workspace list
```

- One workspace listed: `higgsfield workspace set <id>`.
- Several: ask which one (show name, plan and credits for each), then set it. Never guess — it
  decides whose credits are spent.

## 5. Confirm

```bash
higgsfield account status
```

Report in one or two lines: the account email, the plan and the credits, and that the panel's
workers now generate on it. If the account changed, add that the panel's spend ceiling
(`costCeilingCredits` in `10_PANEL/worker/config.json`) still counts recent spend recorded in the
ledgers from the previous account until it ages out of the window.

## Never

- Never read, print or store the token from `auth token` — probe its exit code only.
- Never run `generate create` here, or anything that spends.
- Never pick between several workspaces for the person.
