---
name: higgsfield-switch
description: Force a fresh Higgsfield login in Chrome, whatever is signed in now, so the CLI takes whichever Higgsfield account Chrome is signed into -- the way to switch accounts. Then selects that account's workspace and confirms the email, plan and credits. Use when the user says "/higgsfield-switch", "switch higgsfield account", "use the account in chrome", "log into the other higgsfield account", "change higgsfield account", or "it's the wrong higgsfield account".
---

# Higgsfield switch

Signs the `higgsfield` CLI in again **no matter what is signed in now**, through Chrome. Higgsfield's
sign-in page hands back whichever account Chrome is already signed into, so this is how Hamed moves
the CLI -- and with it the panel's workers and whose credits they spend -- to the account Chrome has.
To change which account that is, he signs into it in Chrome first.

`/higgsfield-login` is the gentle one: it stops when a login already works. This one never stops early.

Reference: `docs/reference/HIGGSFIELD-CLI.md`. There is no `auth status`; probe with `auth token`.

## 1. Record who is signed in now

```bash
higgsfield account status 2>&1
```

Note the email it prints (or that there is none), so the switch is on the record. Whatever it says,
go on -- that is the point of this command.

If `higgsfield` itself is not found, install it first: `npm i -g @higgsfield/cli`.

## 2. Log in again -- the sign-in page opens in Chrome

Do **not** log out first. Signing in over the current login replaces it once the new one completes,
and if Hamed abandons the Chrome tab the old account keeps working; logging out first would leave
the workers with no account at all.

Run it **in the background** (it waits for the browser to call back on `localhost:8765`):

```bash
higgsfield auth login
```

The CLI opens the sign-in page in the **system default browser**; it has no flag to choose one.
Check which that is:

```bash
plutil -convert json -o - ~/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=(JSON.parse(s||"{}").LSHandlers||[]).find(x=>x.LSHandlerURLScheme==="https");console.log(h?.LSHandlerRoleAll||"com.apple.safari")})'
```

- `com.google.chrome`: the CLI's own tab is already in Chrome. Nothing more to open.
- Anything else (`com.apple.safari` when no default was ever set): read the background task's output once for the fallback URL it
  prints under `Opening browser for authentication...` and open that in Chrome:
  `open -a "Google Chrome" "<url>"`. Tell Hamed a second tab may have opened in the other browser;
  close it, the Chrome one is the one to finish.

Tell Hamed, in one line: finish the sign-in in the Chrome tab; it signs in whichever Higgsfield
account Chrome is logged into, so if that is not the one he wants, switch accounts in Chrome first
and then approve. Give him the fallback URL too, in case no tab appeared.

If the login instead refuses because a login already exists, run `higgsfield auth logout`, say so,
and start step 2 again.

Do not poll. The background task finishes with `Successfully authenticated.` when he is done;
continue from there. If it fails or times out, say so with its output. The previous login is still
in place in that case (unless the logout fallback ran), and offer to run it again.

## 3. Select the workspace -- a switch almost always needs it

A new account starts with no workspace selected, or still the previous account's, and then every
`cost`, `generate` and `account` call fails with `No workspace selected.` or
`workspace_membership_required`.

```bash
higgsfield workspace list
```

- One workspace listed: `higgsfield workspace set <id>`.
- Several: ask which one (show name, plan and credits for each), then set it. Never guess -- it
  decides whose credits are spent.

## 4. Confirm

```bash
higgsfield account status
```

Report in two or three lines: the account before and after (email, plan, credits), and that the
panel's workers now generate on the new one. If the account did not change, say plainly that
Chrome handed back the same account and that he needs to sign into the other one in Chrome, then
run this again.

If the account changed, add that the panel's spend ceiling (`costCeilingCredits` in
`10_PANEL/worker/config.json`) still counts recent spend in the ledgers from the previous account
until it ages out of the window, and that the workers need no restart: they check the login before
every price and generation.

## Never

- Never read, print or store the token from `auth token`, or from anywhere else.
- Never run `generate create` here, or anything that spends.
- Never pick between several workspaces for the person.
