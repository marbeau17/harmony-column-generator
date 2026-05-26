// ============================================================================
// src/lib/deploy/ftp-uploader.ts
// FTPアップローダー — basic-ftpを使用した静的ファイルアップロード
//
// 生成されたHTMLファイルやCSS/JSをFTPサーバーにアップロードする。
// ============================================================================

import { Client } from 'basic-ftp';
import { Readable } from 'stream';
import { logger } from '@/lib/logger';
import { normalizeFtpSettings } from '@/lib/validators/settings-ftp';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export interface FtpConfig {
  host: string;
  user: string;
  password: string;
  port?: number;
  secure?: boolean;
  remoteBasePath: string; // /public_html/column/columns/
}

export interface UploadFile {
  remotePath: string;  // index.html, page/2/index.html など（remoteBasePathからの相対）
  content: string;
}

export interface UploadResult {
  success: boolean;
  uploaded: number;
  errors: string[];
}

// ─── 環境変数からFTP設定を読み込み ──────────────────────────────────────────

/**
 * 環境変数からFTP接続設定を読み込む。
 * 必須: FTP_HOST, FTP_USER, FTP_PASSWORD
 * 任意: FTP_PORT (default 21), FTP_REMOTE_PATH (default /public_html/column/columns/)
 */
/**
 * FTP設定を取得。優先順位:
 * 1. DB settings テーブル（UIから設定）
 * 2. 環境変数（.env.local）
 */
