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
    .uploadToSignedUrl(path, token, file, { contentType: 'application/pdf' })
  if (error) throw error
}
