// ============================================================================
// src/lib/deploy/ftp-uploader.ts
// FTPアップローダー — basic-ftpを使用した静的ファイルアップロード
//
// 生成されたHTMLファイルやCSS/JSをFTPサーバーにアップロードする。
// ============================================================================

import { Client } from 'basic-ftp';
import { Readable } from 'stream';

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
export function getFtpConfig(): FtpConfig {
  const host = process.env.FTP_HOST;
  const user = process.env.FTP_USER;
  const password = process.env.FTP_PASSWORD;

  if (!host || !user || !password) {
    throw new Error(
      'FTP設定が不足しています。環境変数 FTP_HOST, FTP_USER, FTP_PASSWORD を設定してください。',
    );
  }

  return {
    host,
    user,
    password,
    port: process.env.FTP_PORT ? parseInt(process.env.FTP_PORT, 10) : 21,
    secure: false,
    remoteBasePath: process.env.FTP_REMOTE_PATH || '/public_html/column/columns/',
  };
}

// ─── ヘルパー ────────────────────────────────────────────────────────────────

/**
 * 文字列をReadableストリームに変換する。
 */
function stringToStream(content: string): Readable {
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
  const fullPath = normalizeBasePath(basePath) + remotePath;

  // ディレクトリが必要な場合は作成
  const dir = getRemoteDir(fullPath);
  if (dir) {
    await client.ensureDir(dir);
    // ensureDirでカレントディレクトリが移動するのでルートに戻る
    await client.cd('/');
  }

  // ファイルをアップロード
  const stream = stringToStream(content);
  await client.uploadFrom(stream, fullPath);
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
  const client = new Client();
  const errors: string[] = [];
  let uploaded = 0;

  try {
    // FTP接続
    client.ftp.verbose = false;
    await client.access({
      host: config.host,
      user: config.user,
      password: config.password,
      port: config.port || 21,
      secure: config.secure || false,
    });

    // 各ファイルをアップロード
    for (const file of files) {
      try {
        await uploadFile(client, config.remoteBasePath, file.remotePath, file.content);
        uploaded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${file.remotePath}: ${msg}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`FTP接続エラー: ${msg}`);
  } finally {
    client.close();
  }

  return {
    success: errors.length === 0,
    uploaded,
    errors,
  };
}
