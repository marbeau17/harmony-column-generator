// ============================================================================
// src/app/api/cta/generate-banners/storage.ts
// CTAバナー画像のSupabase Storageアップロード
// ============================================================================

import { createServiceRoleClient } from '@/lib/supabase/server';

const BUCKET_NAME = 'article-images';

/**
 * CTAバナー画像をSupabase Storageにアップロードし、公開URLを返す。
 *
 * @param position - CTAポジション (cta1 / cta2 / cta3)
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

  // バケットが存在しなければ作成
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some((b) => b.name === BUCKET_NAME);

  if (!bucketExists) {
    const { error: createError } = await supabase.storage.createBucket(
      BUCKET_NAME,
      {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024, // 10MB
        allowedMimeTypes: [
          'image/png',
          'image/jpeg',
          'image/webp',
          'image/gif',
        ],
      },
    );
    if (createError) {
      throw new Error(`バケット作成に失敗しました: ${createError.message}`);
    }
  }

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