export async function getFtpConfig(): Promise<FtpConfig> {
  const startedAt = Date.now();
  logger.info('deploy', 'ftp_uploader.get_ftp_config.start', {
    elapsed_ms: 0,
  });

  // まずDBから取得を試みる
  try {
    const tDb = Date.now();
    logger.info('deploy', 'ftp_uploader.get_ftp_config.db_fetch.start', {
      elapsed_ms: Date.now() - startedAt,
    });
    const { createServiceRoleClient } = await import('@/lib/supabase/server');
    const supabase = await createServiceRoleClient();
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'ftp')
      .maybeSingle();

    logger.info('deploy', 'ftp_uploader.get_ftp_config.db_fetch.end', {
      has_value: !!data?.value,
      elapsed_ms: Date.now() - tDb,
    });

    if (data?.value) {
      const rawDbValue =
        typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      // P5-76: DB row のキードリフトを Zod schema で構造的に弾く。
      //   旧 UI は `remotePath`、canonical は `remoteBasePath`。
      //   `normalizeFtpSettings` がレガシー key を吸収する。
      //   schema parse 失敗時は silent fallback ではなく throw する
      //   (silent path mismatch < loud failure, P5-76 の教訓)。
      let parsed: ReturnType<typeof normalizeFtpSettings>;
      try {
        parsed = normalizeFtpSettings(rawDbValue);
      } catch (parseErr) {
        logger.error(
          'deploy',
          'ftp_uploader.get_ftp_config.schema_parse_failed',
          {
            error_message:
              parseErr instanceof Error ? parseErr.message : String(parseErr),
            stack:
              parseErr instanceof Error
                ? parseErr.stack?.slice(0, 500)
                : undefined,
            // どんなキーが入っていたかを観測 (値は機微情報を含むので key のみ)
            raw_keys:
              rawDbValue && typeof rawDbValue === 'object'
                ? Object.keys(rawDbValue as Record<string, unknown>)
                : [],
            elapsed_ms: Date.now() - startedAt,
          },
          parseErr instanceof Error ? parseErr : undefined,
        );
        throw new Error(
          `settings.ftp の値がスキーマに違反しています: ${
            parseErr instanceof Error ? parseErr.message : String(parseErr)
          }`,
        );
      }

      // どちらのキーが DB に入っていたかを観測ログに残す (P5-76 の継続監視用)
      const remotePathKeyUsed =
        rawDbValue &&
        typeof rawDbValue === 'object' &&
        'remoteBasePath' in (rawDbValue as Record<string, unknown>)
          ? 'remoteBasePath'
          : rawDbValue &&
              typeof rawDbValue === 'object' &&
              'remotePath' in (rawDbValue as Record<string, unknown>)
            ? 'remotePath'
            : 'unknown';

      const config: FtpConfig = {
        host: parsed.host,
        user: parsed.user,
        password: parsed.password,
        port: parsed.port,
        secure: parsed.secure,
        remoteBasePath: parsed.remoteBasePath,
      };
      logger.info('deploy', 'ftp_uploader.get_ftp_config.end', {
        source: 'db',
        host: config.host,
        port: config.port,
        secure: config.secure,
        remote_base_path: config.remoteBasePath,
        remote_path_key_used: remotePathKeyUsed,
        elapsed_ms: Date.now() - startedAt,
      });
      return config;
    }
  } catch (e) {
    // schema parse 失敗は上で throw 済みなのでここには来ない。
    // ここに来るのは Supabase クエリ自体の失敗 (ネットワーク等) のみ。
    if (
      e instanceof Error &&
      e.message.startsWith('settings.ftp の値がスキーマに違反しています')
    ) {
      // schema 違反は loud failure として再 throw (env fallback させない)
      throw e;
    }
    logger.warn('deploy', 'ftp_uploader.get_ftp_config.db_fetch.failed', {
      error_message: (e as Error)?.message ?? String(e),
      stack: (e as Error)?.stack?.slice(0, 500),
      elapsed_ms: Date.now() - startedAt,
    });
  }

  // 環境変数から取得
  logger.info('deploy', 'ftp_uploader.get_ftp_config.env_fallback.start', {
    elapsed_ms: Date.now() - startedAt,
  });
  const host = process.env.FTP_HOST;
  const user = process.env.FTP_USER;
  const password = process.env.FTP_PASSWORD;

  const missingEnv: string[] = [];
  if (!host) missingEnv.push('FTP_HOST');
  if (!user) missingEnv.push('FTP_USER');
  if (!password) missingEnv.push('FTP_PASSWORD');

  if (!host || !user || !password) {
    logger.error('deploy', 'ftp_uploader.get_ftp_config.failed', {
      reason: 'missing_required_fields',
      missing_env: missingEnv,
      elapsed_ms: Date.now() - startedAt,
    });
    throw new Error(
      'FTP設定が不足しています。設定ページまたは環境変数でFTP接続情報を設定してください。',
    );
  }

  const config: FtpConfig = {
    host,
    user,
    password,
    port: process.env.FTP_PORT ? parseInt(process.env.FTP_PORT, 10) : 21,
    secure: false,
    remoteBasePath: process.env.FTP_REMOTE_PATH || '/public_html/column/columns/',
  };
  logger.info('deploy', 'ftp_uploader.get_ftp_config.end', {
    source: 'env',
    host: config.host,
    port: config.port,
    remote_base_path: config.remoteBasePath,
    elapsed_ms: Date.now() - startedAt,
  });
  return config;
}

// ─── 共通設定 (#8: timeout / retry を一元化) ──────────────────────────────────
// 以前は uploadToFtp と per-article deploy が timeout 無指定 (basic-ftp 既定 30s)、
// bulk-deploy のみ 60s と不統一で、かつ lolipop の一時的な 4xx/timeout に対する
// リトライが一切無かった。env で上書き可能な単一の定数に集約する。

/** FTP ソケット timeout (ms)。env FTP_TIMEOUT_MS で上書き可。既定 60s。 */
export const FTP_TIMEOUT_MS = Number(process.env.FTP_TIMEOUT_MS) || 60_000;
/** 1 ファイルあたりの追加リトライ回数。env FTP_MAX_RETRIES で上書き可。既定 2。 */
export const FTP_MAX_RETRIES = Number(process.env.FTP_MAX_RETRIES) || 2;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── ヘルパー ────────────────────────────────────────────────────────────────

/**
 * 文字列をReadableストリームに変換する。
 */
