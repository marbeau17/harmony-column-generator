// ============================================================================
// src/app/(dashboard)/dashboard/publish-events/page.tsx
// publish_events 観察ダッシュボード
// 仕様: docs/optimized_spec.md §2.3 #8 / AC-P3-8〜P3-11
// ----------------------------------------------------------------------------
// - レンジ選択 (24h / 7d / 30d) → /api/publish-events?range=... から集計取得
// - カード: 集計 / ハブデプロイ状況 / 失敗イベント直近 10 件
// - 追加カード（include=hallucination,tone）:
//     ハルシネーション概況 / 由起子トーン概況
// - 読み取りのみ。既存 publish-control コアは触らない。
// - TailwindCSS の `dark:` を併記（グローバル CLAUDE.md ルール）
// ============================================================================
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import GenerationModeBadge from '@/components/articles/GenerationModeBadge';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

type RangeKey = '24h' | '7d' | '30d';

interface FailedEvent {
  id: number;
  article_id: string;
  action: string;
  hub_deploy_error: string | null;
  actor_email: string | null;
  created_at: string;
  article?: { generation_mode: string | null } | null;
  generation_mode?: string | null;
}

interface HallucinationArticle {
  id: string;
  title: string | null;
  hallucination_score: number | null;
}

interface ToneArticle {
  id: string;
  title: string | null;
  yukiko_tone_score: number | null;
}

interface HallucinationSummary {
  avgScore: number | null;
  criticalCount: number;
  criticalArticles: HallucinationArticle[];
}

interface ToneSummary {
  avgScore: number | null;
  lowCount: number;
  lowArticles: ToneArticle[];
}

interface SummaryResponse {
  range: RangeKey;
  totalEvents: number;
  byAction: Record<string, number>;
  byHubStatus: Record<string, number>;
  failedRecent: FailedEvent[];
  hallucination?: HallucinationSummary;
  tone?: ToneSummary;
}

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: '24h', label: '直近 24 時間' },
  { key: '7d', label: '直近 7 日' },
  { key: '30d', label: '直近 30 日' },
];

const TONE_LOW_THRESHOLD = 0.8;

// ─── ユーティリティ ─────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function sortedEntries(
  record: Record<string, number>,
): [string, number][] {
  return Object.entries(record).sort((a, b) => b[1] - a[1]);
}

function formatScore(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toFixed(digits);
}

// ─── ページコンポーネント ────────────────────────────────────────────────────

