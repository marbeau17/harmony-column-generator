import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { generateEmbedding } from '../src/lib/ai/embedding-client';
(async () => {
  console.log('=== Embedding Live Test (gemini-embedding-001 / 768 dim) ===');
  const t0 = Date.now();
  try {
    const v = await generateEmbedding('泣いていい朝もある', 'RETRIEVAL_QUERY');
    console.log('OK | dim=', v.length, '| head=', v.slice(0,3), '| elapsed=', Date.now()-t0, 'ms');
    if (v.length !== 768) {
      console.error('UNEXPECTED dim:', v.length);
      process.exit(1);
    }
    process.exit(0);
  } catch (e) {
    console.error('FAIL:', (e as Error).message);
    process.exit(1);
  }
})();
