// ============================================================================
// src/app/api/cta/generate-banners/storage.ts
// CTAバナー画像のSupabase Storageアップロード
// ============================================================================

import { createServiceRoleClient } from '@/lib/supabase/server';

const BUCKET_NAME = 'article-images';

/**
 * CTAバナー画像をSupabase Storageにアップロードし、公開URLを返す。
 *
 * @param position - CTAポジション (cta2 / cta3)
 * @param imageBuffer - 画像データ (Buffer)
 * @param mimeType - MIMEタイプ
 * @returns 公開URL
 */
export async function uploadCtaBannerImage(
  position: string,
  imageBuffer: Buffer,
  mimeType: string,
): Promise<string> {
  const supabase = await createServiceRoleClient();

  // バケット 'article-images' は事前にSQL/ダッシュボードで作成済み
  // listBuckets/createBucketはRLSで拒否されるためスキップ

  // 拡張子をMIMEタイプから決定
  const ext = mimeTypeToExtension(mimeType);
  // タイムスタンプを付与して、ブラウザキャッシュを回避
  const timestamp = Date.now();
  const path = `cta-banners/${position}_${timestamp}.${ext}`;

  // アップロード
  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, imageBuffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(
      `CTAバナーアップロードに失敗しました (${position}): ${uploadError.message}`,
    );
  }

  // 公開URLを取得
  const { data: urlData } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(path);

  return urlData.publicUrl;
}

/**
 * MIMEタイプからファイル拡張子を返す。
 */
function mimeTypeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return map[mimeType] || 'webp';
}
