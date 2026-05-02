/**
 * P5-43 Step 1 マイグレーション適用 (本番 Supabase)
 *
 * supabase CLI が古くて使えないため、pg client で直接 DDL を流す。
 * 適用前に現在の CHECK 制約と visibility_state 分布を確認、
 * 適用後に新しい制約と分布を確認する。
 *
 * 使い方:
 *   tsx scripts/apply-migration-step1.ts          # dry-run (現状確認のみ)
 *   tsx scripts/apply-migration-step1.ts --apply  # 実行
 */
import * as fs from 'fs';
import { Client } from 'pg';

const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const APPLY = process.argv.includes('--apply');

async function main() {
  const poolerUrl = fs.readFileSync('supabase/.temp/pooler-url', 'utf-8').trim();
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (!dbPassword) {
    console.error('ERROR: SUPABASE_DB_PASSWORD が .env.local に必要');
    process.exit(1);
  }
  // pooler-url は postgres://postgres.PROJECT@... の形式 (パスワードなし)
  // パスワードを inject
  const url = poolerUrl.replace(
    /postgres:\/\/([^@]+)@/,
    `postgres://$1:${encodeURIComponent(dbPassword)}@`,
  );

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    console.log('=== 適用前: visibility_state CHECK 制約 ===');
    const before = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'articles'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%visibility_state%';
    `);
    for (const row of before.rows) {
      console.log(`  ${row.conname}: ${row.def}`);
    }

    console.log('\n=== 適用前: visibility_state 分布 ===');
    const dist = await client.query(`
      SELECT visibility_state, COUNT(*)::int AS n
      FROM articles
      GROUP BY visibility_state
      ORDER BY visibility_state NULLS FIRST;
    `);
    for (const row of dist.rows) {
      console.log(`  ${String(row.visibility_state ?? 'NULL').padEnd(20)} ${row.n}`);
    }

    if (!APPLY) {
      console.log('\n[dry-run] --apply で migration を実行します');
      return;
    }

    console.log('\n=== マイグレーション実行中... ===');
    const sql = fs.readFileSync(
      'supabase/migrations/20260503000000_publish_control_unification_step1.sql',
      'utf-8',
    );
    await client.query(sql);
    console.log('✅ ALTER TABLE 完了');

    console.log('\n=== 適用後: visibility_state CHECK 制約 ===');
    const after = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'articles'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%visibility_state%';
    `);
    for (const row of after.rows) {
      console.log(`  ${row.conname}: ${row.def}`);
    }

    // 新値が含まれていることを検証
    const def = after.rows[0]?.def ?? '';
    const hasDraft = def.includes("'draft'");
    const hasPending = def.includes("'pending_review'");
    if (hasDraft && hasPending) {
      console.log('\n✅ 新値 draft / pending_review が CHECK 制約に追加されました');
    } else {
      console.error('\n❌ 新値が見つかりません!');
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
