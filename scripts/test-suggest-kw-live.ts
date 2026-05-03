import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { buildPersonaCandidates, buildAiSuggestionPrompt, normalizeAiCandidates } from '../src/lib/ai/prompts/keyword-suggestions';
import { generateJson } from '../src/lib/ai/gemini-client';

(async () => {
  console.log('=== Suggest Keywords Live Test ===');
  const theme = { name: 'ヒーリングと癒し', category: 'spiritual_intro' };
  const persona = {
    name: '彩花', age_range: '20-29',
    description: '20代女性。SNSでスピリチュアル系をフォロー。',
    search_patterns: ['タロット', 'オラクルカード'],
    tone_guide: '明るくポップ、共感を重視',
  };
  const intent = 'info' as const;
  const exclude: string[] = [];

  // 1. persona-based
  const personaCands = buildPersonaCandidates({ theme, persona, intent });
  console.log('\n[Persona Candidates]', personaCands.length);
  for (const c of personaCands) console.log(' -', c.keyword, '|', c.rationale, '|', c.score.toFixed(2));

  // 2. AI suggestion via Gemini
  const { system, user } = buildAiSuggestionPrompt({ theme, persona, intent, exclude });
  console.log('\n[Calling Gemini]');
  const t0 = Date.now();
  try {
    const { data } = await generateJson<unknown>(system, user, {
      temperature: 0.6, topP: 0.9, maxOutputTokens: 2000,
    });
    const aiCands = normalizeAiCandidates(data);
    console.log(`AI returned ${aiCands.length} candidates in ${Date.now()-t0}ms`);
    for (const c of aiCands) console.log(' -', c.keyword, '|', c.rationale);
  } catch (e) {
    console.error('AI FAILED:', (e as Error).message);
  }
})();
