# Hub Rebuild Guarantee Spec

Owner: UI + Deploy pipeline
Status: Draft → Implementing 2026-04-22
Trigger: Article 43 bug — unchecking 確認 and pressing サーバーに更新 left article visible on harmony-mc.com/spiritual/column/index.html.

## 1. Problem

Current behavior in `src/app/(dashboard)/dashboard/articles/page.tsx`:

1. **Checkbox handler (line 663-687)** flips `reviewed_at`, then calls `/api/hub/deploy` fire-and-forget:
   ```ts
   fetch('/api/hub/deploy', { method: 'POST' }).catch(() => {});
   ```
   Any failure (auth drop, 120 s timeout, FTP down, network blip) is silently swallowed. UI reports success without confirming.

2. **サーバーに更新 button (line 103-153)** filters to reviewed articles, then early-returns when `reviewed.length === 0`:
   ```ts
   if (reviewed.length === 0) {
     setBulkDeployResult(`デプロイ対象の確認済み記事がありません…`);
     return; // ← hub rebuild NEVER happens
   }
   ```
   So when the user unchecks every flag and presses the button, the hub stays stale.

3. **Error handling on `/api/articles?status=published` fetch (line 109-111)** has no `res.ok` check — a 401 / 500 / timeout returns `[]` and looks identical to "no articles".

The hub generator itself (`src/lib/generators/hub-generator.ts:427-432`) filters correctly by `status='published' AND reviewed_at IS NOT NULL`. The bug is upstream — the rebuild either doesn't run, or runs silently and fails.

## 2. Goals

- **G1.** Every state change that affects hub-eligibility triggers a rebuild whose success or failure is visible to the user.
- **G2.** `サーバーに更新` always rebuilds the hub as its final step — even when zero articles are eligible, even when all per-article deploys failed.
- **G3.** No silent `.catch(() => {})` for hub rebuild calls.
- **G4.** `/api/hub/deploy` returns a structured response the UI can surface (success: counts + timing; failure: stage + detail).
- **G5.** The existing FTP_NO_DELETE invariant and `reviewed_at` deploy gate remain untouched.

## 3. Non-goals

- Publish Control V2 activation (still gated behind `PUBLISH_CONTROL_V2=on`, unchanged).
- Physical file deletion on FTP. Hub rebuild overwrites `index.html`/`page/*/index.html`; stale per-article files stay (existing design).
- Article HTML regeneration — only hub listing changes here.
- No new third-party toast libs. Reuse the `bulkDeployResult` banner pattern.

## 4. Behavioral contract

### 4.1 Checkbox toggle (確認 on ↔ off)

1. PUT `/api/articles/[id]` with new `reviewed_at` (unchanged).
2. Optimistically update local state.
3. `await` `/api/hub/deploy`; check `res.ok` AND `body.success`.
4. On rebuild failure: keep DB change, show red banner with stage + detail, include retry button.
5. On success: subtle green banner (auto-dismiss 3 s).
6. During rebuild: checkbox is `disabled`, shows spinner.

### 4.2 `サーバーに更新` (handleBulkDeploy)

Flow — **hub rebuild is the FINAL step, unconditional**:

1. Fetch `/api/articles?status=published&limit=200`, check `res.ok`; abort with error banner on non-2xx.
2. Split into `reviewed` / `skipped`.
3. For each `reviewed` article, POST `/api/articles/[id]/deploy`; aggregate ok/fail counts.
4. **Always** POST `/api/hub/deploy` as the final step, regardless of (a) zero reviewed, (b) partial article failures.
5. Compose a single result line:
   ```
   {deployed} 件デプロイ成功、{failed} 件失敗（未確認スキップ: {skipped}）／ハブ再生成: {OK|FAIL — {detail}}
   ```

### 4.3 `/api/hub/deploy` response contract

```ts
type HubDeployResponse =
  | { success: true;  pages: number; articles: number; uploaded: number; durationMs: number }
  | { success: false; error: string; stage: 'auth' | 'query' | 'generate' | 'ftp'; detail?: string; durationMs: number };
```

