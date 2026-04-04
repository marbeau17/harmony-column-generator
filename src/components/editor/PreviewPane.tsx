// ============================================================================
// src/components/editor/PreviewPane.tsx
// リアルタイムプレビュー — デバイス切替(desktop/mobile)対応
// iframe + sandbox でサニタイズされた表示
// ============================================================================

'use client';

import { useState, useMemo, useRef, useEffect } from 'react';

// ─── Props ──────────────────────────────────────────────────────────────────

interface PreviewPaneProps {
  content: string;
}

type DeviceMode = 'desktop' | 'mobile';

// ─── Preview CSS (prose-like styling) ───────────────────────────────────────

const PREVIEW_CSS = `
  * { box-sizing: border-box; }
  body {
    font-family: 'Noto Sans JP', -apple-system, BlinkMacSystemFont, sans-serif;
    line-height: 1.8;
    color: #333;
    background: #fff;
    margin: 0;
    padding: 24px;
    font-size: 15px;
    letter-spacing: 0.03em;
  }
  h1 { font-size: 1.75em; font-weight: 700; margin: 1.5em 0 0.8em; padding-bottom: 0.3em; border-bottom: 2px solid #e5e7eb; }
  h2 { font-size: 1.4em; font-weight: 700; margin: 1.4em 0 0.6em; padding: 12px 16px; background: #f3f4f6; border-left: 4px solid #6366f1; }
  h3 { font-size: 1.15em; font-weight: 600; margin: 1.2em 0 0.5em; padding-bottom: 0.3em; border-bottom: 1px solid #e5e7eb; }
  p { margin: 0 0 1em; }
  img { max-width: 100%; height: auto; border-radius: 8px; }
  a { color: #2563eb; text-decoration: underline; }
  ul, ol { padding-left: 1.5em; margin-bottom: 1em; }
  li { margin-bottom: 0.3em; }
  blockquote { border-left: 4px solid #d1d5db; padding: 8px 16px; margin: 16px 0; color: #6b7280; background: #f9fafb; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { padding: 8px 12px; border: 1px solid #e5e7eb; text-align: left; }
  th { background: #f9fafb; font-weight: 600; }
  mark { background: #fef08a; padding: 1px 4px; border-radius: 2px; }
  code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  pre { background: #1e293b; color: #e2e8f0; padding: 16px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
  .placeholder-container { text-align: center; margin: 16px 0; }
  .placeholder-container img { max-width: 100%; height: auto; border-radius: 8px; }

  /* CTA */
  .harmony-cta { margin: 2rem 0; border-radius: 12px; overflow: hidden; }
  .harmony-cta-1 { background: linear-gradient(135deg, #f5ebe0 0%, #e8ddd0 100%); border-left: 4px solid #b39578; }
  .harmony-cta-2 { background: linear-gradient(135deg, #ede7f0 0%, #ddd5e4 100%); border-left: 4px solid #9b8bb4; }
  .harmony-cta-3 { background: linear-gradient(135deg, #53352b 0%, #7a5c4f 100%); color: #fff; }
  .harmony-cta-inner { padding: 1.2rem 1.5rem; text-align: center; }
  .harmony-cta-badge { display: inline-block; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.05em; color: #b39578; background: rgba(179,149,120,0.12); border: 1px solid rgba(179,149,120,0.25); border-radius: 20px; padding: 0.15rem 0.7rem; margin-bottom: 0.5rem; }
  .harmony-cta-3 .harmony-cta-badge { color: #d4a574; background: rgba(212,165,116,0.15); border-color: rgba(212,165,116,0.3); }
  .harmony-cta-catch { font-size: 1rem; font-weight: 600; color: #53352b; margin: 0 0 0.3rem; }
  .harmony-cta-3 .harmony-cta-catch { color: #fff; }
  .harmony-cta-sub { font-size: 0.85rem; color: #8b6f5e; margin: 0 0 0.8rem; }
  .harmony-cta-3 .harmony-cta-sub { color: rgba(255,255,255,0.85); }
  .harmony-cta-btn { display: inline-block; padding: 0.6rem 1.8rem; background: #b39578; color: #fff; border-radius: 25px; text-decoration: none; font-weight: 600; font-size: 0.9rem; }
  .harmony-cta-2 .harmony-cta-btn { background: #9b8bb4; }
  .harmony-cta-3 .harmony-cta-btn { background: linear-gradient(135deg, #c4856e, #d4a574); padding: 0.7rem 2.2rem; font-size: 1rem; }

  /* Highlights */
  .marker-yellow { background: linear-gradient(transparent 60%, #fff3b0 60%); padding: 0 2px; }
  .marker-pink { background: linear-gradient(transparent 60%, #ffd6e0 60%); padding: 0 2px; }

  /* TOC */
  .article-toc { background: #faf5f0; border: 1px solid #e8ddd0; border-radius: 8px; padding: 1.2rem 1.5rem; margin: 1.5rem 0 2rem; }
  .article-toc-title { font-size: 15px; font-weight: 600; color: #53352b; margin: 0; padding: 0; border: none !important; background: none !important; }
  .article-toc-list { list-style: none; padding: 0; margin: 0.75rem 0 0; }
  .article-toc-list li { padding: 0.2rem 0; }
  .article-toc-list li a { color: #53352b; text-decoration: none; font-size: 14px; }
  .article-toc-list ol { list-style: none; padding-left: 1.2rem; margin: 0.2rem 0 0; }

  /* Related Articles */
  .related-articles { margin: 2rem 0; }
  .related-articles-title { font-size: 1.1rem; font-weight: 600; color: #53352b; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid #b39578; }
  .related-articles-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
  .related-article-card { display: block; border-radius: 8px; overflow: hidden; border: 1px solid #e8ddd0; transition: transform 0.2s, box-shadow 0.2s; text-decoration: none; }
  .related-article-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(83,53,43,0.1); }
  .related-article-thumb { height: 120px; background: linear-gradient(135deg, #f5ebe0, #e8ddd0); overflow: hidden; }
  .related-article-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .related-article-name { font-size: 0.85rem; font-weight: 600; color: #53352b; padding: 0.75rem; margin: 0; line-height: 1.4; }
  .related-article-theme { display: inline-block; font-size: 0.7rem; color: #b39578; padding: 0 0.75rem 0.75rem; }
`;

