// ============================================================================
// src/components/articles/QualityFixMenu.tsx
// 品質チェック失敗項目に対する 4 戦略修復のドロップダウン (P5-19)
//
// 仕様書: docs/auto-fix-spec.md §2.6
// ============================================================================
'use client';

import { useState } from 'react';
import { Wrench, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { getStrategyFor } from '@/lib/auto-fix/strategy-map';
import type { CheckItem } from '@/lib/content/quality-checklist';
import type { FixStrategy, AutoFixType } from '@/lib/auto-fix/types';

interface Props {
  articleId: string;
  item: CheckItem;
  /** 修復成功後に親側で品質チェックを再実行するためのコールバック */
  onAfter: () => Promise<void>;
  /** 編集ページへの遷移コールバック (manual-edit 戦略時) */
  onManualEdit?: () => void;
}

const STRATEGY_LABEL: Record<
  FixStrategy,
  { label: string; cost: string; time: string }
> = {
  'auto-fix': { label: '🔧 自動補正', cost: '~$0.005', time: '~15s' },
  'regen-chapter': { label: '🔁 章再生成', cost: '~$0.05', time: '~30s' },
  'regen-full': { label: '🔄 全体再生成', cost: '~$0.18', time: '~90s' },
  'manual-edit': { label: '✏️ 手動編集', cost: '0', time: '-' },
  'ignore-warn': { label: '⏭️ この警告を無視', cost: '0', time: '-' },
};

interface AutoFixParamsBuild {
  fix_type: AutoFixType;
  target_value?: number;
  current_value?: number;
  detected_phrase?: string;
  keywords?: string[];
  claim_idx?: number;
}

/**
 * CheckItem から auto-fix params を組み立てる。
 * UI 側でわかる範囲は item.detail / item.value から推測。
 * 不足情報 (キーワード一覧等) はサーバ側で補完される想定。
 */
function buildAutoFixParams(item: CheckItem, fixType: AutoFixType): AutoFixParamsBuild {
  const params: AutoFixParamsBuild = { fix_type: fixType };
  // current/target を value or detail から抽出 (best effort)
  if (typeof item.value === 'number') {
    params.current_value = item.value;
  }
  if (item.detail) {
    // 例: "5回 / 全66文（8%、目標15%以上）"
    const ratioMatch = item.detail.match(/(\d+(?:\.\d+)?)%/);
    if (ratioMatch) params.current_value = Number(ratioMatch[1]) / 100;
    const targetMatch = item.detail.match(/目標\s*(\d+)/);
    if (targetMatch) params.target_value = Number(targetMatch[1]) / 100;
    // 文字数 ("2073文字" 等)
    const charsMatch = item.detail.match(/(\d+)\s*文字/);
    if (charsMatch && fixType === 'length') params.current_value = Number(charsMatch[1]);
  }
  return params;
}

export default function QualityFixMenu({ articleId, item, onAfter, onManualEdit }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const entry = getStrategyFor(item.id);

  const handleStrategy = async (strategy: FixStrategy) => {
    setOpen(false);

    if (strategy === 'manual-edit') {
      if (onManualEdit) onManualEdit();
      else toast('編集画面で本文を直接修正してください');
      return;
    }

    let body: Record<string, unknown> | null = null;

    if (strategy === 'auto-fix') {
      if (!entry.auto_fix_type) {
        toast.error('この項目は自動補正に対応していません');
        return;
      }
      body = {
        fix_strategy: 'auto-fix',
        check_item_id: item.id,
        auto_fix_params: buildAutoFixParams(item, entry.auto_fix_type),
      };
    } else if (strategy === 'ignore-warn') {
      const reason = window.prompt(
        '警告を無視する理由を入力してください（後から監査ログで確認できます）',
      );
      if (!reason || reason.trim().length === 0) {
        toast('キャンセルしました');
        return;
      }
      body = {
        fix_strategy: 'ignore-warn',
        check_item_id: item.id,
        ignore_params: { reason: reason.trim() },
      };
    } else if (strategy === 'regen-chapter' || strategy === 'regen-full') {
      // 既存 /api/articles/[id]/regenerate-segment への proxy 呼出
      const scope = strategy === 'regen-full' ? 'full' : 'chapter';
      const chapterIdxStr =
        scope === 'chapter'
          ? window.prompt('再生成する章番号 (0 始まり) を入力してください', '0')
          : null;
      if (scope === 'chapter' && chapterIdxStr === null) return;
      const reqBody: Record<string, unknown> = { scope };
      if (scope === 'chapter') reqBody.target_idx = Number(chapterIdxStr ?? 0);
      setLoading(true);
      try {
        const res = await fetch(`/api/articles/${articleId}/regenerate-segment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        toast.success(
          scope === 'full' ? '🔄 全体再生成 完了' : `🔁 章 ${chapterIdxStr} 再生成 完了`,
        );
        await onAfter();
      } catch (e) {
        toast.error(`再生成失敗: ${(e as Error).message}`);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!body) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/articles/${articleId}/auto-fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        ok?: boolean;
        diff_summary?: string;
        cost_estimate?: number;
      };
      if (strategy === 'auto-fix') {
        toast.success(
          `🔧 自動補正 完了 (${json.diff_summary ?? ''} / 概算 $${(
            json.cost_estimate ?? 0
          ).toFixed(3)})`,
        );
      } else if (strategy === 'ignore-warn') {
        toast.success('⏭️ 警告を無視に登録しました');
      }
      await onAfter();
    } catch (e) {
      toast.error(`修復失敗: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  // ボタンの allowed エントリが空 (manual のみ) なら、ボタンを出さず Hint だけ
  if (entry.allowed.length === 0) return null;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={loading}
        className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800
          transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50
          dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100 dark:hover:bg-amber-900/50"
        aria-label="修復オプションを開く"
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Wrench className="h-3 w-3" />
        )}
        {loading ? '処理中…' : '修復'}
      </button>
      {open && (
        <div
          className="absolute right-0 z-10 mt-1 w-56 origin-top-right rounded-md border border-gray-200 bg-white shadow-lg
            dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="py-1">
            {entry.allowed.map((s) => {
              const meta = STRATEGY_LABEL[s];
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleStrategy(s)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-xs transition hover:bg-amber-50 dark:hover:bg-amber-900/30"
                >
                  <span className="text-gray-800 dark:text-gray-100">{meta.label}</span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    {meta.cost} / {meta.time}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="block w-full border-t border-gray-100 px-3 py-1.5 text-center text-[10px] text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            閉じる
          </button>
        </div>
      )}
    </div>
  );
}