HTTP status: always 200 when the handler ran; `success: false` rides in the body. This makes the UI path uniform (no need to distinguish "API crashed" vs "FTP refused"). Hard 5xx is still possible for framework-level crashes.

### 4.4 `/api/articles` list fetch hardening

On the UI side, the list fetch at page.tsx:109 must:
- Check `res.ok`; on non-2xx throw to the outer catch (surface the HTTP status).
- Validate `freshData.data` is an array; otherwise abort with banner.

## 5. Implementation modules

| Module | File | Responsibility |
|---|---|---|
| Contract types | `src/types/hub-deploy.ts` | `HubDeployResponse` union |
| Client helper | `src/lib/deploy/hub-rebuild-client.ts` | `rebuildHub(): Promise<HubDeployResponse>` — awaited fetch, `res.ok` + body.success check, typed errors |
| API hub route | `src/app/api/hub/deploy/route.ts` | Return `HubDeployResponse` shape, include `durationMs`, track `stage` per failure |
| UI page | `src/app/(dashboard)/dashboard/articles/page.tsx` | Checkbox handler awaits rebuild; `handleBulkDeploy` always calls `rebuildHub` as final step |
| Articles list hardening | `src/app/(dashboard)/dashboard/articles/page.tsx` | `res.ok` check + typed body validation |

## 6. Tests

### 6.1 Unit (`test/unit/hub-rebuild-client.test.ts`)

- `rebuildHub()` returns success envelope on 200+`{success:true}`.
- `rebuildHub()` returns failure envelope on 200+`{success:false, stage:'ftp'}`.
- `rebuildHub()` returns failure envelope on 5xx (maps to `stage:'unknown'`).
- `rebuildHub()` returns failure envelope on network throw.

### 6.2 UI unit (`test/unit/bulk-deploy-hub-rebuild.test.ts`)

- `handleBulkDeploy` with 0 reviewed → still calls `rebuildHub` once, then sets banner that includes `ハブ再生成: OK`.
- `handleBulkDeploy` with rebuild failure → banner includes `ハブ再生成: FAIL`.

### 6.3 E2E (`test/e2e/hub-rebuild.spec.ts`)

Environment: `FTP_DRY_RUN=true`, `MONKEY_TEST=true`, `monkey-` slugs only (per `ftp-uploader.ts:151-167`).

Scenarios:
1. Uncheck a monkey article's 確認 → expect awaited toast "ハブ再生成: OK" → expect dry-run output dir's `index.html` no longer contains that slug.
2. Click サーバーに更新 with all monkey articles unreviewed → expect banner shows `0 件デプロイ成功` AND `ハブ再生成: OK` (not early-return).
3. Force-error scenario (mock `/api/hub/deploy` to return `{success:false, stage:'ftp'}`) → banner shows `ハブ再生成: FAIL — <detail>`.

### 6.4 Manual QA checklist

- [ ] Uncheck article 43 in prod UI → hub/deploy fires, banner confirms, refresh harmony-mc.com/spiritual/column/index.html → article 43 is gone.
- [ ] Re-check article 43 → hub rebuilds, article 43 returns.
- [ ] Uncheck ALL articles, press サーバーに更新 → banner shows "0 件デプロイ成功 ／ ハブ再生成: OK" → hub index.html shows only reviewed articles (possibly empty).
- [ ] Disconnect network during rebuild → banner shows red "ハブ再生成: FAIL — …", DB state unchanged.

## 7. Non-regression checks

- FTP uploader (`src/lib/deploy/ftp-uploader.ts`) has no new delete call. Keep `assertSafeTarget` gate intact.
- `reviewed_at` gate in `src/app/api/articles/[id]/deploy/route.ts:42-47` unchanged.
- Hub generator query (`src/lib/generators/hub-generator.ts:427-432`) unchanged.
- Article revisions INSERT path (HTML History Rule) untouched — hub rebuild does not write article HTML.

## 8. Rollout

1. Land via normal PR to `main`.
2. No feature flag; hub rebuild reliability is strictly better than current.
3. After merge, run manual QA checklist §6.4.