export default function PublishEventsPage() {
  const [range, setRange] = useState<RangeKey>('24h');
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async (target: RangeKey) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/publish-events?range=${target}&include=hallucination,tone`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as SummaryResponse;
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary(range);
  }, [range, fetchSummary]);

  // 失敗率 = failed / (total of byHubStatus)
  const failureRate = useMemo(() => {
    if (!data) return 0;
    const total = Object.values(data.byHubStatus).reduce((a, b) => a + b, 0);
    if (total === 0) return 0;
    const failed = data.byHubStatus['failed'] ?? 0;
    return Math.round((failed / total) * 1000) / 10; // 小数 1 桁
  }, [data]);

  // ─── 共通スタイル（ダーク対応） ────────────────────────────────────────
  const cardClass =
    'rounded-xl border border-gray-200 bg-white p-4 sm:p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900';
  const cardTitleClass =
    'text-sm font-semibold text-gray-800 mb-3 dark:text-gray-100';
  const thClass =
    'text-left text-xs font-medium text-gray-500 pb-2 border-b border-gray-200 dark:text-gray-400 dark:border-gray-700';
  const tdClass =
    'py-2 text-sm text-gray-700 border-b border-gray-100 dark:text-gray-200 dark:border-gray-800';

  return (
    <div className="space-y-6">
      {/* ページヘッダー */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">
          イベント監視
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          publish_events テーブルの集計結果を表示します（読み取り専用）
        </p>
      </div>

      {/* レンジ選択 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          集計期間:
        </span>
        {RANGE_OPTIONS.map((opt) => {
          const active = range === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-brand-500 text-white dark:bg-brand-600'
                  : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
        <button
          onClick={() => fetchSummary(range)}
          disabled={loading}
          className="ml-auto rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {loading ? '読み込み中...' : '再読み込み'}
        </button>
      </div>

      {/* エラー */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          エラー: {error}
        </div>
      )}

      {/* ローディング（初回のみフルスクリーンっぽく） */}
      {loading && !data && (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-brand-500 dark:border-gray-700 dark:border-t-brand-400" />
            <p className="text-sm text-gray-400 dark:text-gray-500">
              集計を読み込み中...
            </p>
          </div>
        </div>
      )}

      {/* データ表示 */}
      {data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* ── カード 1: 集計（totalEvents + byAction） ───────────── */}
          <section className={cardClass}>
            <h2 className={cardTitleClass}>集計</h2>
            <div className="mb-4">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                総イベント数
              </div>
              <div className="text-3xl font-bold text-brand-600 dark:text-brand-300">
                {data.totalEvents.toLocaleString()}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
                アクション別
              </h3>
              {sortedEntries(data.byAction).length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  対象期間にイベントはありません
                </p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={thClass}>action</th>
                      <th className={`${thClass} text-right`}>件数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries(data.byAction).map(([action, count]) => (
                      <tr key={action}>
                        <td className={tdClass}>{action}</td>
                        <td className={`${tdClass} text-right font-medium`}>
                          {count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* ── カード 2: ハブデプロイ状況 ─────────────────────────── */}
          <section className={cardClass}>
            <h2 className={cardTitleClass}>ハブデプロイ状況</h2>
            <div className="mb-4">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                失敗率
              </div>
              <div
                className={`text-3xl font-bold ${
                  failureRate === 0
                    ? 'text-emerald-600 dark:text-emerald-300'
                    : failureRate < 5
                      ? 'text-amber-600 dark:text-amber-300'
                      : 'text-red-600 dark:text-red-300'
                }`}
              >
                {failureRate.toFixed(1)}%
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
                hub_deploy_status 別
              </h3>
              {sortedEntries(data.byHubStatus).length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  対象期間にイベントはありません
                </p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={thClass}>status</th>
                      <th className={`${thClass} text-right`}>件数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries(data.byHubStatus).map(([status, count]) => {
                      const color =
                        status === 'success'
                          ? 'text-emerald-600 dark:text-emerald-300'
                          : status === 'failed'
                            ? 'text-red-600 dark:text-red-300'
                            : 'text-gray-700 dark:text-gray-200';
                      return (
                        <tr key={status}>
                          <td className={`${tdClass} ${color} font-medium`}>
                            {status}
                          </td>
                          <td className={`${tdClass} text-right font-medium`}>
                            {count.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* ── カード 3: 失敗イベント直近 10 件（全幅） ───────────── */}
          <section className={`${cardClass} lg:col-span-2`}>
            <h2 className={cardTitleClass}>失敗イベント（直近 10 件）</h2>
            {data.failedRecent.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">
                対象期間に失敗イベントはありません
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px]">
                  <thead>
                    <tr>
                      <th className={thClass}>発生時刻</th>
                      <th className={thClass}>article_id</th>
                      <th className={thClass}>mode</th>
                      <th className={thClass}>action</th>
                      <th className={thClass}>actor</th>
                      <th className={thClass}>error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.failedRecent.map((ev) => (
                      <tr key={ev.id}>
                        <td className={`${tdClass} whitespace-nowrap`}>
                          {formatDateTime(ev.created_at)}
                        </td>
                        <td
                          className={`${tdClass} font-mono text-xs`}
                          title={ev.article_id}
                        >
                          {ev.article_id.slice(0, 8)}...
                        </td>
                        <td className={tdClass}>
                          <GenerationModeBadge
                            mode={
                              ev.article?.generation_mode ??
                              ev.generation_mode ??
                              null
                            }
                            size="sm"
                          />
                        </td>
                        <td className={tdClass}>{ev.action}</td>
                        <td className={`${tdClass} text-xs`}>
                          {ev.actor_email ?? '-'}
                        </td>
                        <td
                          className={`${tdClass} max-w-sm truncate text-xs text-red-600 dark:text-red-300`}
                          title={ev.hub_deploy_error ?? ''}
                        >
                          {ev.hub_deploy_error ?? '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── カード 4: ハルシネーション概況（全幅） ───────────── */}
          {data.hallucination && (
            <section className={`${cardClass} lg:col-span-2`}>
              <h2 className={cardTitleClass}>ハルシネーション概況</h2>

              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    全記事 hallucination_score 平均
                  </div>
                  <div className="text-3xl font-bold text-brand-600 dark:text-brand-300">
                    {formatScore(data.hallucination.avgScore)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    critical claim 残存記事数（block 候補）
                  </div>
                  <div
                    className={`text-3xl font-bold ${
                      data.hallucination.criticalCount === 0
                        ? 'text-emerald-600 dark:text-emerald-300'
                        : 'text-red-600 dark:text-red-300'
                    }`}
                  >
                    {data.hallucination.criticalCount.toLocaleString()}
                  </div>
                </div>
              </div>

              <h3 className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
                critical 残存記事（hallucination_score 降順、最大 10 件）
              </h3>
              {data.hallucination.criticalArticles.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  critical claim を持つ記事はありません
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px]">
                    <thead>
                      <tr>
                        <th className={thClass}>article_id</th>
                        <th className={thClass}>title</th>
                        <th className={`${thClass} text-right`}>
                          hallucination_score
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.hallucination.criticalArticles.map((a) => (
                        <tr key={a.id}>
                          <td
                            className={`${tdClass} font-mono text-xs`}
                            title={a.id}
                          >
                            {a.id.slice(0, 8)}...
                          </td>
                          <td className={`${tdClass} max-w-md truncate`} title={a.title ?? ''}>
                            {a.title ?? '(無題)'}
                          </td>
                          <td
                            className={`${tdClass} text-right font-mono text-sm font-semibold text-red-600 dark:text-red-300`}
                          >
                            {formatScore(a.hallucination_score)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ── カード 5: 由起子トーン概況（全幅） ───────────── */}
          {data.tone && (
            <section className={`${cardClass} lg:col-span-2`}>
              <h2 className={cardTitleClass}>由起子トーン概況</h2>

              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    全記事 yukiko_tone_score 平均
                  </div>
                  <div
                    className={`text-3xl font-bold ${
                      data.tone.avgScore === null
                        ? 'text-gray-400 dark:text-gray-500'
                        : data.tone.avgScore >= TONE_LOW_THRESHOLD
                          ? 'text-emerald-600 dark:text-emerald-300'
                          : 'text-amber-600 dark:text-amber-300'
                    }`}
                  >
                    {formatScore(data.tone.avgScore)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    tone &lt; {TONE_LOW_THRESHOLD.toFixed(2)} 記事数
                  </div>
                  <div
                    className={`text-3xl font-bold ${
                      data.tone.lowCount === 0
                        ? 'text-emerald-600 dark:text-emerald-300'
                        : 'text-amber-600 dark:text-amber-300'
                    }`}
                  >
                    {data.tone.lowCount.toLocaleString()}
                  </div>
                </div>
              </div>

              <h3 className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
                低トーン記事（yukiko_tone_score 昇順、最大 10 件）
              </h3>
              {data.tone.lowArticles.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  tone &lt; {TONE_LOW_THRESHOLD.toFixed(2)} の記事はありません
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px]">
                    <thead>
                      <tr>
                        <th className={thClass}>article_id</th>
                        <th className={thClass}>title</th>
                        <th className={`${thClass} text-right`}>
                          yukiko_tone_score
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.tone.lowArticles.map((a) => (
                        <tr key={a.id}>
                          <td
                            className={`${tdClass} font-mono text-xs`}
                            title={a.id}
                          >
                            {a.id.slice(0, 8)}...
                          </td>
                          <td className={`${tdClass} max-w-md truncate`} title={a.title ?? ''}>
                            {a.title ?? '(無題)'}
                          </td>
                          <td
                            className={`${tdClass} text-right font-mono text-sm font-semibold text-amber-600 dark:text-amber-300`}
                          >
                            {formatScore(a.yukiko_tone_score)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
