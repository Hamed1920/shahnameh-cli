import { revalidatePath } from 'next/cache'

/**
 * Refresh every page of one project after a write.
 *
 * A decision moves a candidate off Review, onto Decided and maybe into the
 * Gallery, and changes the Queue badge in the sidebar, so the pages are
 * refreshed together rather than one at a time. Another project's pages are
 * left alone -- nothing that happens in one film changes another.
 */
export function revalidateProject(slug: string): void {
  revalidatePath(`/${slug}`, 'layout')
}