function stringToStream(content: string): Readable {
  // 軽量ヘルパだが silent failure 調査用に最小限のログを残す
  logger.info('deploy', 'ftp_uploader.string_to_stream', {
    bytes: Buffer.byteLength(content, 'utf-8'),
    elapsed_ms: 0,
  });
  return Readable.from(Buffer.from(content, 'utf-8'));
}

/**
 * リモートパスからディレクトリ部分を抽出する。
 * 例: "page/2/index.html" → "page/2"
 */
function getRemoteDir(remotePath: string): string | null {
  const lastSlash = remotePath.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  return remotePath.substring(0, lastSlash);
}

/**
 * リモートベースパスの末尾スラッシュを正規化する。
 */
function normalizeBasePath(basePath: string): string {
  return basePath.endsWith('/') ? basePath : basePath + '/';
}

// ─── 単一ファイルアップロード ────────────────────────────────────────────────

/**
 * 単一ファイルをFTPサーバーにアップロードする。
 * 既に接続済みのFTPクライアントを受け取る。
 */
export async function uploadFile(
  client: Client,
  basePath: string,
  remotePath: string,
  content: string,
): Promise<void> {
  const startedAt = Date.now();
  const fullPath = normalizeBasePath(basePath) + remotePath;
  const bytes = Buffer.byteLength(content, 'utf-8');
  logger.info('ftp', 'ftp_uploader.upload_file.start', {
    remote_path: remotePath,
    full_path: fullPath,
    bytes,
    elapsed_ms: 0,
  });

  try {
    // ディレクトリが必要な場合は作成
    const dir = getRemoteDir(fullPath);
    if (dir) {
      const tDir = Date.now();
      logger.info('ftp', 'ftp_uploader.upload_file.ensure_dir.start', {
        dir,
        full_path: fullPath,
        elapsed_ms: Date.now() - startedAt,
      });
      logger.info('ftp', 'ftp_uploader.ensure_dir.attempt', {
        dir,
        full_path: fullPath,
        target: dir,
      });
      const tEnsure = Date.now();
      await client.ensureDir(dir);
      logger.info('ftp', 'ftp_uploader.ensure_dir.ok', {
        dir,
        elapsed_ms: Date.now() - tEnsure,
      });
      // ensureDirでカレントディレクトリが移動するのでルートに戻る
      logger.info('ftp', 'ftp_uploader.cd.attempt', {
        dir,
        target: '/',
      });
      const tCd = Date.now();
      await client.cd('/');
      logger.info('ftp', 'ftp_uploader.cd.ok', {
        target: '/',
        elapsed_ms: Date.now() - tCd,
      });
      logger.info('ftp', 'ftp_uploader.upload_file.ensure_dir.end', {
        dir,
        elapsed_ms: Date.now() - tDir,
      });
    }

    // ファイルをアップロード
    const tUpload = Date.now();
    logger.info('ftp', 'ftp_uploader.upload_file.upload_from.start', {
      full_path: fullPath,
      bytes,
      elapsed_ms: Date.now() - startedAt,
    });
    const stream = stringToStream(content);
    logger.info('ftp', 'ftp_uploader.upload_from.attempt', {
      full_path: fullPath,
      bytes,
      target: fullPath,
    });
    const tUploadCall = Date.now();
    await client.uploadFrom(stream, fullPath);
    logger.info('ftp', 'ftp_uploader.upload_from.ok', {
      full_path: fullPath,
      bytes,
      elapsed_ms: Date.now() - tUploadCall,
    });
    logger.info('ftp', 'ftp_uploader.upload_file.upload_from.end', {
      full_path: fullPath,
      bytes,
      elapsed_ms: Date.now() - tUpload,
    });

    logger.info('ftp', 'ftp_uploader.upload_file.end', {
      remote_path: remotePath,
      full_path: fullPath,
      bytes,
      ok: true,
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (e) {
    logger.error(
      'ftp',
      'ftp_uploader.upload_file.failed',
      {
        remote_path: remotePath,
        full_path: fullPath,
        bytes,
        error_message: (e as Error)?.message ?? String(e),
        stack: (e as Error)?.stack?.slice(0, 500),
        elapsed_ms: Date.now() - startedAt,
      },
      e instanceof Error ? e : undefined,
    );
    throw e;
  }
}

/**
 * #8: 単一ファイルアップロードを transient エラーに対してリトライする。
 * uploadFile は内部で ensureDir + cd('/') を毎回やり直すため、同一接続上で
 * 再実行しても cwd 状態に依存しない (リトライ安全)。指数バックオフ。
 */
async function uploadFileWithRetry(
  client: Client,
  basePath: string,
  remotePath: string,
  content: string,
  maxRetries: number = FTP_MAX_RETRIES,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await uploadFile(client, basePath, remotePath, content);
      if (attempt > 0) {
        logger.info('ftp', 'ftp_uploader.upload_file.retry_succeeded', {
          remote_path: remotePath,
          attempt,
        });
      }
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries) {
        const backoff = 500 * (attempt + 1);
        logger.warn('ftp', 'ftp_uploader.upload_file.retry', {
          remote_path: remotePath,
          attempt,
          max_retries: maxRetries,
          backoff_ms: backoff,
          error_message: e instanceof Error ? e.message : String(e),
        });
        await sleepMs(backoff);
      }
    }
  }
  throw lastErr;
}

