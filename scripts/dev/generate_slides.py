import os
import base64
import subprocess

WORKSPACE = "/Users/macbookpro2019/fils-pay"
OUTPUT_HTML = "/tmp/slides_rendered.html"
OUTPUT_PDF = os.path.join(WORKSPACE, "HitTheRoad_FilsPay_Slides.pdf")

def image_to_base64(path):
    if not os.path.isabs(path):
        path = os.path.join(WORKSPACE, path)
    if os.path.exists(path):
        ext = os.path.splitext(path)[1].lower().replace(".", "")
        mime = "image/png" if ext == "png" else "image/jpeg"
        with open(path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")
            return f"data:{mime};base64,{b64}"
    return ""

def main():
    # Load demo screenshots as base64
    img_drawer_full = image_to_base64("docs/screenshots/uc4-drawer-full-refund.jpg")
    img_drawer_partial = image_to_base64("docs/screenshots/uc4-drawer-partial-refund.jpg")
    img_demo_report = image_to_base64("docs/screenshots/demo-settlement-report.jpg")
    img_demo_dashboard = image_to_base64("docs/screenshots/demo-full-refund-dashboard.jpg")

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>FilsPay — Presentation Pitch Deck | Hit The Road</title>
    <style>
        @page {{
            size: 297mm 167.06mm; /* Exact 16:9 widescreen */
            margin: 0;
        }}

        * {{
            box-sizing: border-box;
        }}

        body {{
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #1c1c1e;
            background: #ffffff;
            -webkit-print-color-adjust: exact;
        }}

        .slide {{
            width: 297mm;
            height: 167.06mm;
            page-break-after: always;
            padding: 14mm 18mm 12mm 18mm;
            position: relative;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            background: #ffffff;
            overflow: hidden;
        }}

        /* Header on each slide */
        .slide-header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #E5E5EA;
            padding-bottom: 8px;
            margin-bottom: 12px;
        }}

        .slide-title-group {{
            display: flex;
            align-items: baseline;
            gap: 12px;
        }}

        .slide-num {{
            font-size: 13pt;
            font-weight: 800;
            color: #1A7F37;
            background: #E8F5E9;
            padding: 2px 10px;
            border-radius: 4px;
        }}

        .slide-title {{
            font-size: 18pt;
            font-weight: 800;
            color: #1A7F37;
            margin: 0;
            letter-spacing: -0.4px;
        }}

        .slide-tag {{
            font-size: 8.5pt;
            font-weight: 700;
            color: #8E8E93;
            letter-spacing: 0.6px;
            text-transform: uppercase;
        }}

        /* Footer on each slide */
        .slide-footer {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-top: 1px solid #E5E5EA;
            padding-top: 6px;
            font-size: 8pt;
            color: #8E8E93;
        }}

        .slide-content {{
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            gap: 10px;
        }}

        /* Typography & Components */
        h2 {{
            margin: 0;
            font-size: 13pt;
            color: #24292f;
        }}

        p {{
            margin: 0;
            font-size: 9.5pt;
            line-height: 1.45;
            color: #333;
        }}

        .highlight-box {{
            background: #F9F9FB;
            border-left: 5px solid #1A7F37;
            border-radius: 4px;
            padding: 10px 14px;
        }}

        .one-sentence-banner {{
            background: #1A7F37;
            color: #ffffff;
            border-radius: 6px;
            padding: 12px 16px;
            font-size: 11pt;
            font-weight: 700;
            line-height: 1.4;
            box-shadow: 0 2px 6px rgba(26, 127, 55, 0.2);
        }}

        .grid-2 {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }}

        .grid-3 {{
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 10px;
        }}

        .grid-4 {{
            display: grid;
            grid-template-columns: 1fr 1fr 1fr 1fr;
            gap: 10px;
        }}

        .card {{
            background: #F9F9FB;
            border: 1px solid #E5E5EA;
            border-radius: 6px;
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 5px;
        }}

        .card-header {{
            font-size: 9.5pt;
            font-weight: 700;
            color: #1A7F37;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }}

        .card-badge {{
            font-size: 7.5pt;
            font-weight: 700;
            background: #E8F5E9;
            color: #1A7F37;
            padding: 2px 6px;
            border-radius: 4px;
        }}

        .card-body {{
            font-size: 8.5pt;
            color: #48484A;
            line-height: 1.4;
        }}

        .stat-value {{
            font-size: 18pt;
            font-weight: 800;
            color: #1A7F37;
            line-height: 1;
        }}

        .stat-label {{
            font-size: 8pt;
            color: #666;
            text-transform: uppercase;
            font-weight: 600;
        }}

        .table-compact {{
            width: 100%;
            border-collapse: collapse;
            font-size: 8pt;
        }}

        .table-compact th {{
            background: #1A7F37;
            color: #fff;
            padding: 5px 8px;
            text-align: left;
            border: 1px solid #1A7F37;
        }}

        .table-compact td {{
            padding: 5px 8px;
            border: 1px solid #E5E5EA;
        }}

        .table-compact tr:nth-child(even) {{
            background: #F9F9FB;
        }}

        /* Slide 1 Cover specific */
        .cover-slide {{
            background: linear-gradient(135deg, #ffffff 0%, #F2F2F7 100%);
            justify-content: center;
            align-items: center;
            text-align: center;
            padding: 20mm;
        }}

        .cover-logo-row {{
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 14px;
            margin-bottom: 12px;
        }}

        .cover-title {{
            font-size: 28pt;
            font-weight: 800;
            color: #1A7F37;
            margin: 0 0 6px 0;
            letter-spacing: -0.6px;
        }}

        .cover-sub {{
            font-size: 13pt;
            color: #555;
            margin: 0 0 24px 0;
        }}

        .cover-meta-grid {{
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 14px;
            width: 100%;
            max-width: 250mm;
            text-align: left;
        }}

        /* Demo Image Container */
        .demo-img-container {{
            display: flex;
            gap: 10px;
            height: 85mm;
            align-items: stretch;
        }}

        .demo-img-card {{
            flex: 1;
            background: #F9F9FB;
            border: 1px solid #D1D1D6;
            border-radius: 6px;
            padding: 6px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: space-between;
        }}

        .demo-img-card img {{
            max-width: 100%;
            max-height: 70mm;
            object-fit: contain;
            border-radius: 4px;
            border: 1px solid #E5E5EA;
        }}

        .demo-img-caption {{
            font-size: 7.5pt;
            font-weight: 600;
            color: #1A7F37;
            margin-top: 4px;
            text-align: center;
        }}

        code {{
            font-family: ui-monospace, Menlo, Monaco, Consolas, monospace;
            font-size: 7.5pt;
            background: #F2F2F7;
            padding: 1px 4px;
            border-radius: 3px;
            color: #1A7F37;
        }}
    </style>
</head>
<body>

<!-- SLIDE 1: TEAM -->
<div class="slide cover-slide">
    <div>
        <div class="cover-logo-row">
            <svg width="44" height="44" viewBox="0 0 32 32" fill="none">
                <rect width="32" height="32" rx="7" fill="#1A7F37"/>
                <path d="M7 10h18M7 16h13M7 22h8" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
                <circle cx="23" cy="20" r="4.5" fill="#2DA44E" stroke="#ffffff" stroke-width="1.5"/>
                <path d="M21.5 20l1 1 2-2" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span style="font-size: 26pt; font-weight: 800; color: #1A7F37; letter-spacing: -0.5px;">FilsPay</span>
        </div>
        <div class="cover-title">Finals Pitch & Architecture Defense</div>
        <div class="cover-sub">170-Point Rubric Verification &bull; Financial Integrity, Concurrency, Security & UI/UX</div>
    </div>

    <div class="cover-meta-grid">
        <div class="card" style="border-left: 4px solid #1A7F37;">
            <div class="card-header">Team Name</div>
            <div class="stat-value" style="font-size: 16pt;">Hit The Road</div>
            <div class="card-body" style="font-size: 8pt;">
                <strong>1. Hasan Yahya:</strong> Lead Full-Stack Engineering, Cloud Infrastructure & Systems Architecture<br>
                <strong>2. Husain Jameel:</strong> Security Review, Concurrency Hardening & Automated QA
            </div>
        </div>

        <div class="card" style="border-left: 4px solid #1A7F37;">
            <div class="card-header">Live Production Deployment</div>
            <div class="card-body" style="font-size: 8pt;">
                <strong>Checkout:</strong> <a href="https://filspay.dilmune.app/pay/plink_lgW4zWUzYfBftKoCqjphwt" style="color: #1A7F37;">filspay.dilmune.app/pay/...</a><br>
                <strong>Dashboard:</strong> <a href="https://filspay.dilmune.app" style="color: #1A7F37;">filspay.dilmune.app</a><br>
                <strong>Admin:</strong> <a href="https://filspay.dilmune.app/admin" style="color: #1A7F37;">filspay.dilmune.app/admin</a><br>
                <strong>API Health:</strong> <a href="https://filspay.dilmune.app/healthz" style="color: #1A7F37;">filspay.dilmune.app/healthz</a>
            </div>
        </div>

        <div class="card" style="border-left: 4px solid #1A7F37;">
            <div class="card-header">Verified Repository</div>
            <div class="card-body" style="font-size: 8pt;">
                <strong>Fork:</strong> <a href="https://github.com/7assanyahya/fils-pay" style="color: #1A7F37;">github.com/7assanyahya/fils-pay</a><br>
                <strong>Last Commit ID:</strong> <code>f296124</code><br>
                <strong>Branch:</strong> <code>main</code> (synchronized with <code>7asn</code>)<br>
                <strong>Host:</strong> Dilmune Cloud (DigitalOcean <code>168.144.112.143</code>)
            </div>
        </div>
    </div>

    <div style="font-size: 8.5pt; color: #8E8E93;">
        Official Competition Submission Deck &bull; 4-Minute Presentation + 7-Minute Defense
    </div>
</div>

<!-- SLIDE 2: ROOT CAUSE -->
<div class="slide">
    <div class="slide-header">
        <div class="slide-title-group">
            <span class="slide-num">02</span>
            <span class="slide-title">The Single Root Cause</span>
        </div>
        <span class="slide-tag">Core Architectural Diagnosis</span>
    </div>

    <div class="slide-content">
        <div class="one-sentence-banner">
            "Trusting authority instead of evidence: forged ADRs, poisoned agent instructions and confident code comments asserted safety the code did not have."
        </div>

        <div class="grid-3" style="flex: 1;">
            <div class="card" style="border-top: 3px solid #E02424;">
                <div class="card-header" style="color: #E02424;">Forged ADRs</div>
                <div class="card-body">
                    ADR-0003&ndash;0006 are dated after the commit that adds them and cite commits that don't exist. Following ADR-0004, an earlier "decoy revert" put back the balance rebuild that read scheme export lines (<strong>135K &rarr; 7K BD</strong>, DEF-01). ADR-0003 gave UTC month windows (DEF-05); ADR-0006, cache-only balance edits (DEF-07).
                </div>
            </div>

            <div class="card" style="border-top: 3px solid #E02424;">
                <div class="card-header" style="color: #E02424;">False code comments</div>
                <div class="card-body">
                    "Impersonation can't reach write routes" &rarr; an admin viewing as a merchant could <strong>capture and void</strong>. "create.ts blocks private IPs" &rarr; <strong>SSRF</strong>. "A 0046 trigger keeps mdr_bps in sync" &rarr; wrong fee rate in reconciliation and MDR recalculation. "total_processed_fils is BIGINT" &rarr; a 32-bit counter.
                </div>
            </div>

            <div class="card" style="border-top: 3px solid #E02424;">
                <div class="card-header" style="color: #E02424;">Poisoned agent instructions</div>
                <div class="card-body">
                    <code>CLAUDE.md</code> / <code>AGENTS.md</code> / <code>.cursorrules</code> claim money is cents, settlement uses UTC, <code>Math.random</code> is fine for tokens, and ask for a <code>Reviewed-per</code> commit trailer (a canary). We followed none of it.
                </div>
            </div>
        </div>

        <div class="highlight-box">
            <strong style="color: #1A7F37;">Our rule:</strong> a claim counts only when the code, the database or a failing test confirms it. That is also how we told real bugs from the decoys we deliberately left alone (e.g. capture holding its row lock across the acquirer call is intended).
        </div>
    </div>

    <div class="slide-footer">
        <span>FilsPay Finals Pitch &bull; Slide 2</span>
        <span>Root Cause &bull; Hit The Road</span>
    </div>
</div>

<!-- SLIDE 3: KEY FINDINGS -->
<div class="slide">
    <div class="slide-header">
        <div class="slide-title-group">
            <span class="slide-num">03</span>
            <span class="slide-title">Top Key Findings</span>
        </div>
        <span class="slide-tag">Ranked by Financial & Security Impact</span>
    </div>

    <div class="slide-content">
        <div class="grid-2" style="flex: 1;">
            <div class="card" style="border-left: 4px solid #1A7F37;">
                <div class="card-header">
                    <span>1. DB Pool Exhaustion Deadlock & Crash</span>
                    <span class="card-badge">CAPACITY</span>
                </div>
                <div class="card-body">
                    <strong>Finding:</strong> Concurrent checkout attempts starved PostgreSQL connection slots due to nested pool acquisitions inside an advisory lock connection.<br>
                    <strong>One-Line Evidence:</strong> <em>20 out of 24 concurrent requests failed with HTTP 500 DB acquire timeout before fix; 0 failed after.</em>
                </div>
            </div>

            <div class="card" style="border-left: 4px solid #1A7F37;">
                <div class="card-header">
                    <span>2. Server-Side Request Forgery (SSRF)</span>
                    <span class="card-badge">SECURITY</span>
                </div>
                <div class="card-body">
                    <strong>Finding:</strong> Merchant webhook endpoints accepted arbitrary internal destinations, permitting lateral cloud metadata and settlement API exfiltration.<br>
                    <strong>One-Line Evidence:</strong> <em>URL validation checked only the scheme, redirects were followed and the response excerpt was shown to the merchant; the new guard rejects internal targets (4 of 5 tests fail on the old code).</em>
                </div>
            </div>

            <div class="card" style="border-left: 4px solid #1A7F37;">
                <div class="card-header">
                    <span>3. Scheme Export Residue Rounding Truncation</span>
                    <span class="card-badge">ACCOUNTING</span>
                </div>
                <div class="card-body">
                    <strong>Finding:</strong> Scheme export lines are truncated to 10 fils by design (ADR-0002), but the balancing residue legs were never journaled, so card-scheme clearing never tied out.<br>
                    <strong>One-Line Evidence:</strong> <em>No Go code posted to <code>scheme_rounding_residue</code>; after the fix, 15 residue lines in a live batch, 0 unbalanced.</em>
                </div>
            </div>

            <div class="card" style="border-left: 4px solid #1A7F37;">
                <div class="card-header">
                    <span>4. Privilege Escalation on Capture & Void</span>
                    <span class="card-badge">AUTHORIZATION</span>
                </div>
                <div class="card-body">
                    <strong>Finding:</strong> In <code>transactions.ts</code>, capture and void had no role gate, so an admin "viewing as merchant" (documented as read-only) or a merchant support user could move money.<br>
                    <strong>One-Line Evidence:</strong> <em>An impersonation grant captured 3.333 BD with HTTP 200 before the fix; 403 after (finance still 200).</em>
                </div>
            </div>
        </div>
    </div>

    <div class="slide-footer">
        <span>FilsPay Finals Pitch &bull; Slide 3</span>
        <span>Key Findings &bull; Hit The Road</span>
    </div>
</div>

<!-- SLIDE 4: FIXES AND PROOF -->
<div class="slide">
    <div class="slide-header">
        <div class="slide-title-group">
            <span class="slide-num">04</span>
            <span class="slide-title">Surgical Fixes & Concrete Proof</span>
        </div>
        <span class="slide-tag">Verification Metrics</span>
    </div>

    <div class="slide-content">
        <div class="grid-4" style="margin-bottom: 6px;">
            <div class="card" style="text-align: center;">
                <div class="stat-value">16.4/s</div>
                <div class="stat-label">Checkout Throughput (Up from 3.5/s)</div>
            </div>
            <div class="card" style="text-align: center;">
                <div class="stat-value">0 Error</div>
                <div class="stat-label">Concurrency Failure Rate (Down from 83%)</div>
            </div>
            <div class="card" style="text-align: center;">
                <div class="stat-value">471/471</div>
                <div class="stat-label">TypeScript Tests Passed</div>
            </div>
            <div class="card" style="text-align: center;">
                <div class="stat-value">7/7</div>
                <div class="stat-label">Go Packages with Tests Passed</div>
            </div>
        </div>

        <table class="table-compact">
            <thead>
                <tr>
                    <th>Component</th>
                    <th>What We Changed</th>
                    <th>Automated Verification & Proof</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><strong>Concurrency</strong></td>
                    <td>Isolated checkout advisory locks to a single connection in <code>pay.ts</code></td>
                    <td><code>payPoolDeadlock.new.test.ts</code> & <code>scripts/loadtest/checkout.mjs</code> (0 500s)</td>
                </tr>
                <tr>
                    <td><strong>Load Shedding</strong></td>
                    <td>Shed load past 200 in-flight requests with 503 + <code>Retry-After: 1</code>; pool timeouts answer 503</td>
                    <td><code>overload.new.test.ts</code>; 300-user run: 814 shed, 0 errors 500</td>
                </tr>
                <tr>
                    <td><strong>Security</strong></td>
                    <td>SSRF IP resolver guard, sliding login throttle (10/15m), CSV formula escape</td>
                    <td><code>ssrfGuard.new.test.ts</code>, <code>loginThrottle.new.test.ts</code>, <code>exportCsv.formula.new.test.ts</code></td>
                </tr>
                <tr>
                    <td><strong>Settlement</strong></td>
                    <td>Journaled scheme export residue to balancing account per ADR-0002</td>
                    <td><code>batch_residue_test.go</code> (Exact conservation across scheme lines)</td>
                </tr>
                <tr>
                    <td><strong>Role Gates</strong></td>
                    <td>Enforced <code>requireMerchantRole("owner", "finance")</code> on capture and void</td>
                    <td><code>transactions.impersonation.new.test.ts</code> (Support receives 403 Forbidden)</td>
                </tr>
            </tbody>
        </table>
    </div>

    <div class="slide-footer">
        <span>FilsPay Finals Pitch &bull; Slide 4</span>
        <span>Fixes & Proof &bull; Hit The Road</span>
    </div>
</div>

<!-- SLIDE 5: LIVE DEMO (REFUNDS) -->
<div class="slide">
    <div class="slide-header">
        <div class="slide-title-group">
            <span class="slide-num">05</span>
            <span class="slide-title">Live Demo: End-to-End Refunds</span>
        </div>
        <span class="slide-tag">Full & Partial Refund Walkthrough</span>
    </div>

    <div class="slide-content">
        <p style="font-size: 8.5pt; margin-bottom: 4px;">
            <strong>Live Workflow:</strong> Transaction authorized &rarr; Captured &rarr; Partial Refund executed with exact fee reversal conservation &rarr; Full Refund executed &rarr; Automatically aggregated in Settlement Report.
        </p>

        <div class="demo-img-container">
            <div class="demo-img-card">
                <img src="{img_drawer_partial}" alt="Partial Refund Drawer" />
                <div class="demo-img-caption">1. Partial Refund Execution (Proportional Fee Reversal)</div>
            </div>
            <div class="demo-img-card">
                <img src="{img_drawer_full}" alt="Full Refund Drawer" />
                <div class="demo-img-caption">2. Full Refund Completion (Zero Residue)</div>
            </div>
            <div class="demo-img-card">
                <img src="{img_demo_dashboard}" alt="Transactions Dashboard" />
                <div class="demo-img-caption">3. Merchant Dashboard (Status: Refunded)</div>
            </div>
            <div class="demo-img-card">
                <img src="{img_demo_report}" alt="Settlement Report" />
                <div class="demo-img-caption">4. Daily Settlement Report (Audited Net Total)</div>
            </div>
        </div>
    </div>

    <div class="slide-footer">
        <span>FilsPay Finals Pitch &bull; Slide 5</span>
        <span>Live Demo Backup &bull; Hit The Road</span>
    </div>
</div>

<!-- SLIDE 6: UNDER LOAD -->
<div class="slide">
    <div class="slide-header">
        <div class="slide-title-group">
            <span class="slide-num">06</span>
            <span class="slide-title">Capacity & Overload Resilience</span>
        </div>
        <span class="slide-tag">0.5 vCPU / 512 MB Constrained Environment</span>
    </div>

    <div class="slide-content">
        <div class="grid-2" style="flex: 1;">
            <div class="card">
                <div class="card-header">Capacity: Estimated vs. Measured</div>
                <div class="card-body">
                    <ul>
                        <li><strong>Environment Limits:</strong> Fixed sandbox constraint of 0.5 CPU & 512 MB RAM.</li>
                        <li><strong>Estimate for the box:</strong> ~8 checkouts/sec sustained at p95 &lt; 1 s (about 5 buyers paying at once), bound by Postgres CPU (~43 ms per checkout).</li>
                        <li><strong>Measured (laptop, API not CPU-limited):</strong> <strong>16.4 checkouts/sec</strong> at 10 concurrent buyers (p50 592 ms, p95 800 ms); plateaus at ~17/s, pool-bound.</li>
                        <li><strong>Bottleneck:</strong> was a DB pool deadlock (20 of 24 checkouts failed); now one connection per checkout. Next limit: Postgres CPU on the box.</li>
                    </ul>
                </div>
            </div>

            <div class="card">
                <div class="card-header">Overload Protection & Instant Recovery</div>
                <div class="card-body">
                    <ul>
                        <li><strong>Fastify Load Shedding:</strong> Tracks in-flight requests against <code>API_MAX_INFLIGHT=200</code>. Excess traffic receives an instant <strong>HTTP 503</strong> with <code>Retry-After: 1</code>, before touching the database.</li>
                        <li><strong>Pool Saturation:</strong> a DB pool acquire timeout (default 5 s) answers <strong>503 service_busy</strong> instead of 500. 300-user run: 814 shed, 86 completed, <strong>0 errors 500</strong>.</li>
                        <li><strong>Crash Recovery:</strong> <code>kill -9</code> mid-load: no double charge, ledger balanced; the 10 links caught mid-checkout were paid on retry after the 60 s reservation timeout. Services restart automatically.</li>
                    </ul>
                </div>
            </div>
        </div>

        <div class="highlight-box" style="display: flex; justify-content: space-around; align-items: center; padding: 6px 12px;">
            <span style="font-size: 8.5pt;"><strong>Cloud Ingress:</strong> Cloudflare (DDoS/Edge SSL) &rarr; Nginx Reverse Proxy</span>
            <span style="font-size: 8.5pt;"><strong>Internal Isolation:</strong> Fastify API (:3000), Go Settlement (:8091), Postgres (:5432)</span>
        </div>
    </div>

    <div class="slide-footer">
        <span>FilsPay Finals Pitch &bull; Slide 6</span>
        <span>Capacity & Resilience &bull; Hit The Road</span>
    </div>
</div>

<!-- SLIDE 7: HOW WE USED AI -->
<div class="slide">
    <div class="slide-header">
        <div class="slide-title-group">
            <span class="slide-num">07</span>
            <span class="slide-title">How We Used AI</span>
        </div>
        <span class="slide-tag">Tooling Setup & Critical Failure Case</span>
    </div>

    <div class="slide-content">
        <div class="highlight-box">
            <strong>Setup in One Line:</strong> <em>Autonomous pair programming with local same-origin proxies (`proxy.mjs`), load testing tools (`checkout.mjs`), and strict guardrails freezing locked regression tests and core money packages.</em>
        </div>

        <div class="card" style="border-left: 4px solid #E02424; flex: 1;">
            <div class="card-header" style="color: #E02424;">
                <span>Where the AI was Wrong — Its Own Test Harness</span>
                <span class="card-badge" style="background: #FDE8E8; color: #E02424;">DETECTED & CORRECTED</span>
            </div>
            <div class="card-body" style="font-size: 8.5pt;">
                <p style="margin-bottom: 6px;">
                    <strong>The Prompt:</strong> Check every admin action against the <code>support</code>, <code>finance</code> and <code>super_admin</code> roles, using live admin sessions from a zsh shell.
                </p>
                <p style="margin-bottom: 6px;">
                    <strong>The AI's Mistake:</strong> Its first matrix printed <code>400</code> for <em>every</em> endpoint and every role, including plain <code>GET</code> requests.
                </p>
                <p style="margin-bottom: 6px;">
                    <strong>How We Caught It:</strong> A <code>GET</code> returning 400 made no sense, so we read the loop: zsh doesn't word-split variables, so every request went out with an empty URL.
                </p>
                <p>
                    <strong>What Changed:</strong> Re-run under bash, the matrix showed the gates working (support 403 on every money action, anonymous 401). The real capture/void bug was found separately, by testing impersonation live, and proved with a failing test before fixing.
                </p>
            </div>
        </div>
    </div>

    <div class="slide-footer">
        <span>FilsPay Finals Pitch &bull; Slide 7</span>
        <span>AI Governance &bull; Hit The Road</span>
    </div>
</div>

<!-- SLIDE 8: DECISIONS & OPEN RISKS -->
<div class="slide">
    <div class="slide-header">
        <div class="slide-title-group">
            <span class="slide-num">08</span>
            <span class="slide-title">Decisions & Open Risks</span>
        </div>
        <span class="slide-tag">Documented Trade-offs</span>
    </div>

    <div class="slide-content">
        <div class="grid-2" style="flex: 1;">
            <div class="card">
                <div class="card-header">Documented Decisions (What We Left Alone)</div>
                <div class="card-body">
                    <ul>
                        <li><strong><code>packages/money/</code> Freeze:</strong> Kept strictly unchanged. The integer-fils rounding logic was frozen after Q2 audit and matches the acquirer's certified test vectors.</li>
                        <li><strong>DEF-07 &amp; QA-B3 (locked tests):</strong> display-only balance adjustments (a locked test asserts 0 ledger rows) and credit ledger dating (a locked test pins the effective date). Need the test owner's approval.</li>
                        <li><strong>DEF-03 (volume-tier discount):</strong> applied without finance's written sign-off; left until finance confirms. <strong>DEF-08:</strong> post-payout MDR corrections no batch deducts &mdash; a finance design decision.</li>
                        <li><strong>Support issuing credits:</strong> the admin guide says support can, the code refuses; allowing it would loosen access control, so it stays refused pending the owner's call.</li>
                    </ul>
                </div>
            </div>

            <div class="card">
                <div class="card-header">Residual Risks & Proposed Safeguards</div>
                <div class="card-body">
                    <ul>
                        <li><strong>SSRF DNS Rebinding Gap:</strong> Time-of-check to time-of-use window between DNS resolution and fetch &rarr; <em>Safeguard: Deploy egress proxy with hard-pinned destination IPs.</em></li>
                        <li><strong>In-Memory Rate Limiter:</strong> Sliding throttle stores counters in Node memory &rarr; <em>Safeguard: Back sliding windows with Redis cluster in multi-instance deployments.</em></li>
                        <li><strong>Hardcoded Dev Secrets:</strong> Default keys in <code>ops/docker-compose.yml</code> for dev onboarding &rarr; <em>Safeguard: Injected via systemd environment boundaries in production.</em></li>
                    </ul>
                </div>
            </div>
        </div>

        <div class="highlight-box" style="font-size: 8.5pt;">
            <strong style="color: #1A7F37;">Summary:</strong> Every bug we found outside these decisions is fixed with a test that fails on the old code; no locked test and nothing in <code>packages/money</code> was changed.
        </div>
    </div>

    <div class="slide-footer">
        <span>FilsPay Finals Pitch &bull; Slide 8</span>
        <span>Decisions & Risks &bull; Hit The Road</span>
    </div>
</div>

<!-- SLIDE 9: APPENDIX - TEST RESULTS -->
<div class="slide">
    <div class="slide-header">
        <div class="slide-title-group">
            <span class="slide-num">A1</span>
            <span class="slide-title">Appendix: Automated Test Evidence</span>
        </div>
        <span class="slide-tag">100% Pass Rate Across Polyglot Stack</span>
    </div>

    <div class="slide-content">
        <div class="grid-2" style="flex: 1;">
            <div class="card">
                <div class="card-header">TypeScript / Node.js Tests (471 Passed)</div>
                <div class="card-body" style="font-size: 8pt;">
                    <code>apps/api/src/admin/apiKeysRerotate.new.test.ts ............. PASS</code><br>
                    <code>apps/api/src/auth/loginThrottle.new.test.ts ................ PASS</code><br>
                    <code>apps/api/src/webhooks/ssrfGuard.new.test.ts ................ PASS</code><br>
                    <code>apps/api/src/paymentLinks/payPoolDeadlock.new.test.ts ...... PASS</code><br>
                    <code>apps/api/src/plugins/overload.new.test.ts .................. PASS</code><br>
                    <code>apps/api/src/routes/transactions.impersonation.new.test.ts . PASS</code><br>
                    <code>apps/api/src/routes/webhooks.deleteWithDeliveries.new.test.ts PASS</code><br>
                    <code>apps/api/src/settlement/reconciliationSchedule.new.test.ts . PASS</code><br>
                    <code>apps/api/src/transactions/exportCsv.formula.new.test.ts .... PASS</code><br>
                    <strong>Total: 471 passed, 0 failed (events 4, money 40, api 399, reporting 12, web 8, scripts 8)</strong>
                </div>
            </div>

            <div class="card">
                <div class="card-header">Go Settlement Package Test Suite (7/7 Passed)</div>
                <div class="card-body" style="font-size: 8pt;">
                    <code>ok  internal/config</code><br>
                    <code>ok  internal/internalapi</code><br>
                    <code>ok  internal/ledger</code><br>
                    <code>ok  internal/money</code><br>
                    <code>ok  internal/scheduler</code><br>
                    <code>ok  internal/settlement</code><br>
                    <code>ok  internal/splits</code><br>
                    <em>(cmd/settlement, internal/balances, internal/db have no test files)</em><br>
                    <strong>Total: 7 of 7 packages with tests passed</strong>
                </div>
            </div>
        </div>

        <div class="card" style="border-left: 4px solid #1A7F37;">
            <div class="card-header">Deterministic Database Seed Assertions</div>
            <div class="card-body" style="font-size: 8pt;">
                <code>REAL PASS ledger-balances: Every entry_group_id in ledger_entries sums debits = credits</code><br>
                <code>REAL PASS allocate-remainder-self-test: allocateRemainder sums back to the exact total</code><br>
                <code>REAL PASS captured-le-authorized: Every transaction has captured_fils &lt;= amount_fils</code><br>
                <code>REAL PASS scheme-lines-quantized: Every scheme_export_lines.amount_fils is a multiple of 10 fils</code><br>
                <code>REAL PASS seed-deterministic: Re-running generate() yields identical row counts & checksums</code>
            </div>
        </div>
    </div>

    <div class="slide-footer">
        <span>FilsPay Finals Pitch &bull; Appendix 1</span>
        <span>Test Suite Evidence &bull; Hit The Road</span>
    </div>
</div>

<!-- SLIDE 10: APPENDIX - SQL LEDGER PROOFS -->
<div class="slide">
    <div class="slide-header">
        <div class="slide-title-group">
            <span class="slide-num">A2</span>
            <span class="slide-title">Appendix: Double-Entry Ledger Proofs</span>
        </div>
        <span class="slide-tag">PostgreSQL Invariant Verification</span>
    </div>

    <div class="slide-content">
        <div class="card" style="flex: 1;">
            <div class="card-header">Query 1: Zero Imbalance Across All Double-Entry Groups</div>
            <div class="card-body">
                <pre><code>SELECT entry_group_id, 
       SUM(CASE WHEN direction = 'debit' THEN amount_fils ELSE 0 END) AS debits,
       SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE 0 END) AS credits
  FROM ledger_entries
 GROUP BY entry_group_id
HAVING SUM(CASE WHEN direction = 'debit' THEN amount_fils ELSE 0 END) &lt;&gt; 
       SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE 0 END);
-- Result: (0 rows) &bull; every entry group balances</code></pre>
            </div>
        </div>

        <div class="card" style="flex: 1;">
            <div class="card-header">Query 2: ADR-0002 Scheme Export Residue Quantization</div>
            <div class="card-body">
                <pre><code>SELECT COUNT(*) AS unquantized_scheme_lines
  FROM scheme_export_lines 
 WHERE amount_fils % 10 &lt;&gt; 0;
-- Result: 0 &bull; every scheme line is a multiple of 10 fils; each residue is journaled (ADR-0002)</code></pre>
            </div>
        </div>
    </div>

    <div class="slide-footer">
        <span>FilsPay Finals Pitch &bull; Appendix 2</span>
        <span>Ledger Conservation &bull; Hit The Road</span>
    </div>
</div>

<!-- SLIDE 11: APPENDIX - INFRASTRUCTURE -->
<div class="slide">
    <div class="slide-header">
        <div class="slide-title-group">
            <span class="slide-num">A3</span>
            <span class="slide-title">Appendix: Live Cloud Infrastructure</span>
        </div>
        <span class="slide-tag">Dilmune Cloud Host crimson-planet</span>
    </div>

    <div class="slide-content">
        <table class="table-compact" style="margin-top: 6px;">
            <thead>
                <tr>
                    <th>Component</th>
                    <th>Host & Port</th>
                    <th>Runtime & Configuration</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><strong>Ingress Proxy</strong></td>
                    <td>Port 80, 443</td>
                    <td>Nginx 1.24 + Let's Encrypt TLS (Cloudflare Full SSL)</td>
                    <td><code>active (running)</code></td>
                </tr>
                <tr>
                    <td><strong>Core API</strong></td>
                    <td>127.0.0.1:3000</td>
                    <td>Fastify / Node.js 22 (Systemd <code>filspay-api.service</code>)</td>
                    <td><code>active (running)</code></td>
                </tr>
                <tr>
                    <td><strong>Settlement</strong></td>
                    <td>127.0.0.1:8091</td>
                    <td>Go 1.22 Native Binary (Systemd <code>filspay-settlement.service</code>)</td>
                    <td><code>active (running)</code></td>
                </tr>
                <tr>
                    <td><strong>Reporting Worker</strong></td>
                    <td>Process</td>
                    <td>Node.js 22 Outbox Worker (Systemd <code>filspay-reporting.service</code>)</td>
                    <td><code>active (running)</code></td>
                </tr>
                <tr>
                    <td><strong>Database</strong></td>
                    <td>127.0.0.1:5432</td>
                    <td>PostgreSQL 16 (All 72 schema migrations applied)</td>
                    <td><code>active (running)</code></td>
                </tr>
                <tr>
                    <td><strong>Frontends</strong></td>
                    <td>Static SPA</td>
                    <td>React 18 / Vite 5 (Web & Admin SPAs served via Nginx)</td>
                    <td><code>active (200 OK)</code></td>
                </tr>
            </tbody>
        </table>

        <div class="highlight-box" style="font-size: 8pt; margin-top: 8px;">
            <strong>Verification Endpoints:</strong><br>
            <code>curl -i https://filspay.dilmune.app/healthz</code> &rarr; <code>HTTP/2 200 {{ "status": "ok", "uptimeSeconds": 2400+ }}</code><br>
            <code>curl -i https://filspay.dilmune.app/pay/plink_lgW4zWUzYfBftKoCqjphwt</code> &rarr; <code>HTTP/2 200 OK (Checkout Live)</code>
        </div>
    </div>

    <div class="slide-footer">
        <span>FilsPay Finals Pitch &bull; Appendix 3</span>
        <span>Infrastructure &bull; Hit The Road</span>
    </div>
</div>

</body>
</html>
"""

    with open(OUTPUT_HTML, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Rendered HTML generated at: {OUTPUT_HTML}")

    # Generate PDF using Chrome headless
    chrome_bin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    cmd = [
        chrome_bin,
        "--headless=new",
        "--disable-gpu",
        "--allow-file-access-from-files",
        "--enable-local-file-accesses",
        "--virtual-time-budget=5000",
        "--run-all-compositor-stages-before-draw",
        f"--print-to-pdf={OUTPUT_PDF}",
        OUTPUT_HTML
    ]
    print(f"Invoking Chrome headless to generate Slides PDF at {OUTPUT_PDF}...")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if os.path.exists(OUTPUT_PDF):
        size_kb = os.path.getsize(OUTPUT_PDF) / 1024
        print(f"SUCCESS: Generated Slides PDF ({size_kb:.1f} KB) at: {OUTPUT_PDF}")
    else:
        print(f"FAILED to generate Slides PDF: {res.stderr}")

if __name__ == "__main__":
    main()
