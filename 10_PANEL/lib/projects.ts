import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { codeProblem, slugProblem } from '../worker/lib/ids.mjs'
import { projectPaths, type ProjectPaths } from './paths.ts'

/**
 * The projects this panel can open: every folder under projects/ that holds a
 * project.json. Each one is a whole film -- its own registries, queue, outputs
 * and learnings -- run by the same system.
 *
 * Server-only. A slug always comes from a URL or a form field, so it is
 * validated here before it is ever joined onto a path.
 */

export interface ProjectInfo {
  /** Folder name under projects/, and the first URL segment. */
  slug: string
  name: string
  /** The ID prefix, e.g. SHM in SHM-CHR-001-ZAHHAK. */
  code: string
  description: string
  /** One or two characters for the sidebar badge. */
  mark: string
  created: string
}

export interface Project extends ProjectInfo {
  root: string
  P: ProjectPaths
}

/**
 * The folder the projects sit in: the repo root, beside 10_PANEL, tools, docs
 * and templates. A folder there is a project because it holds a project.json,
 * so nothing has to be registered anywhere. SHM_PROJECTS overrides it (a sandbox copy).
 */
export function projectsDir(): string {
  return process.env.SHM_PROJECTS
    ? path.resolve(process.env.SHM_PROJECTS)
    : path.resolve(process.cwd(), '..')
}

/** What a browser may see about a project: no disk paths. */
export function publicInfo(p: Project): ProjectInfo {
  return { slug: p.slug, name: p.name, code: p.code, description: p.description, mark: p.mark, created: p.created }
}

/** First letter of the name, for a project without its own mark. */
export function defaultMark(name: string): string {
  return Array.from(String(name ?? '').trim())[0]?.toUpperCase() ?? '?'
}

function load(slug: string): Project | null {
  if (slugProblem(slug)) return null
  const dir = projectsDir()
  const root = path.join(dir, slug)
  let json: Record<string, unknown>
  try {
    // A junction inside projects/ pointing elsewhere is not a project of this panel.
    const real = fs.realpathSync(root)
    const realDir = fs.realpathSync(dir)
    if (!real.startsWith(realDir + path.sep)) return null
    json = JSON.parse(fs.readFileSync(path.join(root, 'project.json'), 'utf8'))
  } catch {
    return null
  }
  const code = String(json.code ?? '')
  if (json.slug !== slug || codeProblem(code)) return null
  const name = String(json.name ?? '').trim() || slug
  return {
    slug,
    name,
    code,
    description: String(json.description ?? ''),
    mark: String(json.mark ?? '').trim() || defaultMark(name),
    created: String(json.created ?? ''),
    root,
    P: projectPaths(root),
  }
}

/** Every valid project, by name. Folders that are not projects are skipped, not reported. */
export async function listProjects(): Promise<Project[]> {
  let entries: fs.Dirent[] = []
  try {
    entries = await fsp.readdir(projectsDir(), { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => load(e.name))
    .filter((p): p is Project => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The project for a URL segment or form field, or null when there is none by that name. */
export async function getProject(slug: unknown): Promise<Project | null> {
  return typeof slug === 'string' ? load(slug) : null
}

/** A request named a project that does not exist. Only a stale tab or a crafted request gets here. */
export class UnknownProject extends Error {
  constructor(slug: unknown) {
    super(`There is no project called "${String(slug)}". Go back to the project list.`)
  }
}

/** For server actions and route handlers: the project, or throw. */
export async function requireProject(slug: unknown): Promise<Project> {
  const p = await getProject(slug)
  if (!p) throw new UnknownProject(slug)
  return p
}
