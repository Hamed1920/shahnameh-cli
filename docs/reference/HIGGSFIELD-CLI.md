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

The catalogue is no longer recorded here by hand. The worker fetches it
(`10_PANEL/worker/lib/models.mjs`) into `10_PANEL/worker/MODEL_CATALOG.json`: every image and
video model from `model list --json`, each with its `model get --json` params and rules,
condensed by `summarizeModel` in `worker/lib/model-schema.mjs`. It refreshes once a day at worker
start, or from the Prompts page's Refresh. A sandbox worker on the stub CLI writes its own copy
beside the sandbox instead.

What the catalogue showed on 2026-09-24 (68 image/video models, 47 usable from a prompt):

- **`model list` gives each model a `type`**: image, video, audio, 3d, data, text. The worker
  decides image vs video from it, not from the name.
- **References differ per model.** Seedance, Nano Banana, Seedream, GPT Image, Wan 3 take
  `image_references` (Nano Banana Pro up to 14, Seedance 2.5 up to 30, Seedance 2.0 up to 9).
  Kling, Veo, Wan 2.7, Hailuo take only `start_image` (and some `end_image`). Veo 3 *requires*
  one. The limits come from each model's CEL `rules`.
- **Sound differs too**: `generate_audio` (boolean) on Seedance, Wan 3, Veo 3.1 Lite; `sound`
  `on|off` on Kling 3.0; `sound` boolean on Kling 2.6; none elsewhere.
- **`mode` on Seedance 2.5** is `t2v | omni_reference | ...`; references need `omni_reference`.
  Gemini Omni Flash 1.1 requires `text-to-video` / `reference-to-video`. The worker sets these.
- **Tools** (upscalers, background removers, relight, outpaint, video edit) are in the list but
  take no prompt or need a video; the catalogue marks them unusable and the pickers hide them.
- Only models with a `resolution` enum get a draft/final pair; Kling 3.0 and Veo render once.

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

### Saved Elements: what a named reference is (captured from `generate list --video --size 100 --json`, 2026-09-17)

Why Reuse shows `@Zahhak-Y-snake` for some jobs and `@Image 2` for ours: only an Element carries a
name. The 2026-08-26 web-panel jobs ("Nothing Stays Dead", `seedance_2_0`) store each one in
`params.reference_elements` as a full object and write its id into the prompt:

```json
{ "id": "6032ed41-04ef-481c-96bc-4c132216cfbf", "name": "Zahhak-Y-snake", "category": "character",
  "description": null, "ip_detected": false, "video_medias": [],
  "medias": [{ "id": "3f76ec4f-...", "type": "media_input", "url": "https://d2ol7oe51mr4n9.cloudfront.net/...jpg",
               "width": 1376, "height": 768 }] }
```

```
Zahhak <<<6032ed41-04ef-481c-96bc-4c132216cfbf>>> is held in the monumental chair ...
Guard A <<<2625d0fd-9bcc-4132-99ab-53b6fa7b1219>>> holds the forked restraint staff
```

A job can mix both forms (`<<<uuid>>>` for Elements, `<<<image_N>>>` for plain attachments in
`params.medias`). Every worker-made job lists `reference_elements: []` and `medias` entries of type
`media_input`, the same type web-panel attachments use, so the list output alone does not explain
the warning marks Reuse shows on our thumbnails.

The CLI cannot create or attach Elements (`reference_elements` is rejected as an unknown param). Its
bundled SDK does call `GET/POST /developer/v2alpha/reference-elements` on
`https://fnf-api-gw.higgsfield.ai/fnf`, undocumented. That endpoint has **not** been probed yet: it
needs the login token from `higgsfield auth token` and Hamed's go-ahead. Named references from the
worker would mean creating one Element per look through that API and submitting generations
through the API instead of the CLI.

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
