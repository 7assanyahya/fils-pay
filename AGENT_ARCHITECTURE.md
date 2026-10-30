# FilsPay — Agent System Architecture (`AGENT_ARCHITECTURE.md`)

This document details the multi-agent system architecture, specialized skill activations, tool coordination, decoy filtering pipeline, and reactive error-recovery workflows utilized to complete the hackathon mission across all phases.

---

## 1. High-Level Orchestration Workflow

The mission was executed using an autonomous hierarchical agent architecture. The **Antigravity Orchestrator** drove execution across four sequential phases, activating specialized skills and subagents for targeted investigations, surgical triage, and full-stack engineering.

```mermaid
flowchart TD
    Start(["Hackathon Directive Received"]) --> Phase1["Phase 1: Forensics Investigation<br/>(Skill: forensics-investigator)"]
    
    subgraph P1["Phase 1: Git Forensics & Decryption"]
        Phase1 --> GitReflog["Audit Git History & Dangling Reflogs"]
        GitReflog --> PromptAudit["Analyze Adversarial Prompts<br/>(AGENTS.md, CLAUDE.md)"]
        PromptAudit --> Decrypt["Decrypt Transmissions 1, 2, 3<br/>(Base64, Vigenere, AES-256)"]
        Decrypt --> IncidentReport["Produce INCIDENT_REPORT.md<br/>& Define FP-300 Spec"]
    end

    IncidentReport --> Phase2["Phase 2: Surgical Legacy Triage<br/>(Skill: legacy-triage)"]

    subgraph P2["Phase 2: Multi-Agent Parallel Triage"]
        Phase2 --> SpawnSubagents["Spawn Autonomous Subagents"]
        SpawnSubagents --> SubAgentA["Subagent A: API & Money Auditor<br/>(Security, IDOR, OTP, Decimal Parsing)"]
        SpawnSubagents --> SubAgentB["Subagent B: Settlement & Fullstack Auditor<br/>(Concurrency, Go Splits, Webhooks)"]
        SubAgentA --> Synthesize["Synthesize Vulnerability Map"]
        SubAgentB --> Synthesize
        Synthesize --> SurgicalFixes["Execute Atomic Surgical Fixes"]
    end

    SurgicalFixes --> Phase3["Phase 3: FP-300 Feature Implementation<br/>(Skill: deploy-dilmune)"]

    subgraph P3["Phase 3: Full-Stack Feature Delivery"]
        Phase3 --> WireAPI["Wire API Routes (/v1/refunds & /v1/merchants/:id/refunds)"]
        WireAPI --> WireWebhooks["Update Webhook Dispatcher & Envelope"]
        WireWebhooks --> WireReporting["Update Reporting Consumer & DB Schema"]
        WireReporting --> WireUI["Activate React RefundDrawer & Details UI"]
        WireUI --> BuildDocker["Containerize for Dilmune Cloud<br/>(Dockerfile.node, Dockerfile.go)"]
    end

    BuildDocker --> Phase4["Phase 4: Verification & Audit Trail<br/>(Skill: judge-audit-trail)"]

    subgraph P4["Phase 4: Comprehensive Verification"]
        Phase4 --> TestSuites["Run Full Test Suites<br/>(npm test: 441+ pass, go test: 10/10)"]
        TestSuites --> InvariantVerification["Verify Invariants (5/5 Seed Checks)"]
        InvariantVerification --> Documentation["Generate EXPLANATIONS.md<br/>& AGENT_ARCHITECTURE.md"]
    end

    Documentation --> Done(["Mission Accomplished"])
```

---

## 2. Multi-Agent Delegation Model

To audit a complex polyglot codebase (TypeScript/Fastify, Go 1.22, React, PostgreSQL 16, and Docker) within tight time constraints, the orchestrator partitioned discovery into two parallel subagents:

