'use client';

export default function StickyCtaBar() {
  return (
    <>
      <style>{`
        .sticky-cta-bar{position:fixed;bottom:0;left:0;right:0;z-index:9999;background:rgba(250,243,237,0.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid rgba(179,149,120,0.3);padding:10px 12px;display:flex;justify-content:center;gap:8px}
        .sticky-cta-bar a{display:inline-flex;align-items:center;gap:4px;padding:8px 14px;border-radius:99px;font-size:.78rem;font-weight:600;text-decoration:none;white-space:nowrap;transition:transform .15s,box-shadow .2s;line-height:1}
        .sticky-cta-bar a:hover{transform:translateY(-1px);box-shadow:0 3px 10px rgba(0,0,0,.12)}
        .sticky-cta-bar .cta-booking{background:linear-gradient(135deg,#d4a574,#c4856e);color:#fff;box-shadow:0 2px 8px rgba(212,165,116,0.4)}
        .sticky-cta-bar .cta-counseling{background:#53352b;color:#fff;box-shadow:0 2px 8px rgba(83,53,43,0.3)}
        .sticky-cta-bar .cta-contact{background:#fff;color:#53352b;border:1.5px solid #8b6f5e}
        @media(max-width:359px){.sticky-cta-bar{gap:5px;padding:8px}.sticky-cta-bar a{padding:7px 10px;font-size:.72rem;gap:2px}}
      `}</style>
      <div className="sticky-cta-bar">
        <a href="https://harmony-booking.web.app/" className="cta-booking" target="_blank" rel="noopener">
          📅 予約する
        </a>
        <a href="https://harmony-mc.com/counseling/" className="cta-counseling">
          ✨ カウンセリング
        </a>
        <a href="https://harmony-mc.com/contact/" className="cta-contact">
          💬 お問い合わせ
        </a>
      </div>
    </>
  );
}