// ─── モンキーテスト / DRY_RUN ガード ─────────────────────────────────────────
// publish-control-v2 spec §6.3 — test runs must NEVER reach prod FTP.
// Bypass is allowed only when FTP_DRY_RUN=true (writes to ./tmp/ftp-dry-run/).

function assertSafeTarget(config: FtpConfig, files: UploadFile[]): void {
  const startedAt = Date.now();
  logger.info('deploy', 'ftp_uploader.assert_safe_target.start', {
    files_count: files.length,
    host: config.host,
    dry_run: process.env.FTP_DRY_RUN === 'true',
    node_env: process.env.NODE_ENV,
    monkey_test: process.env.MONKEY_TEST === 'true',
    elapsed_ms: 0,
  });
  if (process.env.FTP_DRY_RUN === 'true') {
    logger.info('deploy', 'ftp_uploader.assert_safe_target.end', {
      result: 'dry_run_bypass',
      elapsed_ms: Date.now() - startedAt,
    });
    return;
  }
  if (process.env.NODE_ENV === 'test') {
    logger.error('deploy', 'ftp_uploader.assert_safe_target.failed', {
      reason: 'test_env_without_dry_run',
      elapsed_ms: Date.now() - startedAt,
    });
    throw new Error('FTP_DRY_RUN=true is required in tests (refusing to touch real FTP)');
  }
  if (process.env.MONKEY_TEST === 'true') {
    const allMonkey = files.every((f) => f.remotePath.includes('monkey-'));
    if (!allMonkey) {
      const offenders = files
        .filter((f) => !f.remotePath.includes('monkey-'))
        .map((f) => f.remotePath);
      logger.error('deploy', 'ftp_uploader.assert_safe_target.failed', {
        reason: 'monkey_test_non_monkey_paths',
        offenders,
        elapsed_ms: Date.now() - startedAt,
      });
      throw new Error(
        `MONKEY_TEST=true refuses non-monkey paths. offenders: ${offenders.join(', ')}`,
      );
    }
  }
  logger.info('deploy', 'ftp_uploader.assert_safe_target.end', {
    result: 'pass',
    elapsed_ms: Date.now() - startedAt,
  });
}

