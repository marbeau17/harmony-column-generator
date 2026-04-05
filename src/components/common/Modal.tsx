// ============================================================================
// src/components/common/Modal.tsx
// 汎用モーダルコンポーネント — オーバーレイ + 中央配置 + ESC で閉じる
// ============================================================================
'use client';

import { useEffect, useCallback, useRef } from 'react';

type MaxWidth = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl';

const MAX_WIDTH_MAP: Record<MaxWidth, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** モーダルの最大幅。デフォルト '2xl' */
  maxWidth?: MaxWidth;
}

export default function Modal({ isOpen, onClose, title, children, maxWidth = '2xl' }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // ESC キーで閉じる
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      {/* オーバーレイ — クリックでモーダルを閉じる */}
      <div
        className="absolute inset-0 bg-black/40 animate-[fadeIn_150ms_ease-out]"
        onClick={onClose}
      />

      {/* モーダル本体 — モバイルではほぼ全画面、デスクトップでは中央配置 */}
      <div
        className={`absolute inset-2 md:inset-auto md:relative w-auto md:w-full ${MAX_WIDTH_MAP[maxWidth]} flex flex-col bg-white rounded-xl shadow-2xl animate-[scaleIn_200ms_ease-out] md:max-h-[85vh] md:mx-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 md:px-6 md:py-4">
          <h2 className="text-base md:text-lg font-semibold text-gray-900 truncate pr-2">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="flex h-11 w-11 md:h-8 md:w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 active:bg-gray-200"
            aria-label="閉じる"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* コンテンツ — モバイルでも確実にスクロール可能 */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 md:px-6 md:py-4">{children}</div>
      </div>
    </div>
  );
}
