# FilsPay — Agent System Architecture (`AGENT_ARCHITECTURE.md`)

This document details the multi-agent system architecture, specialized skill activations, tool coordination, and error-recovery workflows utilized to complete the hackathon mission across all four phases.

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
        Phase4 --> TestSuites["Run Full Test Suites<br/>(npm test: 430/430, go test: 10/10)"]
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

## 3. Reactive Error Recovery Workflows

Autonomous engineering against legacy codebases requires adaptive error recovery. The agent encountered multiple realistic operational obstacles and navigated each systematically without manual user intervention.

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
```

---

## 4. End-to-End FP-300 Refund Architecture

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

## 5. Architectural Quality Attributes & ADR Compliance

| Architectural Principle | Implementation Standard | Verification in fils-pay |
|---|---|---|
| **ADR-0001 (Integer Fils Only)** | All monetary values represented strictly as integer multiples of $0.001\text{ BD}$ ($1\text{ BD} = 1000\text{ fils}$). Zero IEEE-754 floats. | Verified across `packages/money`, `apps/api/src/lib/decimal.ts`, `apps/settlement/internal/money`, and `apps/web/src/format.ts`. |
| **Zero-Drift Multi-Leg Splits** | Multi-tenant marketplace child splits must sum back to the exact parent total. | Replaced Go division truncation with largest-remainder allocation (`allocateRemainder`), confirmed by `shares_test.go`. |
| **Strict Multi-Tenancy (Zero IDOR)** | Every query mutating or reading state must enforce `WHERE merchant_id = $X`. | Enforced across payment links, refunds, reporting exports, and transaction searches. |
| **Audit Log Immutability** | Administrative and financial operations must record exact operator identity and immutable UUID comparisons. | Fixed credit approval self-approval check and impersonation role downgrade to read-only `support`. |
| **Transactional Outbox & Exactly-Once Delivery** | Inter-service events must be produced inside the database transaction and consumed via monotonic watermarks. | Verified in `apps/api/src/webhooks/dispatcher.ts` and `apps/reporting/src/consumer/runConsumerPass.ts`. |
| **Hermetic Container Deployability** | All services must compile and run in self-contained containers ready for Dilmune Cloud hosting. | Docker multi-stage builds (`Dockerfile.node`, `Dockerfile.go`), healthchecks, and internal API bindings verified. |
