// ============================================================================
// src/components/editor/TipTapEditor.tsx
// リッチテキストエディタ — TipTap (ProseMirror) ベース
//
// IMPORTANT: TipTap (ProseMirror) はHTMLコメントをパース時に破棄するため、
// <!--IMAGE:...-->等のマーカーコメントを保護する仕組みを実装。
// 入力時にコメントを <span data-marker> / <div data-image-placeholder> に変換し、
// 出力時に復元する。(apolloONEBlog流用)
// ============================================================================

'use client';

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import { Node, mergeAttributes } from '@tiptap/core';
import { useCallback, useEffect, useRef, useState } from 'react';

// ─── HTML Comment Marker preservation ───────────────────────────────────────
// TipTap/ProseMirror strips HTML comments during parsing. To protect markers
// like <!--IMAGE:...-->, we convert them to visible elements before feeding
// HTML to TipTap, and restore them when extracting HTML via getHTML().

/** Pattern matching non-image comment markers */
const NON_IMAGE_COMMENT_RE = /<!--(CHART_HERE|CHART_DATA_START[\s\S]*?CHART_DATA_END)-->/g;

/**
 * Convert HTML comment markers to TipTap-compatible elements.
 * IMAGE markers -> block-level <div data-image-placeholder>
 * Other markers -> inline <span data-comment-marker>
 */
function commentsToSpans(html: string): string {
  // 1. Convert wrapped image placeholders
  let result = html.replace(
    /<div\s+class="placeholder-container"[^>]*>\s*<!--(IMAGE:[^>]+)-->\s*<\/div>/g,
    (_, content: string) =>
      `<div data-image-placeholder="${encodeURIComponent(content)}"></div>`,
  );

  // 2. Convert standalone <!--IMAGE:...-->
  result = result.replace(
    /<!--(IMAGE:[^>]+)-->/g,
    (_, content: string) =>
      `<div data-image-placeholder="${encodeURIComponent(content)}"></div>`,
  );

  // 3. Convert non-image markers to inline spans
  result = result.replace(
    NON_IMAGE_COMMENT_RE,
    (_, content: string) =>
      `<span data-comment-marker="${encodeURIComponent(content)}"></span>`,
  );

  return result;
}

/**
 * Convert TipTap elements back to HTML comments.
 */
function spansToComments(html: string): string {
  // 1. Restore block-level image placeholders
  let result = html.replace(
    /<div[^>]*data-image-placeholder="([^"]*)"[^>]*>[^<]*<\/div>/g,
    (_, encoded: string) =>
      `<div class="placeholder-container"><!--${decodeURIComponent(encoded)}--></div>`,
  );

  // 2. Restore inline comment markers
  result = result.replace(
    /<span[^>]*data-comment-marker="([^"]*)"[^>]*>.*?<\/span>/g,
    (_, encoded: string) => `<!--${decodeURIComponent(encoded)}-->`,
  );

  return result;
}

// ─── Custom TipTap Node for IMAGE placeholders (block-level) ────────────────

const ImagePlaceholderNode = Node.create({
  name: 'imagePlaceholder',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      'data-image-placeholder': {
        default: null,
        parseHTML: (el) => el.getAttribute('data-image-placeholder'),
        renderHTML: (attrs) => ({
          'data-image-placeholder': attrs['data-image-placeholder'],
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-image-placeholder]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const raw = decodeURIComponent(
      HTMLAttributes['data-image-placeholder'] || '',
    );
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'image-placeholder-chip',
        contenteditable: 'false',
        style:
          'display:flex;align-items:center;justify-content:center;gap:8px;' +
          'padding:16px;margin:12px 0;border-radius:8px;' +
          'background:#fef3c7;border:2px dashed #f59e0b;color:#92400e;' +
          'font-size:12px;font-family:monospace;user-select:all;cursor:default;',
        title: `画像マーカー: <!--${raw}-->`,
      }),
      raw,
    ];
  },
});

// ─── Custom TipTap Node for comment marker placeholders (inline) ────────────

const CommentMarkerNode = Node.create({
  name: 'commentMarker',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      'data-comment-marker': {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-marker'),
        renderHTML: (attrs) => ({
          'data-comment-marker': attrs['data-comment-marker'],
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-marker]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const raw = decodeURIComponent(
      HTMLAttributes['data-comment-marker'] || '',
    );
    let label = raw;
    if (raw.startsWith('CHART_DATA_START')) {
      label = 'CHART_DATA (embedded)';
    }

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'comment-marker-chip',
        contenteditable: 'false',
        style:
          'display:inline-block;padding:2px 8px;margin:0 2px;border-radius:4px;' +
          'background:#fef3c7;border:1px solid #f59e0b;color:#92400e;font-size:11px;' +
          'font-family:monospace;user-select:all;cursor:default;vertical-align:middle;',
        title: `マーカー: <!--${label}-->`,
      }),
      label,
    ];
  },
});

