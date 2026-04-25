/**
 * シンプルな Slack incoming webhook 通知。
 * SLACK_WEBHOOK_URL 未設定時は no-op（CI / dev で安全）。
 */
export async function sendSlackNotification(
  text: string,
  opts?: { username?: string; emoji?: string },
): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return; // no-op
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        username: opts?.username || 'blogauto',
        icon_emoji: opts?.emoji || ':robot_face:',
      }),
    });
  } catch (err) {
    console.error('[slack notify] failed:', err);
  }
}
