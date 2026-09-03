---
name: learn
description: Distil approved/denied review notes into scoped prompt rules for the Shahnameh project. Use when the user says "learn", "what have we learned", "distil the reviews", "update the learnings", or after a batch of accept/deny decisions in the review panel.
---

# Learn — turn review verdicts into prompt rules

Reads the review history, proposes durable rules, and puts them in front of Hamed for approval.
**Nothing you write here influences a generation until he approves it in the panel.** That gate
is the whole point: an auto-applied wrong rule silently poisons every later prompt.

Paths are relative to `D:\Digianzu\Shahnameh MODERN\Shahnameh CLI`.

---

## 1. Read the evidence

```powershell
Get-Content '00_PROJECT\review\REVIEW_LOG.jsonl'
Get-Content '00_PROJECT\review\LEARNINGS.jsonl'
Get-Content '00_PROJECT\queue\state.json'
```

Work only on decisions newer than `learnWatermark` in `state.json` (absent = start from the
beginning). Both verdicts matter:

- **denied** notes say what went wrong — the rule is the fix
- **accepted** notes say what went right — the rule is what to preserve

An accept with no note carries no signal. Don't invent one; count it and move on.

## 2. Cluster

Group decisions by what they actually have in common — the same entity, the same family, the
same kind, or a recurring tag. You are looking for a fault or a success that appeared **more
than once**, or once but so clearly stated it is obviously a standing requirement.

Resist turning every note into a rule. Three sharp rules beat twenty vague ones, and each one
you propose costs Hamed a decision.

## 3. Write rules

Append to `00_PROJECT/review/LEARNINGS.jsonl`, one JSON object per line:

```json
{"id":"L-0007",
 "scope":{"kind":"LOC","entity":"SHM-LOC-004-MOUNTAIN-PASS","family":null},
 "rule":"No modern road surfaces or tyre tracks; the road must read as a beaten dirt track.",
 "evidence":["rev_0031","rev_0044"],
 "status":"proposed",
 "created":"2026-09-03"}
```

- `id` — `L-` plus a zero-padded counter, never reused.
- `scope` — **the narrowest that fits.** Set `entity` for a rule about one thing, `family` for
  all staffs or all gates, `kind` for all locations, all three null for a project-wide rule.
  A Zahhak note leaking into a landscape prompt is worse than no rule at all.
- `rule` — imperative, concrete, and checkable by looking at an image. "Avoid modern elements"
  is unusable; "no tyre tracks, no asphalt, no painted road markings" is a rule.
- `evidence` — the `id`s of the decisions that justify it. The panel shows these to Hamed, so a
  rule with no evidence will and should be rejected.
- `status` — always `proposed`. **Never write `approved` yourself.**

Then advance `learnWatermark` in `state.json` to the newest decision id you consumed.

## 4. Hand off

Tell Hamed how many rules you proposed and what they cover, in two or three lines. Point him at
`http://localhost:3000/learnings` to approve, edit or reject each one.

Once approved, a rule flows to two places automatically:

- the worker injects it into matching revision prompts (`applicableLearnings` in
  `worker/worker.mjs`)
- `Build-ContextPack.ps1` ships it to Claude Chat and Cowork under "What we've learned"

So an approved rule improves prompts written on **every** surface, not just regenerations.

## 5. Log it

Finish with `/project-log`.

---

## Rules

- **Never set `status` to `approved`.** Only Hamed does that, in the panel.
- **Never delete or rewrite an existing learning.** The file is append-only and folded by `id`,
  last write wins — so a revision is a new line with the same `id`, not an edit.
- **Never propose a rule without evidence ids.**
- **Scope narrowly.** When unsure between `entity` and `family`, choose `entity`.
- If a proposed rule contradicts an already-approved one, say so explicitly in your summary and
  cite both — that is a real conflict for Hamed to resolve, not something to quietly reconcile.
