export function renderSoftWithdrawalHtml(opts: { title?: string; hubUrl?: string } = {}): string {
  const title = opts.title ?? '記事は現在公開されていません';
  const hubUrl = opts.hubUrl ?? '/column/';
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,noarchive,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} | Harmony Column</title>
<style>
  body{font-family:sans-serif;background:#faf3ed;color:#53352b;margin:0;padding:2rem;display:flex;min-height:80vh;align-items:center;justify-content:center;text-align:center}
  main{max-width:36rem}
  h1{color:#8b6f5e;font-size:1.25rem;margin:0 0 1rem}
  a{color:#8b6f5e}
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p>この記事は現在ご覧いただけません。</p>
  <p><a href="${escapeAttr(hubUrl)}">コラム一覧に戻る</a></p>
</main>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
