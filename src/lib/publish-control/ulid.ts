// P5-43 Step 3: ULID 生成ヘルパー（クライアント用）
//
// バックエンドの isValidRequestId は /^[0-9A-HJKMNP-TV-Z]{26}$/i を要求するため、
// Crockford's base32 (I/L/O/U 除外) で 26 文字を生成する必要がある。
// Math.random はサーバ送信前に乱用されるが requestId は冪等性キー用途のみで
// 暗号学的強度は不要。衝突確率は実運用で無視できる。
//
// 元実装: src/components/articles/PublishButton.tsx (P5-39)
// PublishButton と新 review API クライアント (articles/page.tsx) で共有する。

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeCrockford(num: number, len: number): string {
  let s = '';
  let n = num;
  for (let i = 0; i < len; i++) {
    s = CROCKFORD[n % 32] + s;
    n = Math.floor(n / 32);
  }
  return s;
}

export function ulid(): string {
  const t = encodeCrockford(Date.now(), 10);
  const r = Array.from({ length: 16 }, () =>
    CROCKFORD.charAt(Math.floor(Math.random() * 32)),
  ).join('');
  return (t + r).slice(0, 26);
}
