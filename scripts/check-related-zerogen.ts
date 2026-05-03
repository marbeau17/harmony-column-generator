import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = fs.readFileSync('.env.local', 'utf-8')
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim()
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

;(async () => {
  const slugs = [
    'healing',
    'law-of-attraction-tired-quit',
    'chakra-purify-by-yourself',
    'law-of-attraction',
    'soul-mission-anxiety',
  ]
  const { data, error } = await sb
    .from('articles')
    .select('slug, generation_mode, status')
    .in('slug', slugs)
  if (error) { console.error(error); process.exit(1) }
  console.log(JSON.stringify(data, null, 2))
})()
