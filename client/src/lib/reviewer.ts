import { request, ResponseError } from './api'

export type UploadedReviewer = {
  path: string
  name: string
  size: number | null
  uploadedAt: string | null
}

export async function loadReviewerUploads(guestId: string): Promise<UploadedReviewer[]> {
  const response = await request(
    `/api/sessions/${encodeURIComponent(guestId)}/uploads`,
    { headers: { 'X-Guest-Id': guestId } },
  )
  if (!Array.isArray(response.uploads))
    throw new ResponseError('Invalid uploaded reviewers response')

  return response.uploads.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new ResponseError('Invalid uploaded reviewer')
    const { path, name, size, uploaded_at } = item as Record<string, unknown>
    if (
      typeof path !== 'string' ||
      !path.startsWith(`${guestId}/`) ||
      typeof name !== 'string' ||
      !name ||
      (size !== null && (typeof size !== 'number' || !Number.isFinite(size) || size < 0)) ||
      (uploaded_at !== null && typeof uploaded_at !== 'string')
    ) throw new ResponseError('Invalid uploaded reviewer')
    return { path, name, size, uploadedAt: uploaded_at }
  })
}
