'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { suggestCode, suggestSlug } from '../worker/lib/ids.mjs'
import { newProject } from './project-actions'

/**
 * Start a film. Name it and everything else is filled in: the folder name and
 * the two-to-four letter code that every ID in the project begins with. Both
 * stay editable, because they show up in every filename from then on.
 */
export function NewProjectForm({ taken }: { taken: { slugs: string[]; codes: string[] } }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [code, setCode] = useState('')
  // Once either is typed in by hand, the name stops overwriting it.
  const [slugTouched, setSlugTouched] = useState(false)
  const [codeTouched, setCodeTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function onName(value: string) {
    setName(value)
    if (!slugTouched) setSlug(suggestSlug(value))
    if (!codeTouched) setCode(suggestCode(value, taken.codes))
  }

  function submit(formData: FormData) {
    setError(null)
    start(async () => {
      // A success redirects and never returns; only a problem comes back.
      const r = await newProject(formData)
      if (r && !r.ok) setError(r.error)
    })
  }

  if (!open) {
    return (
      <section className="mt-8">
        <Button type="button" tone="accent" onClick={() => setOpen(true)}>Start a new project</Button>
      </section>
    )
  }

  return (
    <section className="mt-8 rounded-xl border border-edge bg-panel p-6">
      <h2 className="font-display text-[22px] leading-none text-fg">Start a new project</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        It gets the same folders, rules and review loop as every other project — empty, and ready for
        its first reference.
      </p>

      <form action={submit} className="mt-6 space-y-5">
        <Field label="Name" hint="What you call the film. It can be in any language.">
          <Input name="name" value={name} onChange={(e) => onName(e.target.value)} autoFocus required maxLength={80} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Folder name" hint="Lowercase letters, digits and dashes. It is the folder on disk and the web address.">
            <Input
              name="slug"
              value={slug}
              onChange={(e) => { setSlugTouched(true); setSlug(e.target.value) }}
              required
              maxLength={40}
              pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
              className="font-mono"
            />
          </Field>
          <Field label="ID code" hint={`2 to 4 capital letters. Every ID starts with it: ${code || 'ABC'}-CHR-001-HERO.`}>
            <Input
              name="code"
              value={code}
              onChange={(e) => { setCodeTouched(true); setCode(e.target.value.toUpperCase()) }}
              required
              maxLength={4}
              pattern="[A-Z]{2,4}"
              className="font-mono uppercase"
            />
          </Field>
        </div>

        <Field label="What is it?" hint="One or two sentences. It goes to any AI you ask for prompts, so say the setting and the tone.">
          <Textarea name="description" maxLength={500} rows={3} />
        </Field>

        {error && <p className="text-[13px] text-bad">{error}</p>}

        <div className="flex gap-2">
          <Button type="submit" tone="accent" pending={pending} pendingLabel="Creating">Create project</Button>
          <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </form>
    </section>
  )
}
