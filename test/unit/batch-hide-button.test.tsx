// @vitest-environment jsdom

/**
 * BatchHideButton 単体テスト (J10)
 * --------------------------------
 * - candidatesCount のバッジ表示
 * - モーダル開閉
 * - 確認文字列 "HIDE_ALL_SOURCE" による「実行」ボタン enable/disable
 * - dry-run / 本実行 で `/api/articles/batch-hide-source` への正しい POST
 * - 結果ペイン表示と onCompleted callback の発火
 * - fetch エラー時のエラー表示
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import BatchHideButton, {
  type BatchHideResult,
} from '@/components/articles/BatchHideButton';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * fetch をモックして、JSON ペイロードを返す Response 互換オブジェクトを返す。
 */
function mockFetchOk(body: Partial<BatchHideResult>) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = fetchMock;
  return fetchMock;
}

function mockFetchReject(message = 'network down') {
  const fetchMock = vi.fn().mockRejectedValue(new Error(message));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = fetchMock;
  return fetchMock;
}

/** トリガーボタン（最初の「既存ソースを一括非表示」）を押してモーダルを開く */
function openModal() {
  const triggers = screen.getAllByRole('button', { name: /既存ソースを一括非表示/ });
  // トリガーは 1 つだけ存在するはず（モーダルが閉じている前提）
  fireEvent.click(triggers[0]);
}

/** 確認文字列を入力する */
function typeConfirmText(text: string) {
  const input = screen.getByPlaceholderText('HIDE_ALL_SOURCE') as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  return input;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('BatchHideButton', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // 1. props.candidatesCount を表示
  it('candidatesCount をトリガーボタンのバッジに表示する', () => {
    render(<BatchHideButton candidatesCount={42} />);
    const trigger = screen.getByRole('button', { name: /既存ソースを一括非表示/ });
    expect(within(trigger).getByText('42')).toBeInTheDocument();
  });

  it('candidatesCount=0 のときバッジを表示しない', () => {
    render(<BatchHideButton candidatesCount={0} />);
    const trigger = screen.getByRole('button', { name: /既存ソースを一括非表示/ });
    // 0 はバッジに描画されない仕様
    expect(within(trigger).queryByText('0')).not.toBeInTheDocument();
  });

  // 2. ボタンクリック → モーダル表示
  it('トリガーボタンクリックで確認モーダルが開く', () => {
    render(<BatchHideButton candidatesCount={5} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    openModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('既存記事を一括非表示にしますか？')).toBeInTheDocument();
  });

  // 3. HIDE_ALL_SOURCE 入力なし → 「実行」ボタン disabled
  it('確認文字列が一致しないと「実行」「dry-run で確認」が disabled', () => {
    render(<BatchHideButton candidatesCount={5} />);
    openModal();

    const dialog = screen.getByRole('dialog');
    const runButton = within(dialog).getByRole('button', { name: '実行' });
    const dryButton = within(dialog).getByRole('button', { name: 'dry-run で確認' });

    expect(runButton).toBeDisabled();
    expect(dryButton).toBeDisabled();

    // 違う文字列を入れても無効
    typeConfirmText('hide_all_source'); // 小文字は不可
    expect(runButton).toBeDisabled();
    expect(dryButton).toBeDisabled();
  });

  // 4. HIDE_ALL_SOURCE 入力 → 「実行」ボタン enabled
  it('確認文字列が "HIDE_ALL_SOURCE" と一致すると「実行」「dry-run で確認」が enabled', () => {
    render(<BatchHideButton candidatesCount={5} />);
    openModal();
    typeConfirmText('HIDE_ALL_SOURCE');

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: '実行' })).not.toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'dry-run で確認' })).not.toBeDisabled();
  });

  // 5. 「dry-run で確認」クリック → POST {confirm:'HIDE_ALL_SOURCE', dry_run:true}
  it('「dry-run で確認」クリックで dry_run:true を含む POST を送る', async () => {
    const fetchMock = mockFetchOk({
      hidden: 3,
      ids: ['a', 'b', 'c'],
      hub_rebuild_status: 'skipped',
      dry_run: true,
    });

    render(<BatchHideButton candidatesCount={3} />);
    openModal();
    typeConfirmText('HIDE_ALL_SOURCE');

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'dry-run で確認' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/articles/batch-hide-source');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ confirm: 'HIDE_ALL_SOURCE', dry_run: true });
  });

  // 6. 「実行」クリック → POST {confirm:'HIDE_ALL_SOURCE'}
  it('「実行」クリックで dry_run を含まない POST を送る', async () => {
    const fetchMock = mockFetchOk({
      hidden: 5,
      ids: ['1', '2', '3', '4', '5'],
      hub_rebuild_status: 'ok',
    });

    render(<BatchHideButton candidatesCount={5} />);
    openModal();
    typeConfirmText('HIDE_ALL_SOURCE');

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '実行' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/articles/batch-hide-source');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ confirm: 'HIDE_ALL_SOURCE' });
    expect(body).not.toHaveProperty('dry_run');
  });

  // 7. 結果 hidden:5, ids:[...] 受信 → 結果ペイン表示 + onCompleted callback 呼出
  it('本実行成功時に結果ペインを表示し onCompleted を呼び出す', async () => {
    mockFetchOk({
      hidden: 5,
      ids: ['id-1', 'id-2', 'id-3', 'id-4', 'id-5'],
      hub_rebuild_status: 'ok',
    });
    const onCompleted = vi.fn();

    render(<BatchHideButton candidatesCount={5} onCompleted={onCompleted} />);
    openModal();
    typeConfirmText('HIDE_ALL_SOURCE');

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '実行' }));

    // 結果ペイン
    await waitFor(() => {
      expect(screen.getByText('一括非表示を実行しました')).toBeInTheDocument();
    });
    expect(screen.getByText(/hidden: 5/)).toBeInTheDocument();
    expect(screen.getByText(/id-1, id-2, id-3, id-4, id-5/)).toBeInTheDocument();
    expect(screen.getByText(/hub_rebuild_status: ok/)).toBeInTheDocument();

    // コールバック
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        hidden: 5,
        ids: ['id-1', 'id-2', 'id-3', 'id-4', 'id-5'],
        hub_rebuild_status: 'ok',
      }),
    );
  });

  it('dry-run 成功時は onCompleted を呼ばず dry-run 用の結果ペインを表示する', async () => {
    mockFetchOk({
      hidden: 3,
      ids: ['a', 'b', 'c'],
      hub_rebuild_status: 'skipped',
      dry_run: true,
    });
    const onCompleted = vi.fn();

    render(<BatchHideButton candidatesCount={3} onCompleted={onCompleted} />);
    openModal();
    typeConfirmText('HIDE_ALL_SOURCE');

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'dry-run で確認' }));

    await waitFor(() => {
      expect(screen.getByText('[dry-run] 対象件数を確認しました')).toBeInTheDocument();
    });
    expect(onCompleted).not.toHaveBeenCalled();
  });

  // 8. fetch エラー → エラー表示
  it('fetch reject 時にエラーメッセージを表示する', async () => {
    mockFetchReject('network down');

    render(<BatchHideButton candidatesCount={5} />);
    openModal();
    typeConfirmText('HIDE_ALL_SOURCE');

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '実行' }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('エラー: network down');
    });
  });

  it('HTTP エラー時にレスポンスの error フィールドを表示する', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal failure' }),
    });

    render(<BatchHideButton candidatesCount={5} />);
    openModal();
    typeConfirmText('HIDE_ALL_SOURCE');

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '実行' }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('エラー: internal failure');
    });
  });
});