async function dryRunWrite(config: FtpConfig, files: UploadFile[]): Promise<UploadResult> {
  const startedAt = Date.now();
  logger.info('deploy', 'ftp_uploader.dry_run_write.start', {
    files_count: files.length,
    remote_base_path: config.remoteBasePath,
    elapsed_ms: 0,
  });
  const fs = await import('fs/promises');
  const path = await import('path');
  const root = path.join(process.cwd(), 'tmp', 'ftp-dry-run');
  let uploaded = 0;
  const errors: string[] = [];
  for (const f of files) {
    const tFile = Date.now();
    try {
      const full = path.join(root, config.remoteBasePath, f.remotePath);
      logger.info('deploy', 'ftp_uploader.dry_run_write.per_file.start', {
        remote_path: f.remotePath,
        full,
        bytes: Buffer.byteLength(f.content, 'utf-8'),
        elapsed_ms: Date.now() - startedAt,
      });
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, f.content, 'utf8');
      uploaded++;
      logger.info('deploy', 'ftp_uploader.dry_run_write.per_file.end', {
        remote_path: f.remotePath,
        ok: true,
        elapsed_ms: Date.now() - tFile,
      });
    } catch (err) {
      const msg = `${f.remotePath}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      logger.error(
        'deploy',
        'ftp_uploader.dry_run_write.per_file.failed',
        {
          remote_path: f.remotePath,
          error_message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack?.slice(0, 500) : undefined,
          elapsed_ms: Date.now() - tFile,
        },
        err instanceof Error ? err : undefined,
      );
    }
  }
  const result = { success: errors.length === 0, uploaded, errors };
  logger.info('deploy', 'ftp_uploader.dry_run_write.end', {
    success: result.success,
    uploaded,
    errors_count: errors.length,
    elapsed_ms: Date.now() - startedAt,
  });
  return result;
}

// ─── 複数ファイル一括アップロード ────────────────────────────────────────────

/**
 * 複数ファイルをFTPサーバーにアップロードする。
 * 1つの接続で全ファイルをアップロードし、結果をまとめて返す。
 */
export async function uploadToFtp(
  config: FtpConfig,
  files: UploadFile[],
): Promise<UploadResult> {
  const startedAt = Date.now();
  const totalBytes = files.reduce(
    (acc, f) => acc + Buffer.byteLength(f.content, 'utf-8'),
    0,
  );
  logger.info('deploy', 'ftp_uploader.upload_to_ftp.start', {
    files_count: files.length,
    total_bytes: totalBytes,
    host: config.host,
    port: config.port,
    secure: config.secure,
    remote_base_path: config.remoteBasePath,
    elapsed_ms: 0,
  });

  assertSafeTarget(config, files);
  if (process.env.FTP_DRY_RUN === 'true') {
    logger.info('deploy', 'ftp_uploader.upload_to_ftp.dry_run_branch', {
      files_count: files.length,
      elapsed_ms: Date.now() - startedAt,
    });
    const result = await dryRunWrite(config, files);
    logger.info('deploy', 'ftp_uploader.upload_to_ftp.end', {
      mode: 'dry_run',
      success: result.success,
      uploaded: result.uploaded,
      errors_count: result.errors.length,
      elapsed_ms: Date.now() - startedAt,
    });
    return result;
  }

  const client = new Client(FTP_TIMEOUT_MS);
  // P5-77: FTP wire-level (PROTOCOL) transaction を logger 経由で出力
  // (ESM 循環回避のため動的 import)
  const { attachFtpWireLogger } = await import('@/lib/deploy/ftp-wire-logger');
  attachFtpWireLogger(client, { where: 'ftp_uploader' });
  const errors: string[] = [];
  let uploaded = 0;

  try {
    // FTP接続
    const tConnect = Date.now();
    logger.info('ftp', 'ftp_uploader.upload_to_ftp.connect.start', {
      host: config.host,
      port: config.port || 21,
      secure: config.secure || false,
      elapsed_ms: Date.now() - startedAt,
    });
    logger.info('ftp', 'ftp_uploader.access.attempt', {
      host: config.host,
      port: config.port || 21,
      secure: config.secure || false,
      target: config.host,
    });
    const tAccess = Date.now();
    await client.access({
      host: config.host,
      user: config.user,
      password: config.password,
      port: config.port || 21,
      secure: config.secure || false,
    });
    logger.info('ftp', 'ftp_uploader.access.ok', {
      host: config.host,
      elapsed_ms: Date.now() - tAccess,
    });
    logger.info('ftp', 'ftp_uploader.upload_to_ftp.connect.end', {
      host: config.host,
      elapsed_ms: Date.now() - tConnect,
    });

    // 各ファイルをアップロード
    for (const file of files) {
      const tFile = Date.now();
      logger.info('ftp', 'ftp_uploader.upload_to_ftp.per_file.start', {
        remote_path: file.remotePath,
        bytes: Buffer.byteLength(file.content, 'utf-8'),
        elapsed_ms: Date.now() - startedAt,
      });
      try {
        await uploadFileWithRetry(client, config.remoteBasePath, file.remotePath, file.content);
        uploaded++;
        logger.info('ftp', 'ftp_uploader.upload_to_ftp.per_file.end', {
          remote_path: file.remotePath,
          ok: true,
          elapsed_ms: Date.now() - tFile,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${file.remotePath}: ${msg}`);
        logger.error(
          'ftp',
          'ftp_uploader.upload_to_ftp.per_file.failed',
          {
            remote_path: file.remotePath,
            error_message: msg,
            stack: err instanceof Error ? err.stack?.slice(0, 500) : undefined,
            elapsed_ms: Date.now() - tFile,
          },
          err instanceof Error ? err : undefined,
        );
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`FTP接続エラー: ${msg}`);
    logger.error(
      'ftp',
      'ftp_uploader.upload_to_ftp.connect.failed',
      {
        host: config.host,
        port: config.port,
        error_message: msg,
        stack: err instanceof Error ? err.stack?.slice(0, 500) : undefined,
        elapsed_ms: Date.now() - startedAt,
      },
      err instanceof Error ? err : undefined,
    );
  } finally {
    logger.info('ftp', 'ftp_uploader.upload_to_ftp.close', {
      uploaded,
      errors_count: errors.length,
      elapsed_ms: Date.now() - startedAt,
    });
    logger.info('ftp', 'ftp_uploader.close.attempt', {
      host: config.host,
      uploaded,
      errors_count: errors.length,
      target: config.host,
    });
    const tClose = Date.now();
    client.close();
    logger.info('ftp', 'ftp_uploader.close.ok', {
      host: config.host,
      elapsed_ms: Date.now() - tClose,
    });
  }

  const result: UploadResult = {
    success: errors.length === 0,
    uploaded,
    errors,
  };
  logger.info('deploy', 'ftp_uploader.upload_to_ftp.end', {
    mode: 'live',
    success: result.success,
    uploaded: result.uploaded,
    errors_count: result.errors.length,
    files_count: files.length,
    total_bytes: totalBytes,
    elapsed_ms: Date.now() - startedAt,
  });
  return result;
}

