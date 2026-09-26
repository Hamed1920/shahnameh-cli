import { decide } from '../../actions'

/**
 * A Review decision sent with navigator.sendBeacon as the page closes or reloads
 * inside its Undo window (review/review-workspace.tsx). A beacon can only POST to
 * a URL, not call a Server Action, so this hands the same form to the same action.
 * `decide` checks the project and the candidate itself, and a candidate already
 * decided is a no-op, so a decision that also went through the normal way is not
 * recorded twice.
 */
export async function POST(request: Request) {
  const form = await request.formData()
  const r = await decide(null, form)
  return Response.json(r, { status: r.ok ? 200 : 400 })
}
