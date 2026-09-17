'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { ProjectInvalid, createProject } from '@/lib/scaffold'

/**
 * Start a new film. The only write the panel makes outside a project: it
 * creates the folder and its empty registries (lib/scaffold.ts), and from then
 * on the worker owns them like any other project's.
 */
export async function newProject(formData: FormData): Promise<{ ok: false; error: string } | void> {
  let slug: string
  try {
    const made = await createProject({
      name: String(formData.get('name') ?? ''),
      slug: String(formData.get('slug') ?? ''),
      code: String(formData.get('code') ?? ''),
      description: String(formData.get('description') ?? ''),
      mark: String(formData.get('mark') ?? ''),
    })
    slug = made.slug
  } catch (e) {
    if (e instanceof ProjectInvalid) return { ok: false, error: e.message }
    throw e
  }
  revalidatePath('/')
  // Outside the try: redirect works by throwing, and must not be caught above.
  redirect(`/${slug}`)
}
