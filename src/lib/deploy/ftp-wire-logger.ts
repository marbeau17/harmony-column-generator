// ============================================================================
// src/lib/deploy/ftp-wire-logger.ts
// basic-ftp Client の wire-level (FTP プロトコル) トランザクションを
// logger 経由で出力するヘルパー。
//
// 背景 (P5-77):
//   FTP put が silent fail する事象が頻発。アプリ側で per-call の attempt/ok
//   ログは敷設済 (P5-75) だが、FTP プロトコル層 (USER, PASS, PASV, STOR,
//   サーバ応答コード, データチャネル状態) が見えないため、どこで詰まったか /
//   どんなレスポンスを受けたかが分からない。
//
//   basic-ftp は client.ftp.verbose = true で全コマンド/応答を log 関数に流す。
//   デフォルトの log 関数は console.log で stdout 直書きされ Vercel runtime
//   log にも入るが、構造化されておらず JSON 検索もしづらい。
//   本ヘルパーは log 関数を override し logger.info('ftp', 'ftp_wire', ...) で
//   構造化ログ化する。
//
// 使い方:
//   const client = new Client(60000);
//   attachFtpWireLogger(client, { where: 'bulk_deploy', article_id, slug });
//   await client.access({ ... });
//
//   ↓ Vercel log
//   {"timestamp":"...","level":"INFO","category":"ftp","action":"ftp_wire",
//    "details":{"where":"bulk_deploy","article_id":"...","msg":"> USER ..."}}
//   {"timestamp":"...","level":"INFO","category":"ftp","action":"ftp_wire",
//    "details":{"where":"bulk_deploy","article_id":"...","msg":"< 331 User ..."}}
// ============================================================================

import type { Client } from 'basic-ftp';
import { logger } from '@/lib/logger';

export interface FtpWireLoggerContext {
  /** ログ出力源を識別するラベル (e.g. 'bulk_deploy', 'article_deploy', 'hub_deploy', 'ftp_uploader', 'ftp_test') */
  where: string;
  /** 任意の追加コンテキスト */
  article_id?: string;
  slug?: string;
  request_id?: string;
}

/**
 * basic-ftp Client に wire-level transaction logger を取り付ける。
 *
 * - client.ftp.verbose を true に設定
 * - client.ftp.log を override し logger.info で構造化出力
 * - パスワード行は ***** にマスクして漏洩防止 (PASS コマンドの引数を消す)
 */
export function attachFtpWireLogger(
  client: Client,
  context: FtpWireLoggerContext,
): void {
  client.ftp.verbose = true;
  client.ftp.log = (msg: string) => {
    // PASS コマンドの平文パスワード漏洩を防ぐ
    const safe = /^>\s*PASS\s+/.test(msg) ? '> PASS *****' : msg;
    logger.info('ftp', 'ftp_wire', {
      where: context.where,
      article_id: context.article_id,
      slug: context.slug,
      request_id: context.request_id,
      msg: safe,
    });
  };
  logger.info('ftp', 'ftp_wire.attached', {
    where: context.where,
    article_id: context.article_id,
    slug: context.slug,
  });
}
