# Hub Rebuild Guarantee — QA & Rollback Runbook

Owner: UI + Deploy pipeline
Companion doc: [`hub-rebuild-guarantee.md`](./hub-rebuild-guarantee.md) — the spec itself. This runbook is the operational layer on top of it.
Status: Active 2026-04-22

Scope: pre-deploy checks, post-deploy manual verification, failure triage, rollback, and first-24h monitoring for the hub-rebuild-guarantee change (awaited `/api/hub/deploy` + always-run-as-final-step on bulk deploy).

---

## 1. Pre-deploy sanity

All four must be green before merging to `main`.

| # | Command | Expected |
|---|---|---|
| 1 | `npm run build` | exits 0, no type errors, no missing module warnings |
| 2 | `npx tsc --noEmit` | exits 0 (no TS diagnostics) |
| 3 | `npm run test -- hub-rebuild` | green — runs the unit + UI-unit suites listed in §6.1 / §6.2 of the spec |
| 4 | `grep -rn "ftp.remove\|client.remove\|\.delete(" src/lib/deploy/` | **0 matches** — proves FTP_NO_DELETE invariant (§7 of the spec) is still intact. If any match appears, stop and investigate before merging. |

E2E (`test/e2e/hub-rebuild.spec.ts`, §6.3 of the spec) runs under `FTP_DRY_RUN=true` + `MONKEY_TEST=true`; include it in the PR CI step when available.

---

## 2. Post-deploy manual verification

Run these against **production** (`harmony-mc.com`) immediately after the Vercel deploy promotes. The full run takes ~5 minutes.

1. Log in to the dashboard (`/admin` → Supabase auth).
2. Navigate to **記事一覧** (`/dashboard/articles`).
3. Pick a real article currently on the public hub — **article 43** is the canonical smoke target since it triggered this work. Note its title in your QA log.
4. Open `https://harmony-mc.com/spiritual/column/index.html` in a **private window** (bypasses CDN/browser cache). Confirm the article appears in the listing.
5. Back in the dashboard, **uncheck 確認** on that article. Wait for the banner.
6. **Expected:** green banner `ハブ再生成: OK (Xページ, Y記事, Zms)` within ~10 s. Checkbox returns to enabled state.
7. **Hard-refresh** (Cmd-Shift-R) the public hub in the private window. Expected: the article is gone.
8. **Re-check 確認** on the same article. Expected: another `ハブ再生成: OK` banner; hard-refresh → article returns within 10 s.
9. **Uncheck again**, then click **サーバーに更新**. Expected banner:
   ```
   0 件デプロイ成功（未確認スキップ: N 件）／ハブ再生成: OK
   ```
   Hard-refresh hub → article is excluded. This proves §4.2 step 4 (unconditional final rebuild) works even with zero eligible articles.
10. **Restore 確認** on the article before leaving the dashboard. Confirm it is visible on the public hub one more time. Do not leave a production article in an unintended state.

If any step's expected output does not match, treat it as a regression and go to §4 (Rollback).

---

## 3. Failure-mode diagnosis

Banner failures match the `HubDeployResponse` `stage` contract (spec §4.3). First two investigation targets per stage:

| Banner | First thing to check | Second thing to check |
|---|---|---|
| `ハブ再生成: FAIL [auth]` | Supabase session cookie (DevTools → Application → Cookies → `sb-*`; expired? absent?) | `src/middleware.ts` / auth middleware — any recent change to session validation or cookie domain |
| `ハブ再生成: FAIL [query]` | Supabase project status (Supabase dashboard → Project Health — outage? paused?) | `articles` table migration state — latest applied migration in `supabase/migrations/` vs. `supabase_migrations.schema_migrations` |
| `ハブ再生成: FAIL [ftp]` | FTP creds — check both `settings` table (admin UI → 設定) **and** `.env.local` fallback for `FTP_HOST / FTP_USER / FTP_PASSWORD` drift | `harmony-mc.com` FTP host reachability (`nc -zv ftp.harmony-mc.com 21`) + the 120 s timeout in `/api/hub/deploy` — a long-running upload can hit the Vercel function limit |
| `ハブ再生成: FAIL [generate]` | `buildArticleCards` errors in Vercel function logs — most likely a malformed `image_files` JSON on a newly imported article | Recent changes to `src/lib/generators/hub-generator.ts` (template fields, card schema) |
| `ハブ再生成: FAIL [unknown]` | Vercel function logs for `/api/hub/deploy` — look for the stack trace of the throw that escaped the `stage` switch | Likely a new bug outside the mapped stages; capture the trace and file an issue before retrying |

In all cases: the DB change (the `reviewed_at` toggle) already committed; only the hub FTP upload failed. Re-trigger by toggling 確認 again or clicking サーバーに更新 once the underlying cause is fixed.

---

## 4. Rollback

If the change causes a regression in production:

1. **Revert the merge commit** on `main`:
   ```bash
   git revert <merge-sha>
   git push origin main
   ```
   Vercel auto-deploys the revert within ~2 min.
2. The old fire-and-forget behavior returns. That is a **strictly safer** fallback than leaving a broken awaited-rebuild in place — at worst the hub stays stale until the next manual `サーバーに更新`, which was the pre-change status quo.
3. **No DB migration rollback needed** — this change adds no schema. `supabase/migrations/` is untouched.
4. **No FTP cleanup needed** — the change performs no deletions (FTP_NO_DELETE invariant, see §7 of the spec). Any `index.html` / `page/*/index.html` written by a half-successful rebuild is simply overwritten on the next successful one.
5. Post-revert: re-run §2 steps 1–4 to confirm the pre-change baseline (hub listing matches reviewed articles) still holds.

---

## 5. Monitoring — first 24 h post-deploy

Watch these in Vercel function logs for `/api/hub/deploy`. Set a calendar reminder for T+24 h to review.

- [ ] **`[deploy] ハブページデプロイ開始` frequency** — expect a spike immediately after deploy (QA traffic), then steady-state matching user checkbox activity. A sudden drop to zero suggests the client helper silently stopped calling the API.
- [ ] **`success=false` rate by `stage`** — group log entries by the `stage` field. Any single stage > 5 % of calls in a 1 h window → investigate per §3. `ftp` failures > `auth`/`query` failures is the expected ordering; invert that and something is wrong upstream.
- [ ] **`durationMs` p95** — log or chart the `durationMs` field from successful responses. Investigate if p95 > 90 s (approaching the 120 s function timeout defined in the spec §4.3). A slow hub rebuild that finishes today will start timing out after the next article count bump.
- [ ] **Banner-visible errors reported by the operator** — the operator (小林由起子さん or QA) is the canary; any red banner seen in normal use should be triaged within the same day, not batched.

If all four checks are clean at T+24 h, close the rollout and archive this runbook section with the sign-off date.
