# FilsPay — Submission Guide & Readiness Tracker

Source: `FilsPay_Submission_Guidelines.pdf` (4 pages), analysed 2026-10-30.
**Deadline: Friday, 11 pm. After that, nothing can change: code, server, documents or slides.**

---

## 1. The four deliverables

| # | Deliverable | Exact requirement | Current status | To do |
|---|---|---|---|---|
| 1 | **Submission document** | One PDF named **`TeamName_FilsPay_Submission.pdf`**, in the fixed structure of section 2 below | Raw material exists (`EXPLANATIONS.md`, `EXECUTION_PLAN.md`, `AGENT_ARCHITECTURE.md`), but nothing is in the required structure yet | Write it in the order given below, then export to PDF |
| 2 | **Slide deck** | One PDF named **`TeamName_FilsPay_Slides.pdf`**; 4-minute pitch + 7 minutes of questions if you reach the final | Not started | Build the 8 slides in section 3 below |
| 3 | **Repository link** | Link to **your own public fork**, not the original repo. Judged on the **last version saved before 11 pm**. Must include your **AI setup files**: agent instructions, custom commands, tool configuration, permission rules, helper scripts | Fork exists: `https://github.com/7assanyahya/fils-pay`. Work is on branch **`7asn`** (in sync with `origin/7asn`). **`origin/main` is behind** at `71f20dc`. Public visibility not verified (no `gh` CLI here) | Merge `7asn` → `main` (or make `7asn` the default branch); confirm the fork is **public**; commit your AI setup files (section 5 below) |
| 4 | **Live deployment** | A running server that **stays reachable until judging ends**. URLs go on the cover page | Not deployed. Runs locally only (Docker Postgres, API `:3000`, settlement `:8091`, Vite `:5173`/`:5174`) | Deploy to Dilmune Cloud; get four public URLs (section 4 below) |

---

## 2. Submission document: required structure

Use **these headings, in this order**.

### Cover page
- [ ] Team name, members, and **what each person owned**
- [ ] Live URLs: **checkout**, **merchant dashboard**, **admin console**, **public API**
- [ ] Link to the public fork, plus the **ID of the last commit before the deadline**