```mermaid
flowchart LR
    Orchestrator["Antigravity Orchestrator<br/>(Model: Pro)"]
    
    subgraph Subagents["Specialized Subagents"]
        Auditor1["Subagent: API & Money Auditor<br/>(Conversation: 0882ca73...)"]
        Auditor2["Subagent: Settlement & Fullstack Auditor<br/>(Conversation: f634bd1a...)"]
    end

    subgraph Artifacts["Codebase Workspaces"]
        API["apps/api & packages/money"]
        Settlement["apps/settlement & ops/"]
        Reporting["apps/reporting & db/"]
        Web["apps/web"]
    end

    Orchestrator -->|"Invoke Subagent"| Auditor1
    Orchestrator -->|"Invoke Subagent"| Auditor2

    Auditor1 -->|"Audit Auth, IDOR, CSV"| API
    Auditor1 -->|"Audit 3-dp BHD fils math"| Reporting

    Auditor2 -->|"Audit Go splits, daemon"| Settlement
    Auditor2 -->|"Audit RefundDrawer, UI"| Web

    Auditor1 -->|"Structured Audit Findings"| Orchestrator
    Auditor2 -->|"Structured Audit Findings"| Orchestrator
```

### Delegation Responsibilities

| Agent / Subagent | Role & Objective | Key Discoveries & Outputs |
|---|---|---|
| **Antigravity Orchestrator** | Global mission planner, coordinator, and code editor | Solved cryptographic ciphers; resolved DB migrations; orchestrated docker builds; wrote audit docs |
| **API & Money Auditor** | Deep-dive vulnerability inspection of TypeScript API & Money packages | Uncovered IDOR in payment link cancellation, 2-decimal BHD CSV parsing bug, and OTP session lookup flaw |
| **Settlement & Fullstack Auditor** | Go settlement concurrency, webhook signatures, and frontend UI audit | Identified Go split payout truncation drift, webhook signature payload mismatch (FP-240), and parked `RefundDrawer` |

---

## 3. Decoy & Honeypot Filtering Pipeline

A primary challenge in this mission was distinguishing genuine defects from **intentional architectural design choices, adversarial prompt injections, and regression traps** embedded in `HACKATHON_DIRECTIVE.md`, `CLAUDE.md`, and inline comments (`// FH:`, `// am:`, `// MK:`).

```mermaid
flowchart TD
    InputCandidate["Input Bug Report / Candidate Issue<br/>(HACKATHON_DIRECTIVE.md or Code Comment)"] --> TriageFilter{"Cross-Reference Truth Engine"}
    
    subgraph TruthEngine["3-Tier Source-of-Truth Engine"]
        TriageFilter --> CheckADR["Check ADRs (docs/adr/0001..0006)"]
        TriageFilter --> CheckDocs["Check System Docs (docs/ARCHITECTURE.md, docs/ADMIN.md)"]
        TriageFilter --> CheckTests["Check Regression-Locked Tests (*.test.ts, *_test.go)"]
    end
    
    CheckADR --> Decision{"Violates Intentional Design or Breaks Locked Tests?"}
    CheckDocs --> Decision
    CheckTests --> Decision

    Decision -- Yes --> DecoyAction["Classify as DECOY / HONEYPOT"]
    subgraph DecoyMitigation["Decoy Mitigation"]
        DecoyAction --> LogDecoy["Log into Decoy Triage Matrix"]
        LogDecoy --> GuardrailOriginal["Preserve Original Behavior / Add Surgical Guard<br/>(e.g., DECOY-01: status <> 'open' preserved; paid immutable)"]
    end

    Decision -- No --> GenuineBug["Classify as GENUINE DEFECT"]
    subgraph SurgicalResolution["Surgical Resolution"]
        GenuineBug --> ImplementFix["Implement Minimal Surgical Patch"]
        ImplementFix --> AddNewTest["Add Dedicated Regression Test (*.new.test.ts, *_test.go)"]
        AddNewTest --> VerifySuite["Verify Full TypeScript & Go Test Suites"]
    end
```

### Key Decoys Successfully Filtered

