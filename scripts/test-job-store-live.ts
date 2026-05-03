import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { createJobState, updateJobState, getJobState, clearJobState } from '../src/lib/jobs/zero-gen-job-store';
import { randomUUID } from 'crypto';
(async () => {
  const id = randomUUID();
  console.log('test job_id:', id);
  console.log('\n1. createJobState');
  const created = await createJobState(id);
  console.log('  →', created);
  console.log('\n2. updateJobState (stage1)');
  const u1 = await updateJobState(id, { stage: 'stage1', progress: 0.2, eta_seconds: 70 });
  console.log('  →', u1);
  console.log('\n3. getJobState (cache hit?)');
  const g1 = await getJobState(id);
  console.log('  →', g1);
  console.log('\n4. updateJobState (done)');
  const u2 = await updateJobState(id, { stage: 'done', progress: 1, eta_seconds: 0, article_id: 'aaaa' });
  console.log('  →', u2);
  console.log('\n5. clearJobState');
  await clearJobState(id);
  const g2 = await getJobState(id);
  console.log('  → after clear:', g2);
  console.log('\n✓ all ok');
  process.exit(0);
})().catch((e) => { console.error('✗', e); process.exit(1); });
