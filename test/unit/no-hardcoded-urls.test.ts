import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * P5-44 cleanup 後 regression テスト。
 *
 * 公開 URL は `src/lib/config/public-urls.ts` を単一ソースとして env 駆動に
 * 統一されたため、src/ 配下に旧 URL パターンや拡張子・複数形バグの痕跡が
 * 残っていないことを担保する。
 *
 * 検出パターン:
 *   - "https://harmony-mc.com/column/"  : 旧ハブ URL (現行は /spiritual/column/)
 *   - "'/columns/"                       : columns 複数形バグ
 *   - "/column/${...}.html"              : 旧 .html 拡張子付き記事 URL
 *
 * 例外 (skip):
 *   - src/lib/config/public-urls.ts (default 値の所在地)
 *   - templates/ 配下 (静的テンプレート — そもそも src/ 配下に無いが念のため)
 *   - .test.ts / .test.tsx (テスト自身が pattern 文字列を含む)
 *
 * 許容パターン:
 *   - "harmony-mc.com/counseling" 系 CTA リンク (旧 column と無関係)
 *   - "harmony-booking.web.app"
 */

const PROJECT_ROOT = join(__dirname, '..', '..');
const SRC_DIR = join(PROJECT_ROOT, 'src');

/** 例外ファイル (リポジトリルートからの相対パス、POSIX 区切り) */
const EXEMPT_FILES = new Set<string>([
  'src/lib/config/public-urls.ts',
  // AI prompt text — URL は LLM への文脈説明であり生成 URL ではない
  'src/lib/ai/prompts/keyword-suggestions.ts',
]);

/** 例外ディレクトリ prefix (POSIX 区切り) */
const EXEMPT_DIR_PREFIXES: readonly string[] = [
  'templates/',
  // AI prompt directory: URL は LLM への文脈説明 (生成 URL ではない)
  'src/lib/ai/prompts/',
];

interface PatternRule {
  readonly id: string;
  readonly description: string;
  readonly matcher: (line: string) => boolean;
}

const RULES: readonly PatternRule[] = [
  {
    id: 'old-hub-url',
    description: 'https://harmony-mc.com/column/ (旧ハブ URL — /spiritual/column/ へ移行済み)',
    matcher: (line) => line.includes('https://harmony-mc.com/column/'),
  },
  {
    id: 'plural-columns',
    description: "'/columns/ (複数形バグ — 正しくは /column/)",
    matcher: (line) => line.includes("'/columns/") || line.includes('"/columns/'),
  },
  {
    id: 'legacy-html-ext',
    description: '/column/${...}.html (旧 .html 拡張子付き記事 URL)',
    // 例: `/column/${slug}.html` や `/column/${article.slug}.html` を検出。
    matcher: (line) => /\/column\/\$\{[^}]+\}\.html/.test(line),
  },
];

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, acc);
    } else if (st.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) {
      acc.push(full);
    }
  }
  return acc;
}

function toPosixRel(absPath: string): string {
  return relative(PROJECT_ROOT, absPath).split(sep).join('/');
}

function isExempt(relPosix: string): boolean {
  if (EXEMPT_FILES.has(relPosix)) return true;
  if (EXEMPT_DIR_PREFIXES.some((p) => relPosix.startsWith(p))) return true;
  // テストファイル自身が pattern 文字列を含むので除外
  if (relPosix.endsWith('.test.ts') || relPosix.endsWith('.test.tsx')) return true;
  return false;
}

interface Violation {
  file: string;
  line: number;
  ruleId: string;
  description: string;
  snippet: string;
}

function scan(): Violation[] {
  const violations: Violation[] = [];
  const files = walk(SRC_DIR);
  for (const abs of files) {
    const rel = toPosixRel(abs);
    if (isExempt(rel)) continue;
    const content = readFileSync(abs, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const rule of RULES) {
        if (rule.matcher(line)) {
          violations.push({
            file: rel,
            line: i + 1,
            ruleId: rule.id,
            description: rule.description,
            snippet: line.trim().slice(0, 200),
          });
        }
      }
    }
  }
  return violations;
}

describe('P5-44 regression: src/ 配下に旧 URL ハードコードが残っていないこと', () => {
  it('禁止パターンが検出されないこと', () => {
    const violations = scan();
    if (violations.length > 0) {
      const report = violations
        .map(
          (v) =>
            `  - [${v.ruleId}] ${v.file}:${v.line}\n      ${v.description}\n      > ${v.snippet}`,
        )
        .join('\n');
      throw new Error(
        `禁止された URL ハードコードを ${violations.length} 箇所検出しました。\n` +
          `公開 URL は src/lib/config/public-urls.ts のヘルパ経由で生成してください。\n\n${report}`,
      );
    }
    expect(violations).toEqual([]);
  });
});