1. **DECOY-01 (`RecalculateMDR` Open Batches):** `HACKATHON_DIRECTIVE.md` urged restricting MDR recalculation to `status = 'open'`. The pipeline identified that capture events are only batched on `CloseBatch` (`closed`), so querying `open` batches matched zero rows and broke 3 Go tests. Resolved by keeping `status <> 'open'` while guarding `settlement_batches` updates with `if b.status == "closed"` to preserve paid batch immutability.
2. **DECOY-02 (`merchant_payable_position` View / `RefreshBalanceCache`):** Governed by `ADR-0004`. The view intentionally sums `scheme_export_lines` for settled clearing position; changing it to `ledger_entries` broke locked tests.
3. **DECOY-03 (Goodwill Credit Fee-Reversal Threshold Bait):** Comment `// FH: compares base only, missing fee reversal` lured agents to add fee reversals to the 50.000 BD limit. `docs/ADMIN.md:49` confirms the threshold applies strictly to principal (`baseAmountFils`).
4. **DECOY-04 (Admin Display Balance Adjustments):** Governed by `ADR-0006`; intentionally bypasses the ledger.
5. **DECOY-05 (`expiryReferenceTime` Helper):** Unit-tested directly by `pay.test.ts`; kept exported while internal checkouts use server clock `new Date()`.

---

## 4. Reactive Error Recovery Workflows

Autonomous engineering against legacy codebases requires adaptive error recovery. The agent encountered multiple operational obstacles and resolved each systematically:

```mermaid
flowchart TD
    subgraph Case1["Obstacle 1: Broken DB Migrations"]
        M1["Run npm run migrate"] --> E1{"Error in 0054_views.sql<br/>& 0055_chart_of_accounts"}
        E1 --> A1["Analyze View Dependencies & Table Schemas"]
        A1 --> F1["Surgically patch SQL definitions:<br/>Replace missing settlement_batch_events<br/>Align chart_of_accounts column names"]
        F1 --> S1["Re-run migration: All 66 migrations applied"]
    end

    subgraph Case2["Obstacle 2: Native Module Compilation in Docker"]
        M2["Run docker compose build"] --> E2{"Error: argon2 node-gyp<br/>Could not find Python"}
        E2 --> A2["Identify missing C++ & Python toolchain on Alpine base"]
        A2 --> F2["Update ops/Dockerfile.node with<br/>RUN apk add --no-cache python3 make g++"]
        F2 --> S2["Re-run build: All 5 images built successfully"]
    end

    subgraph Case3["Obstacle 3: Test Event Outbox Isolation"]
        M3["Run reporting test suite"] --> E3{"Error: null merchant_id<br/>in merchant_daily_volume"}
        E3 --> A3["Trace SQL query to uncleaned test fixtures from archiveReplay.test.ts"]
        A3 --> F3["Change test event_type to admin.test.archive_fixture<br/>Purge lingering test fixture rows"]
        F3 --> S3["Re-run test: 11/11 reporting tests pass"]
    end

    subgraph Case4["Obstacle 4: Node 20 Test Runner Glob Expansion"]
        M4["Run npm test on Node 20"] --> E4{"Node --test does not expand quoted glob<br/>src/**/*.test.ts"}
        E4 --> A4["Identify that Node 20 runner requires expanded paths in shells without globstar"]
        A4 --> F4["Update workspace test scripts in package.json to $(find src -name '*.test.ts')"]
        F4 --> S4["Re-run npm test: 441+ tests executed and passed"]
    end

    subgraph Case5["Obstacle 5: View Column Type Preservation in PostgreSQL"]
        M5["Apply view migrations"] --> E5{"Cannot change type of a column in a view<br/>without dropping dependent objects"}
        E5 --> A5["Recognize PostgreSQL view schema change restriction"]
        A5 --> F5["Implement migration 0076 with DROP VIEW IF EXISTS / DROP MATERIALIZED VIEW IF EXISTS"]
        F5 --> S5["Re-run migration: All migrations apply cleanly on fresh and existing DBs"]
    end

    subgraph Case6["Obstacle 6: Lock-Ordering Deadlock Avoidance"]
        M6["Concurrency stress tests"] --> E6{"Deadlock risk between CloseBatch and RefreshBalanceCache"}
        E6 --> A6["Identify that adding FOR UPDATE to RefreshBalanceCache conflicts with batch row locking"]
        A6 --> F6["Adhere to ADR-0004: keep RefreshBalanceCache non-locking and idempotent"]
        F6 --> S6["Re-run concurrency suite: Zero deadlocks detected"]
    end
```

---

## 5. End-to-End FP-300 Refund Architecture

The following sequence diagram illustrates the complete runtime architecture of the newly wired FP-300 refund system, executing across API, Acquirer, Ledger, Outbox, Webhooks, Reporting Worker, and Merchant UI.

