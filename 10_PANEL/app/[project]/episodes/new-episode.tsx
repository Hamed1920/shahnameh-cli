'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { MenuNote } from '@/components/item-menu'
import { useProject } from '@/components/project-context'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { Modal } from '@/components/ui/modal'
import { episodeTitleSlug, longEpisode, shortEpisode } from '@/lib/episodes'
import { startEpisode } from './actions'

/**
 * Start an episode before it holds anything.
 *
 * An episode is otherwise born the moment the worker files its first accepted
 * take, so one cannot be planned ahead. This asks the worker to make its
 * folder, and nothing else -- the number becomes real and can be prompted or
 * moved into.
 *
 * The number offered is the next in order; any number can be typed instead, and
 * a gap is fine. What is refused is one that is already an episode: a number is
 * never used twice (docs/INDEXING.md section 9).
 */
export function NewEpisode({ next, taken }: { next: string; taken: string[] }) {
  const project = useProject()
  const [open, setOpen] = useState(false)
  const [number, setNumber] = useState(shortEpisode(next))
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setNumber(shortEpisode(next)); setName(''); setError(null) }
  }, [open, next])

  const id = longEpisode(number)
  const clash = id ? taken.includes(id) : false
  const slug = episodeTitleSlug(name)
  const folder = id ? `${project.code}-${id}${slug ? `-${slug}` : ''}` : ''

  async function create() {
    if (!id) { setError('That is not an episode number. It looks like 2, or EP002.'); return }
    setBusy(true)
    const r = await startEpisode(project.slug, id, name).catch((e: Error) => ({ ok: false, error: e.message, episode: undefined }))
    setBusy(false)
    if (!r.ok) { setError(r.error ?? 'That did not save.'); return }
    setOpen(false)
    setNote(`Asked the worker to start ${shortEpisode(id)}. It makes the folder on its next pass.`)
    setTimeout(() => setNote(null), 3500)
  }

  return (
    <>
      <Button type="button" tone="accent" size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden className="size-3.5" /> Start an episode
      </Button>

      <Modal
        open={open}
        title="Start an episode"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button type="button" tone="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" tone="accent" pending={busy} disabled={!id || clash} onClick={create}>Start it</Button>
          </>
        }
      >
        <div className="space-y-5">
          <Field
            label="Number"
            hint={
              clash
                ? `${shortEpisode(id!)} already exists. Open it instead — a number is never used twice.`
                : id && id !== next
                  ? `${shortEpisode(next)} is the next one in order. ${shortEpisode(id)} leaves a gap, which is fine.`
                  : 'The next one in order. Any number can be typed instead.'
            }
          >
            <Input
              value={number}
              onChange={(e) => { setNumber(e.target.value); setError(null) }}
              placeholder={shortEpisode(next)}
              autoFocus
              aria-invalid={clash || (!!number.trim() && !id)}
            />
          </Field>

          <Field
            label="Name"
            hint={
              folder ? (
                <>
                  Optional. The folder becomes <code className="font-mono text-fg">{folder}</code>
                  {name.trim() && !slug ? ' — that name has no Latin letters, so only the number is used.' : '.'}
                </>
              ) : (
                'Optional.'
              )
            }
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Zahhak Entry" dir="auto" />
          </Field>

          {error && <p className="rounded-md border border-bad/35 bg-bad/8 px-3 py-2 text-xs text-bad">{error}</p>}
        </div>
      </Modal>

      {note && <MenuNote text={note} />}
    </>
  )
}
