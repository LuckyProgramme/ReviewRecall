import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

function isServerKey(key: string) {
  if (key.startsWith('sb_secret_')) return true
  try {
    const payload = key.split('.')[1]
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role === 'service_role'
  } catch {
    return false
  }
}

export default defineConfig(({ mode }) => {
  const key = loadEnv(mode, process.cwd()).VITE_SUPABASE_PUBLISHABLE_KEY
  if (key && isServerKey(key)) {
    throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY must be a browser-safe publishable key')
  }
  return { plugins: [react(), tailwindcss()] }
})
