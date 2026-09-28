import { createClient } from '@supabase/supabase-js'

let storage: ReturnType<typeof createClient> | undefined
export async function uploadPdf(path: string, token: string, file: File) {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('Upload configuration unavailable')
  storage ??= createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  const { error } = await storage.storage
    .from('reviewer_upload')
    .uploadToSignedUrl(path, token, file, {
      contentType: 'application/pdf',
      metadata: { originalName: file.name },
    })
  if (error) throw error
}

export async function uploadAudio(path: string, token: string, blob: Blob) {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('Upload configuration unavailable')
  storage ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const { error } = await storage.storage.from('reviewer_audio').uploadToSignedUrl(path, token, blob, { contentType: blob.type })
  if (error) throw error
}
