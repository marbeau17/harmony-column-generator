// CLI 経由で persistToneScore が動くか smoke test (バグF 修正検証)
import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { persistToneScore } from '../src/lib/tone/persist-tone';

(async () => {
  console.log('=== persistToneScore CLI smoke test (バグF) ===');
  const articleId = '31892969-8215-42c2-8ad7-07135edf2766';
  const fakeResult = {
    tone: {
      total: 0.757,
      passed: false,
      blockers: [],
      breakdown: { perspectiveShift: { score: 0.67, passed: true } } as never,
    },
    centroidSimilarity: 0,
    passed: false,
  };
  try {
    await persistToneScore(articleId, fakeResult as never);
    console.log('OK: persistToneScore from CLI succeeded (bug F fixed)');
    process.exit(0);
  } catch (e) {
    console.error('FAIL:', (e as Error).message);
    process.exit(1);
  }
})();