/**
 * publish-control-v2: ソフト撤回のための単一ファイル上書き。
 * 物理削除はせず、与えられたコンテンツで上書きする。
 */
export async function softWithdrawFile(
  config: FtpConfig,
  remotePath: string,
  content: string,
): Promise<UploadResult> {
  const startedAt = Date.now();
  const bytes = Buffer.byteLength(content, 'utf-8');
  const mode =
    process.env.FTP_DRY_RUN === 'true'
      ? 'dry_run'
      : process.env.MONKEY_TEST === 'true'
      ? 'monkey'
      : 'live';
  logger.info('deploy', 'ftp_uploader.soft_withdraw_file.start', {
    remote_path: remotePath,
    bytes,
    mode,
    host: config.host,
    elapsed_ms: 0,
  });
  try {
    const result = await uploadToFtp(config, [{ remotePath, content }]);
    logger.info('deploy', 'ftp_uploader.soft_withdraw_file.end', {
      remote_path: remotePath,
      mode,
      success: result.success,
      uploaded: result.uploaded,
      errors_count: result.errors.length,
      errors: result.errors,
      elapsed_ms: Date.now() - startedAt,
    });
    return result;
  } catch (e) {
    logger.error(
      'deploy',
      'ftp_uploader.soft_withdraw_file.failed',
      {
        remote_path: remotePath,
        mode,
        error_message: (e as Error)?.message ?? String(e),
        stack: (e as Error)?.stack?.slice(0, 500),
        elapsed_ms: Date.now() - startedAt,
      },
      e instanceof Error ? e : undefined,
    );
    throw e;
  }
}