// ─── Component ──────────────────────────────────────────────────────────────

export default function PreviewPane({ content }: PreviewPaneProps) {
  const [device, setDevice] = useState<DeviceMode>('desktop');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const fullHtml = useMemo(() => {
    // Basic sanitization: strip <script> tags from content
    const sanitized = content
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/on\w+="[^"]*"/gi, '');

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700&display=swap" rel="stylesheet"/>
  <style>${PREVIEW_CSS}</style>
</head>
<body>${sanitized || '<p style="color:#9ca3af;">本文がありません</p>'}</body>
</html>`;
  }, [content]);

  // Write to iframe (SSR 時は document が存在しないのでガード)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(fullHtml);
        doc.close();
      }
    } catch (e) {
      // sandbox 制約等でアクセスできない場合は無視
      console.warn('PreviewPane: iframe write failed', e);
    }
  }, [fullHtml]);

  const iframeWidth = device === 'mobile' ? '375px' : '100%';

  return (
    <div className="flex flex-col h-full border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
      {/* Header with device toggle */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
          </div>
          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
            プレビュー
          </span>
        </div>

        {/* Device toggle */}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setDevice('desktop')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              device === 'desktop'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
            }`}
            title="デスクトップ表示"
          >
            {/* Desktop icon */}
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setDevice('mobile')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              device === 'mobile'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
            }`}
            title="モバイル表示"
          >
            {/* Mobile icon */}
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
            </svg>
          </button>
        </div>
      </div>

      {/* iframe preview */}
      <div className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-900 flex justify-center p-2">
        <iframe
          ref={iframeRef}
          title="記事プレビュー"
          className="bg-white shadow-sm rounded transition-all duration-300"
          style={{
            width: iframeWidth,
            maxWidth: '100%',
            minHeight: '500px',
            height: '100%',
            border: 'none',
          }}
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
}
