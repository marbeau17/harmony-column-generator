// ============================================================================
// src/lib/storage/image-storage.ts
// Supabase Storage への画像アップロードユーティリティ
// ============================================================================

import { createServiceRoleClient } from '@/lib/supabase/server';

const BUCKET_NAME = 'article-images';

/**
 * 画像バッファを Supabase Storage にアップロードし、公開URLを返す。
 *
 * @param articleId - 記事ID (UUID)
 * @param position - 画像の配置位置 (hero / body / summary)
 * @param imageBuffer - 画像データ (Buffer)
 * @param mimeType - MIMEタイプ (例: image/png, image/webp)
 * @returns 公開URL
 */
export async function uploadImage(
  articleId: string,
  position: string,
  imageBuffer: Buffer,
  mimeType: string,
): Promise<string> {
  const supabase = await createServiceRoleClient();

  // バケットが存在しなければ作成
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some((b) => b.name === BUCKET_NAME);

  if (!bucketExists) {
    const { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024, // 10MB
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    });
    if (createError) {
      throw new Error(`バケット作成に失敗しました: ${createError.message}`);
    }
  }

  // 拡張子をMIMEタイプから決定
  const ext = mimeTypeToExtension(mimeType);
  const path = `articles/${articleId}/${position}.${ext}`;

  // アップロード (upsert: 既存ファイルは上書き)
  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, imageBuffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`画像アップロードに失敗しました (${position}): ${uploadError.message}`);
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
