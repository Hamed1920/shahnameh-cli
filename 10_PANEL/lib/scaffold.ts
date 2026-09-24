import fs from 'node:fs/promises'
import path from 'node:path'
import { codeProblem, slugProblem, suggestCode, suggestSlug } from '../worker/lib/ids.mjs'
import { listProjects, projectsDir, type Project } from './projects.ts'

/**
 * Starting a new film from the panel: copy templates/project, fill in the name
 * and code, and hand it to the supervisor, which starts its worker within a
 * few seconds.
 *
 * This is the one place the panel creates a project's registries. It never
 * edits one -- CREATING the empty CSVs is not writing to them, and the worker
 * (which is the only writer) cannot do it, because a project with no folder has
 * no worker yet. Everything after this goes through the worker as usual.
 */

export { suggestCode, suggestSlug }

export interface NewProject {
  name: string
  slug: string
  code: string
  description: string
  /** One or two characters for the badge. Empty means "derive it from the name". */
  mark: string
}

/** A problem the person can fix, shown on the form. */
export class ProjectInvalid extends Error {}

function templateDir(): string {
  return path.resolve(process.cwd(), '..', 'templates', 'project')
}

const fill = (text: string, v: NewProject, created: string) =>
  text
    .replaceAll('{{NAME}}', v.name)
    .replaceAll('{{CODE}}', v.code)
    .replaceAll('{{DESCRIPTION}}', v.description || 'No description yet.')
    .replaceAll('{{CREATED}}', created)

const TEXT_EXT = new Set(['.md', '.csv', '.jsonl', '.json', '.txt'])

async function copyTree(from: string, to: string, v: NewProject, created: string): Promise<void> {
  await fs.mkdir(to, { recursive: true })
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, e.name)
    const dest = path.join(to, e.name)
    if (e.isDirectory()) {
      await copyTree(src, dest, v, created)
    } else if (TEXT_EXT.has(path.extname(e.name).toLowerCase())) {
      // No BOM: PowerShell 5.1 reads these too, and Node refuses to parse a BOM'd JSON.
      await fs.writeFile(dest, fill(await fs.readFile(src, 'utf8'), v, created), 'utf8')
    } else {
      await fs.copyFile(src, dest)
    }
  }
}

/**
 * Check a proposed project against the ones that exist. Returns the cleaned
 * values, or throws ProjectInvalid with something the form can show.
 */
export async function checkNew(input: Partial<NewProject>): Promise<NewProject> {
  const name = String(input.name ?? '').trim().slice(0, 80)
  if (!name) throw new ProjectInvalid('Give the project a name.')

  const slug = String(input.slug ?? '').trim().toLowerCase()
  const slugWhy = slugProblem(slug)
  if (slugWhy) throw new ProjectInvalid(slugWhy)

  const code = String(input.code ?? '').trim().toUpperCase()
  const codeWhy = codeProblem(code)
  if (codeWhy) throw new ProjectInvalid(codeWhy)

  const existing = await listProjects()
  if (existing.some((p) => p.slug === slug)) throw new ProjectInvalid(`There is already a project in the folder "${slug}".`)
  const clash = existing.find((p) => p.code === code)
  if (clash) throw new ProjectInvalid(`${clash.name} already uses the code ${code}. Every project needs its own, so IDs never collide.`)
  // A folder that is not a project -- typically what is left of a deleted one.
  // Without this the rename below fails with a bare EPERM on Windows.
  if (await fs.stat(path.join(projectsDir(), slug)).then(() => true, () => false)) {
    throw new ProjectInvalid(`There is already a folder called "${slug}" that is not a project, probably left from a deleted one. Remove it, or change the folder name.`)
  }

  // Two graphemes, not two code units: a Persian letter must survive intact.
  const mark = Array.from(String(input.mark ?? '').trim()).slice(0, 2).join('')

  return { name, slug, code, description: String(input.description ?? '').trim().slice(0, 500), mark }
}

/**
 * Build the project in a temporary folder and move it into place, so a failure
 * half way leaves nothing behind that looks like a project. The temporary name
 * starts with a dot, which the panel skips and .gitignore keeps out.
 */
export async function createProject(input: Partial<NewProject>): Promise<Project> {
  const v = await checkNew(input)
  const dir = projectsDir()
  const created = new Date().toISOString().slice(0, 10)
  const staging = path.join(dir, `.new-${v.slug}-${Math.random().toString(36).slice(2, 8)}`)

  try {
    await copyTree(templateDir(), staging, v, created)
    // mark is left out unless it was chosen: projects.ts derives it from the name otherwise.
    const project = {
      schema: 1, name: v.name, slug: v.slug, code: v.code, description: v.description,
      ...(v.mark ? { mark: v.mark } : {}), created,
    }
    await fs.writeFile(path.join(staging, 'project.json'), JSON.stringify(project, null, 2) + '\n', 'utf8')
    await rename(staging, path.join(dir, v.slug))
    await allowInGit(dir, v.slug)
  } catch (e) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    if (e instanceof ProjectInvalid) throw e
    throw new ProjectInvalid(`Could not create the project: ${(e as Error).message}`)
  }

  const made = (await listProjects()).find((p) => p.slug === v.slug)
  if (!made) throw new ProjectInvalid('The project folder was created but cannot be read back.')
  return made
}

/**
 * Add the new project to .gitignore's allowlist, under the "projects" heading.
 *
 * The repo's .gitignore ignores every top-level folder and re-includes the
 * known ones by name (it is an allowlist on purpose, so a stray folder stays
 * out). A project created here would be invisible to git otherwise, and the
 * person who made it has no reason to know that. Skipped silently when there
 * is no .gitignore -- a sandbox copy has none, and it is not worth failing a
 * project over.
 */
async function allowInGit(dir: string, slug: string): Promise<void> {
  const file = path.join(dir, '.gitignore')
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    return
  }
  const line = `!/${slug}/`
  if (text.split(/\r?\n/).some((l) => l.trim() === line)) return
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  // Last line of the projects block: the marker comment sits just below it.
  const marker = `${eol}${eol}# The half-built folder`
  const at = text.indexOf(marker)
  const updated = at === -1
    ? `${text.replace(/\s*$/, '')}${eol}${line}${eol}`
    : `${text.slice(0, at)}${eol}${line}${text.slice(at)}`
  await fs.writeFile(file, updated, 'utf8')
}

/** Windows holds a fresh folder open for a moment (indexer, antivirus); retry as replaceFile does. */
async function rename(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(String(code)) || attempt >= 20) throw e
      await new Promise((r) => setTimeout(r, Math.min(40 * attempt, 400)))
    }
  }
}
