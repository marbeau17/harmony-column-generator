// ============================================================================
// src/lib/validators/settings-ftp.ts
// settings.ftp 行 (key='ftp') の Zod スキーマ + 正規化ヘルパ
//
// P5-76 で発覚した「key drift」(DB が remoteBasePath を保存しているのに
// コードが remotePath を読み、デフォルトの /public_html/column/columns/ に
// フォールバックしてしまった事故) を構造的に防ぐためのスキーマ。
//
// 設計方針:
//  - canonical key は `remoteBasePath` 一本に統一する。
//  - レガシー UI は `remotePath` キーで保存しているため、その存在を
//    `normalizeFtpSettings` で吸収する (今は撤去せず残す。UI 側移行後に削除)。
//  - `.strict()` で未知キーを拒否し、将来の 3 つ目の key drift を即時に
//    "loud failure" として検出する。
// ============================================================================

import { z } from 'zod';

export const settingsFtpSchema = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535).default(21),
    user: z.string().min(1),
    password: z.string().min(1),
    secure: z.boolean().default(false),
    // canonical key: remoteBasePath. Legacy `remotePath` accepted via preprocess.
    remoteBasePath: z.string().regex(/^\/.*\/$/, 'must start and end with /'),
  })
  .strict();

export type SettingsFtp = z.infer<typeof settingsFtpSchema>;

/**
 * DB row may have legacy `remotePath` instead of `remoteBasePath`. Normalize.
 *
 * - 旧 UI が保存したレコードは `remotePath` を持つ。
 * - 新 schema は `remoteBasePath` を要求するため、ここでキーを差し替える。
 * - 両キーが同時に存在するレコードはありえないが、その場合は
 *   canonical な `remoteBasePath` を優先する (= legacy 側を捨てる)。
 */
export function normalizeFtpSettings(raw: unknown): SettingsFtp {
  if (
    raw &&
    typeof raw === 'object' &&
    !('remoteBasePath' in raw) &&
    'remotePath' in raw
  ) {
    const r = { ...(raw as Record<string, unknown>) };
    r.remoteBasePath = (r as { remotePath: unknown }).remotePath;
    delete (r as { remotePath?: unknown }).remotePath;
    return settingsFtpSchema.parse(r);
  }
  return settingsFtpSchema.parse(raw);
}
