import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendSlackNotification } from '@/lib/notify/slack';

describe('sendSlackNotification', () => {
  const originalEnv = process.env.SLACK_WEBHOOK_URL;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalEnv === undefined) {
      delete process.env.SLACK_WEBHOOK_URL;
    } else {
      process.env.SLACK_WEBHOOK_URL = originalEnv;
    }
    vi.restoreAllMocks();
  });

  it('SLACK_WEBHOOK_URL 未設定時は fetch を呼ばない (no-op)', async () => {
    delete process.env.SLACK_WEBHOOK_URL;

    await sendSlackNotification('hello');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('SLACK_WEBHOOK_URL 設定済の場合 fetch を 1 回 POST する', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/services/XYZ';

    await sendSlackNotification('⚠️ live_hub_stale: article=abc');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.slack.test/services/XYZ');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      text: '⚠️ live_hub_stale: article=abc',
      username: 'blogauto',
      icon_emoji: ':robot_face:',
    });
  });

  it('opts.username / opts.emoji を渡すと body に反映される', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/services/XYZ';

    await sendSlackNotification('hi', { username: 'alert-bot', emoji: ':warning:' });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.username).toBe('alert-bot');
    expect(body.icon_emoji).toBe(':warning:');
  });

  it('fetch が throw しても例外を握りつぶす (caller に影響なし)', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/services/XYZ';
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sendSlackNotification('boom')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[slack notify] failed:',
      expect.any(Error),
    );
  });
});
