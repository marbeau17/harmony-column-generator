import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { Client } from 'basic-ftp';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const body = await request.json();
    const { host, user: ftpUser, password, port } = body;

    if (!host || !ftpUser || !password) {
      return NextResponse.json({ error: 'ホスト、ユーザー名、パスワードは必須です' }, { status: 400 });
    }

    const client = new Client();
    client.ftp.verbose = false;

    try {
      await client.access({
        host,
        user: ftpUser,
        password,
        port: port || 21,
        secure: false,
      });

      const list = await client.list();
      logger.info('api', 'ftpTest.success', { host, directories: list.length });

      client.close();

      return NextResponse.json({
        success: true,
        message: `FTP接続成功（${list.length}件のファイル/ディレクトリを確認）`,
      });
    } catch (ftpErr) {
      client.close();
      const msg = ftpErr instanceof Error ? ftpErr.message : String(ftpErr);
      logger.error('api', 'ftpTest.failed', { host }, ftpErr);
      return NextResponse.json({ error: `FTP接続失敗: ${msg}` }, { status: 400 });
    }
  } catch (err) {
    logger.error('api', 'ftpTest', undefined, err);
    return NextResponse.json({ error: '接続テストに失敗しました' }, { status: 500 });
  }
}