### 1. Summary (half a page)
- [ ] What you found, what you fixed, what you left alone, and the **main root cause**
- Candidate root cause: *trusting authority instead of evidence.* Forged ADRs (0003–0006 are dated after the commit that adds them and cite commits that don't exist), poisoned agent configs (`CLAUDE.md`, `AGENTS.md`), "Claude says" comments and tests rewritten to match buggy code. Together they explain the balance-rebuild regression, UTC month windows, cache-only adjustments, and the earlier agent's false "all tests pass".

### 2. Architecture and deployment
- [ ] A **diagram of every service and port**, marking which face the internet (checkout, dashboard, admin, API public; settlement `:8091`, reporting worker and Postgres internal only)
- [ ] The **one command** (or infrastructure as code) to redeploy, e.g. `docker compose -f ops/docker-compose.yml up -d --build`
- [ ] **Where secrets come from** (no dev keys: `WEBHOOK_SECRET_ENCRYPTION_KEY`, `ACQUIRER_CALLBACK_SIGNING_SECRET`, `SETTLEMENT_INTERNAL_TOKEN` and the DB password are currently hard-coded in `ops/docker-compose.yml` / `.env.docker`)
- [ ] **Health checks** and **restart policies** (compose has a Postgres healthcheck only; add them for api, settlement and reporting)
- [ ] **How a redeploy avoids interrupting a settlement run.** Explain `CloseBatch`'s single transaction plus its row lock (idempotent re-run), and drain or stop the settlement daemon between runs.

### 3. Capacity
- [ ] Estimated number of **simulated users** you can serve on the fixed scenario
- [ ] **Your own load test**: tool, method, results (nothing in the repo yet; `docs/perf/` holds only the previous team's notes)
- [ ] Where the **bottleneck** is (candidates: the single Postgres instance; capture and refund holding row locks across the acquirer call; the per-link advisory lock taking one extra DB connection per pay attempt; the 512 MB API container on a 0.5 vCPU box)
- [ ] How the stack **turns away excess load and recovers** (rate limiting, pool limits, 429/503 behaviour, restart policy)

### 4. Findings report
- [ ] **Findings**, one entry each: *symptom → how you found and reproduced it → root cause → fix → how you verified it → effect on existing data*. Source: `EXPLANATIONS.md` §4 and `EXECUTION_PLAN.md` §3. Every fix has a test that fails on the old code, which is ideal "how verified" evidence.
- [ ] **Root causes**: group findings by shared cause, e.g.:
  - lock released before an external call (refund race, payment-link double charge, OTP attempt race);
  - trusting the client (FP-203 `submittedAt`, unsigned callbacks);
  - floats and narrow integers in money (float32 estimate, int32 platform counter);
  - forged documentation (ADR-0003/0004/0006).
- [ ] **Decisions and open risks**: what you chose not to change, why, the safeguard you'd propose, and what's unresolved. Currently: DEF-03 volume-tier discount (needs finance sign-off), DEF-07 display-only adjustments (blocked by a locked test), DEF-08 post-payout MDR corrections, production data that needs finance-approved reversal (March sweep), and migration `0074` deleting duplicate callback notes.
- [ ] **"Effect on existing data"** for every fix that touches the database: `0074` (deletes duplicates), `0075` (recomputes estimates), `0076` (re-creates views), `0077` (widens a column).

### 5. UI and UX changes
- [ ] Each change: what, why, **before and after screenshots**, plus a link to any recording
- Candidates: the refund drawer enabled on the transaction page (`RefundDrawer.tsx`, `TransactionDetailPage.tsx`); the settlement batch page no longer using float division (`SettlementBatchDetailPage.tsx`, BUG-A8). Screenshots are needed; the `before` versions come from checking out `82a338a` or earlier.

### 6. AI usage
- [ ] **Setup**: what you built and where it lives in the repo (see section 5 below)
- [ ] **Three annotated transcript excerpts**. Each needs:
  - the finding it supports;
  - your prompt, and what context and tools the AI had;
  - the relevant part of the AI's answer;
  - how you verified it, and what that showed;
  - what you changed.
- [ ] **At least one where the AI was wrong**, and how you noticed. Real examples from this project:
  1. **The earlier agent's false claims.** `90341b3` claimed "430/430 tests pass, 10/10 Go packages". The actual baseline showed the API, reporting and web suites never ran on Node 20, 3 Go MDR tests failed, and 4 reporting tests failed. *Caught by:* re-running the suites with the shell expanding the globs.
  2. **The AI misread its own test failures.** The first run reported 6 webhook test failures that looked like a signing bug. They were caused by the AI's own running API dispatcher sharing the database. *Caught by:* stopping the services and re-running the failing files, which then passed (17/17).
  3. **The AI's migration fix broke fresh installs.** It restored the original `0054`, believing in-place edits were the bug. *Caught by:* migrating an empty database, which failed with `relation "settlement_batch_events" does not exist`. The edit was kept and `0076` added instead.
  4. **A decoy trusted as truth.** Commit `d39f3bf` reverted the balance-rebuild fix as a "decoy", trusting ADR-0004. *Caught by:* comparing ADR dates with the date of the commit that added them, and reading `docs/HANDOVER.md`.

### Appendix (optional)
- [ ] Queries, test output (the fail-before / pass-after runs), logs, load-test graphs, the decrypted transmission chain (`EXECUTION_PLAN.md` §2)

---

## 3. Slide deck (8 slides plus an appendix)

| # | Slide | Content to prepare |
|---|---|---|
| 1 | Team | Name, members, who owned what |
| 2 | Root cause | One sentence plus the symptoms it explains |
| 3 | Key findings | Top 3–4 by impact, each with one line of evidence (e.g. balance 135K→7K; payout 9,750 vs 5,850 fils; 40 OTP guesses checked vs 5; concurrent double refund) |
| 4 | Fixes and proof | What changed, plus the fail-before / pass-after test or query |
| 5 | **Live demo** | **A full and a partial refund end to end**, with correct amounts in the dashboard **and** the settlement report. **Have screenshots ready in case the demo fails.** |
| 6 | Under load | Architecture, estimated vs measured capacity, overload behaviour |
| 7 | How you used AI | Setup in one line, plus one time the AI was wrong and how you caught it |
| 8 | Decisions and open risks | What you didn't change or run, why, and what's still open |
| — | Appendix | Not presented: anything else judges should see |

**Format:** 4-minute pitch, then 7 minutes of questions, with no extra time. **Semi-final:** 15 minutes with one judge, who already has your automated test results. Spend the first 2–3 minutes on key findings and a quick look at the site, then the judge evaluates.

**The live demo is the riskiest item.** It needs DEF-01 and the FP-300 refund flow verified in the **deployed** app, not just locally.

---

## 4. Live URLs needed on the cover page

| Surface | Local today | Production (fill in) |
|---|---|---|
| Checkout (`apps/web` `/pay/:token`) | `http://localhost:5173` | |
| Merchant dashboard (`apps/web` `/dashboard`) | `http://localhost:5173/dashboard` | |
| Admin console (`apps/admin`) | `http://localhost:5174` | |
| Public API (`apps/api`) | `http://localhost:3000` | |

Deployment notes from this session:
- **The API sends no CORS headers.** Locally a same-origin proxy was needed. In production, serve each frontend and the API under one origin (a reverse proxy routing `/v1/*` to the API), or add CORS for the exact frontend origins.
- The frontends read `VITE_API_BASE_URL` (web) and `VITE_ADMIN_API_BASE_URL` (admin) **at build time**.
- Settlement (`:8091`), the reporting worker and Postgres must **not** be internet-facing.
- **Box limits:** 0.5 vCPU / 2 GB RAM / 2 GB disk, and the API container is capped at 512 MB. The first Go build filled the disk last time, so **build images off-box** or clear the Go build cache.
- **Don't** use the compose file's dev secrets or `NODE_ENV` defaults in production. `OTP_DEV_EXPOSE` must be off; signature checking and the callback replay window turn on automatically when `NODE_ENV=production`.

---

## 5. AI setup files the repo must contain

The guidelines require *"agent instructions, custom commands, tool configuration, permission rules and helper scripts"* in the fork.

| Present now | Missing or to decide |
|---|---|
| `.claude/launch.json` (dev-server config) | `.claude/settings.json` (permission rules, hooks) |
| `CLAUDE.md`, `AGENTS.md`, `.cursorrules`: these are the **challenge's poisoned files** | Your **own** agent instructions, e.g. a project `CLAUDE.md` section or `.claude/agents/*.md` stating the evidence-over-authority rules |
| `EXECUTION_PLAN.md` (agent-executable plan) | Custom commands (`.claude/commands/*.md` or skills), e.g. `/verify` running both suites sequentially |
| | Helper scripts, e.g. the same-origin dev proxy (currently only in a temp folder, not in the repo) and a script that runs both suites with the right `DATABASE_URL` |
| | The final implementation-agent prompt (drafted in this session) saved in the repo, e.g. `docs/ai/execute-plan-prompt.md` |

Decide whether to **replace** the poisoned `CLAUDE.md`/`AGENTS.md` or **keep them and document** that they're adversarial. Judges will read whatever you leave there.

---

## 6. Final pre-submit checklist (from guidelines §4, plus project specifics)

- [ ] All code is in the **public fork** `7assanyahya/fils-pay`, on the branch judges will see (merge `7asn` → `main`, or set the default branch)
- [ ] The fork is **public** (check on GitHub: Settings → General → Danger Zone → visibility)
- [ ] `TeamName_FilsPay_Submission.pdf` and `TeamName_FilsPay_Slides.pdf` are named exactly like that (with your real team name)
- [ ] The cover page has the 4 live URLs, the fork link and the **last commit ID**, taken after your final push
- [ ] The server is up, every link opens, and it **stays up until judging ends** (restart policies on)
- [ ] The full refund demo works on the **live** site; backup screenshots saved
- [ ] `npm test` and `go test ./...` green on the final commit; numbers in the document match what you observed
- [ ] Nothing changed after 11 pm (code, server, docs, slides)

---

## 7. Priority order from here

1. **Execute `EXECUTION_PLAN.md`** Steps 0–5 (DEF-01 is critical and also needed for a correct demo), documenting each fix in `EXPLANATIONS.md`.
2. **Deploy** to Dilmune Cloud with production secrets and a same-origin proxy; record the 4 URLs.
3. **Verify the refund demo live** (full + partial; dashboard + settlement report); take screenshots.
4. **Load test** the deployed stack (e.g. k6 or autocannon against checkout and pay); record results and the bottleneck.
5. **Commit the AI setup files**; merge to the branch judges will see; confirm the fork is public.
6. **Write the submission document** in the section 2 structure, then **the slides**. Export both to PDF with the correct names.
7. Final push → copy the **last commit ID** onto the cover page → re-export the PDF → submit before 11 pm.