// ─── Props ──────────────────────────────────────────────────────────────────

interface TipTapEditorProps {
  content: string;
  onChange: (html: string) => void;
  editable?: boolean;
}

// ─── ToolbarButton ──────────────────────────────────────────────────────────

function ToolbarButton({
  onClick,
  active,
  children,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-2 py-1 text-sm rounded transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600'
      }`}
    >
      {children}
    </button>
  );
}

// ─── EditorToolbar ──────────────────────────────────────────────────────────

function EditorToolbar({ editor }: { editor: Editor }) {
  const addImage = useCallback(() => {
    const url = window.prompt('画像URLを入力:');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  const addLink = useCallback(() => {
    const url = window.prompt('リンクURLを入力:');
    if (url) editor.chain().focus().setLink({ href: url }).run();
  }, [editor]);

  return (
    <div className="flex flex-wrap gap-1 p-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
      {/* テキストスタイル */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
        title="太字"
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
        title="斜体"
      >
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        active={editor.isActive('highlight')}
        title="ハイライト"
      >
        H
      </ToolbarButton>

      <div className="w-px bg-gray-300 dark:bg-gray-600 mx-1" />

      {/* 見出し */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive('heading', { level: 2 })}
        title="見出し2"
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive('heading', { level: 3 })}
        title="見出し3"
      >
        H3
      </ToolbarButton>

      <div className="w-px bg-gray-300 dark:bg-gray-600 mx-1" />

      {/* リスト */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')}
        title="箇条書き"
      >
        &#8226; リスト
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')}
        title="番号付き"
      >
        1. リスト
      </ToolbarButton>

      <div className="w-px bg-gray-300 dark:bg-gray-600 mx-1" />

      {/* 挿入 */}
      <ToolbarButton onClick={addLink} title="リンク挿入">
        リンク
      </ToolbarButton>
      <ToolbarButton onClick={addImage} title="画像挿入">
        画像
      </ToolbarButton>

      <div className="w-px bg-gray-300 dark:bg-gray-600 mx-1" />

      {/* Undo/Redo */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        title="元に戻す"
      >
        &#8617;
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        title="やり直し"
      >
        &#8618;
      </ToolbarButton>
    </div>
  );
}

// ─── メインコンポーネント ───────────────────────────────────────────────────

export default function TipTapEditor({
  content,
  onChange,
  editable = true,
}: TipTapEditorProps) {
  const [mounted, setMounted] = useState(false);
  const suppressOnChange = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Link.configure({ openOnClick: false }),
      Image,
      Highlight.configure({ multicolor: true }),
      ImagePlaceholderNode,
      CommentMarkerNode,
    ],
    content: commentsToSpans(content),
    editable,
    onUpdate: ({ editor: ed }) => {
      if (suppressOnChange.current) return;
      const rawHtml = ed.getHTML();
      const restoredHtml = spansToComments(rawHtml);
      onChange(restoredHtml);
    },
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none p-4 min-h-[400px] focus:outline-none dark:prose-invert ' +
          '[&_h2]:bg-gray-100 dark:[&_h2]:bg-gray-700 [&_h2]:p-3 [&_h2]:border-l-4 [&_h2]:border-brand-600 ' +
          '[&_h3]:border-b-2 [&_h3]:border-gray-200 dark:[&_h3]:border-gray-600 [&_h3]:pb-2',
      },
    },
  });

  // Sync external content changes (with marker preservation)
  useEffect(() => {
    if (!editor) return;
    const incomingForTiptap = commentsToSpans(content);
    if (incomingForTiptap !== editor.getHTML()) {
      suppressOnChange.current = true;
      editor.commands.setContent(incomingForTiptap);
      suppressOnChange.current = false;
    }
  }, [content]); // eslint-disable-line react-hooks/exhaustive-deps

  // SSR や hydration 前はプレースホルダーを表示
  if (!mounted || !editor) {
    return (
      <div className="h-96 bg-gray-50 dark:bg-gray-900 animate-pulse rounded" />
    );
  }

  return (
    <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
      {editable && <EditorToolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
