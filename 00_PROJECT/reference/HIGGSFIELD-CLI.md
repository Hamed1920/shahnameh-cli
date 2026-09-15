# Higgsfield CLI — captured surface

`@higgsfield/cli` **1.1.24** (build `74e091a`, 2026-08-29). Captured from `--help` on this
machine 2026-09-03. **This file, not documentation or memory, is what the worker is written
against.** Re-capture after any CLI upgrade.

Binaries: `higgsfield`, `higgs`, `hf` (all aliases of the same command).

## Global flags

```
--json       print raw JSON responses      <- always use this from the worker
--no-color   disable color output
```

## Commands

```
account            Credits and transactions
auth               Login, logout, token
generate           Create, cost, list, wait jobs
marketing-studio   Marketing Studio assets
marketplace-cards  Marketplace product cards
model              List models and params
preset             Browse and resolve generation presets
product-photoshoot Brand-quality image generation
soul-id            Train and manage Soul refs
upload             Upload media and document inputs
voices             List voices for TTS / voice-change
website            Build and ship full-stack websites
workflow           List workflows and inspect params
workspace          Select billing workspace
```

## Auth — interactive, OAuth 2.0 PKCE

```
higgsfield auth login     # opens a browser; Hamed must complete this
higgsfield auth token     # prints token; errors "Not authenticated." if not logged in
higgsfield auth logout
```

There is **no `auth status`**. Probe auth with `auth token` and check the exit code.

## Workspace — required after login

`account status` fails with `No workspace selected.` until a workspace is chosen. This is a
second setup step that is easy to miss:

```
higgsfield workspace list
higgsfield workspace set <workspace_id>
higgsfield workspace status
higgsfield workspace unset          # back to private account context
```

## Generation

```
higgsfield generate create <job_type> [--param value]...
higgsfield generate cost   <job_type> [--param value]...      # credits, creates nothing
higgsfield generate get    <id> --json
higgsfield generate list   --json
higgsfield generate wait   <id> [--timeout 20m] [--interval 5s] [--quiet]
higgsfield generate workflow <workflow_name> [--param value]...
```

Params are passed as `--name value`. Accepted params are **per model** — inspect with
`higgsfield model get <job_type>`.

### Media flags

```
--image-references   (alias --image)
--video-references   (alias --video)
--audio-references   (alias --audio)
--start-image
--end-image
```

**Media flags accept a UUID (upload id or job id) *or* a local file path — paths are
auto-uploaded.** This is the single most important detail for the worker: reference images
resolved by `Resolve-ShmRef` can be passed straight through as file paths. No separate
`upload create` step is needed.

### Waiting

`generate create` returns immediately with a job ID unless `--wait` is passed. On `create`,
the wait flags are `--wait --wait-timeout <d> --wait-interval <d>`; on the standalone
`generate wait` subcommand they are `--timeout` / `--interval`. **The flag names differ between
the two — do not copy one to the other.**

Defaults: timeout `10m`, interval `3s`.

### Output

There is **no `--output` / `-o` flag.** Completed jobs expose a `result_url`; the asset lives in
Higgsfield Assets. Downloading into the project is the worker's job.

## Models

```
higgsfield model list [--image|--video] [--json]
higgsfield model get <job_type>              # params, defaults, enums
```

Known job types seen in examples: `nano_banana_2`, `seedance_2_0`.
Run `model list --json` once authenticated and record the real catalogue here.

### `seedance_2_5` (captured with `model get seedance_2_5 --json`, 2026-09-15)

Params: `aspect_ratio` (auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16; default 16:9), `audio_references`
(array), `bitrate_mode` (standard | high), `duration` (integer, default 5), `start_image`,
`end_image`, `extension_mode` (backward | forward, video_extension only), **`generate_audio`
(boolean, default `true`)**, `image_references` (array), `mode` (t2v | omni_reference |
video_edit | video_extension; t2v accepts no reference media, omni_reference needs at least one),
`prompt` (required), `resolution` (480p | 720p | 1080p; default 720p), `video_references`.

The worker passes `--generate-audio true|false` on every video job (`videoSound` in
`worker/config.json`, overridden per job or per decision from the panel).

### How the web panel writes references into a prompt (captured from `generate list --json`, 2026-09-15)

When you type `@` in the Higgsfield panel and pick an attached image, the stored `params.prompt`
carries an inline token `<<<image_N>>>`, N being the 1-based position in `params.medias`. A saved
Element (the panel's "@ Elements") is written `<<<element-uuid>>>` and listed in
`params.reference_elements`. **The CLI rejects `reference_elements`** ("Unknown params"), so the
worker attaches images with `--image-references` and writes `<<<image_N>>>` tokens itself
(`worker/lib/prompt.mjs`). It never writes `@Image1` prose or a list of images at the end: the
panel does not do that, and a job re-used from the panel would show it as stray text.

## Account / cost control

```
higgsfield account status          # email, plan, available credits
higgsfield account transactions --size 50
```

`generate cost` is the pre-flight spend check. The worker calls it before every `create` and
refuses to proceed past the configured ceiling.

## Companion skills

Installed with `npx skills add higgsfield-ai/skills` into `.agents/skills/`, symlinked into
`.claude/skills/`. Eight skills: `higgsfield-generate`, `-brandkit`, `-marketplace-cards`,
`-product-photoshoot`, `-soul-id`, `-video-explainer`, `-websites`, `-youtube-thumbnail`.

`.agents/` and `skills-lock.json` are **not committed** — reinstall with the command above.

> The installer's third-party scanners flagged `marketplace-cards`, `product-photoshoot`,
> `websites` and `youtube-thumbnail` as "High Risk", and Snyk rated all eight "Critical Risk".
> These look like blanket ratings for skills that run shell commands with full agent
> permissions. Only `higgsfield-generate` is needed for this project; the rest can be removed
> from `.claude/skills/` if you want the surface smaller.

## Not yet verified

Everything below the auth line is unverified against a live account — `auth login` has not been
completed. Once it is, run `model list --json`, one `generate cost`, and one `generate create`,
then update this file with the real JSON response shape (field names for job id, status and
`result_url`).
