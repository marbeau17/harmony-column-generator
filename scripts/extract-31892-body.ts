import * as fs from 'fs';

const raw = fs.readFileSync('/tmp/31892-log.json', 'utf-8');
// 連結 JSON を分割
const parts = raw.split(/\n---\n/);
console.log(`parts: ${parts.length}`);

for (const [i, p] of parts.entries()) {
  try {
    const obj = JSON.parse(p);
    console.log(`\n--- part ${i} ---`);
    console.log('  keys:', Object.keys(obj));
    if (obj.steps) {
      for (const [j, s] of (obj.steps as any[]).entries()) {
        console.log(`    step[${j}]: ${s.step} | success=${s.success} | rawOutput?=${typeof s.rawOutput} (${(s.rawOutput as string)?.length})`);
        if (s.step === 'writing' && s.rawOutput) {
          fs.writeFileSync('/tmp/31892-writing-raw.txt', s.rawOutput as string, 'utf-8');
          console.log('    → saved /tmp/31892-writing-raw.txt');
        }
      }
    }
  } catch (e) {
    console.log(`part ${i} parse error: ${(e as Error).message}, head=${p.slice(0,100)}`);
  }
}