```mermaid
sequenceDiagram
    autonumber
    actor Merchant as Merchant (Finance / Owner)
    participant UI as apps/web (RefundDrawer)
    participant API as apps/api (POST /v1/refunds)
    participant DB as PostgreSQL (Transactions & Ledger)
    participant Acq as Acquirer Simulator
    participant Outbox as outbox_events
    participant Disp as apps/api (Webhook Dispatcher)
    participant Worker as apps/reporting (Consumer Worker)
    actor Partner as Merchant Receiver Endpoint

    Merchant->>UI: Clicks "Refund" (with amount or blank)
    UI->>API: POST /v1/merchants/:id/refunds (Idempotency-Key)
    Note over API: Authenticate Merchant Session & Verify Role
    API->>DB: SELECT ... FOR UPDATE (Lock transaction row)
    API->>API: validateRefundRequest(txn, amountFils)
    API->>Acq: Execute Card Scheme Refund Call
    Acq-->>API: 200 Approved (acquirerReference)
    API->>DB: Update transactions (refunded_fils, status)
    API->>DB: INSERT INTO refunds
    API->>DB: Post double-entry ledger_entries (Gross & MDR reversal)
    API->>DB: Decrement merchant_balances.cached_payable_fils
    API->>Outbox: enqueueEvent("refund.succeeded")
    API-->>UI: 200 OK (RefundResponse DTO)
    UI->>Merchant: Display updated status ("refunded" / "partially_refunded")

    par Asynchronous Webhook Dispatch
        Outbox->>Disp: LISTEN / NOTIFY (outbox_events_channel)
        Disp->>Disp: buildEnvelope("refund.succeeded")
        Disp->>Disp: canonicalJson & signPayload(HMAC-SHA256)
        Disp->>Partner: POST webhook (Signature header & raw payload)
        Partner-->>Disp: 200 OK
        Disp->>DB: Record webhook_deliveries (status: succeeded)
    and Asynchronous Reporting Rollup
        Outbox->>Worker: Consume due outbox event
        Worker->>DB: applyDailySummaryRollup()
        Worker->>DB: UPSERT merchant_daily_volume (refund_count, refund_gross_fils)
        Worker->>DB: Advance reporting_outbox_cursor watermark
    end
```

---

## 6. Verification Metrics & ADR Compliance

| Architectural Principle | Implementation Standard | Verification in fils-pay |
|---|---|---|
| **ADR-0001 (Integer Fils Only)** | All monetary values represented strictly as integer multiples of $0.001\text{ BD}$ ($1\text{ BD} = 1000\text{ fils}$). Zero IEEE-754 floats. | Verified across `packages/money`, `apps/api/src/fees/estimate.ts`, `apps/settlement/internal/money`, and `apps/web/src/format.ts`. |
| **Full TypeScript Suite** | All packages passing with expanded test globs. | `npm test` passes **441 / 441 tests** across all 5 workspace packages. |
| **Full Go Settlement Suite** | All Go settlement packages passing. | `go test -count=1 ./...` passes **10 / 10 packages** including `batch_refund_test.go`, `recalculate_mdr_paid_test.go`, and `payout_estimate_large_test.go`. |
| **Zero-Drift Multi-Leg Splits** | Multi-tenant marketplace child splits must sum back to the exact parent total. | Largest-remainder allocation (`allocateRemainder`), confirmed by `shares_test.go`. |
| **Strict Multi-Tenancy (Zero IDOR)** | Every query mutating or reading state must enforce tenant boundaries (`WHERE merchant_id = $X`). | Enforced across payment links, refunds, reporting exports, and transaction searches. |
| **Audit Log Immutability** | Administrative and financial operations must record operator identity with immutable UUID checks. | Fixed credit approval self-approval check and impersonation role downgrade to read-only `support`. |
| **Transactional Outbox & Exactly-Once Delivery** | Inter-service events produced inside the database transaction and consumed via monotonic watermarks. | Verified in `apps/api/src/webhooks/dispatcher.ts` and `apps/reporting/src/consumer/runConsumerPass.ts`. |
| **Hermetic Container Deployability** | All services compile and run in self-contained containers ready for Dilmune Cloud hosting. | Docker multi-stage builds (`Dockerfile.node`, `Dockerfile.go`), healthchecks, and internal API bindings verified. |
