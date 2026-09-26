# Knowledge AI — Long-Term Product Vision

Status: **North-star product and architecture specification**  
Last reviewed against current product: **2026-09-26**

> This document remains the long-range north star.
>
> Many capabilities that were originally described here as future work now exist in the implemented product, including structured data, Insights, Living Company Knowledge, safe Actions, Watch, Integrations, controlled Automation, durable production state, worker execution, and production hardening.
>
> Do **not** use this file to determine current implementation status or committed next work.
>
> Use `docs/CURRENT_PRODUCT_STATE_AND_ROADMAP.md` for:
>
> - what is implemented today
> - the committed L1–L5 launch roadmap
> - optional future ideas that are not yet promises
>
> This vision file should stay broader and more aspirational than the current roadmap.

---

## 1. One-sentence vision

**Knowledge AI is a living intelligence layer for a company: it reads the company's information, understands and connects it, analyzes what is happening, answers questions with evidence, safely updates company knowledge, and proactively surfaces important risks, opportunities, deadlines, changes, and actions.**

The final product should feel less like "ChatGPT with files" and more like an always-available company analyst, knowledge operator, and attention system.

---

## 2. The problem we are solving

Companies already possess huge amounts of useful knowledge, but it is fragmented across:

- PDFs
- Word documents
- spreadsheets
- CSV exports
- contracts
- invoices
- policies
- SOPs
- meeting notes
- project plans
- sales reports
- inventory sheets
- customer lists
- internal databases
- email and communication systems
- cloud drives
- manually entered updates

The problem is not simply that employees cannot search those files.

The deeper problems are:

1. People do not know everything the company already knows.
2. Important information is disconnected across files and systems.
3. Structured data contains patterns that ordinary document search cannot discover.
4. People often do not know which question they should ask.
5. Deadlines, anomalies, risks, and opportunities are noticed too late.
6. Company information changes continuously, while documents become stale.
7. Updating business systems is tedious because users must understand the structure of every tool.
8. AI answers are hard to trust when they cannot show exactly where a claim came from.

Knowledge AI should solve all of these progressively.

---

## 3. Product evolution

Knowledge AI should evolve through four major capabilities:

```text
READ
  ↓
UNDERSTAND
  ↓
ACT
  ↓
WATCH
```

### 3.1 READ

The system can ingest company knowledge and answer questions from it.

Examples:

- "What is our refund policy?"
- "When does this contract expire?"
- "What did we decide about Project Atlas?"

This is the foundation the current repository is already pursuing through grounded retrieval, citations, reranking, graph retrieval, corrective retrieval, and refusal behavior.

### 3.2 UNDERSTAND

The system does not wait for a user to ask every question. It analyzes documents and datasets and identifies useful findings.

Examples:

- revenue declined unusually this month
- one branch is underperforming
- inventory may run out soon
- several invoices are overdue
- a contract deadline is approaching
- two documents contradict each other
- a meeting created commitments that do not exist in the project tracker
- a product has significantly higher margins than expected

### 3.3 ACT

Users can change company state through natural language, while Knowledge AI safely translates language into structured operations.

Examples:

- "We got an order from Suman for four chairs at NPR 18,000 each. He paid NPR 20,000 advance."
- "Suman paid another NPR 10,000 today."
- "Move the launch deadline to October 14."
- "We received 30 units from ABC Supplier."
- "Change Product A's approved price to NPR 5,500 starting next Monday."

Knowledge AI should extract the proposed change, locate the correct business object/source, validate the change, show a preview when necessary, request approval based on risk, execute the write, and record a complete audit history.

### 3.4 WATCH

The system continuously monitors knowledge and business state for conditions worth attention.

Examples:

- "Tell me when unpaid invoices exceed NPR 500,000."
- "Warn me if this product is likely to run out within seven days."
- "Tell me when the contract is 30 days from expiry."
- "Watch sales and tell me when something unusual happens."
- "Tell me if this week's project status contradicts the signed specification."

This turns Knowledge AI from an on-demand assistant into a proactive intelligence system.

---

## 4. Core product promise

The long-term product promise is:

> **Bring your company's information. Knowledge AI turns it into a living, explainable understanding of the business that can answer, discover, update, and monitor.**

The product should ultimately support five user-facing concepts:

1. **Ask** — ask the company anything.
2. **Insights** — discover what the user did not know to ask.
3. **Knowledge** — inspect documents, datasets, entities, sources, and history.
4. **Actions** — add or update company information through controlled natural-language operations.
5. **Watch** — monitor deadlines, thresholds, changes, anomalies, and important conditions.

These are product concepts. Internal implementation names such as RAG, GraphRAG, CRAG, embeddings, agents, rerankers, and provider mediation should remain primarily implementation details.

---

## 5. Knowledge AI is not one giant LLM

A critical architectural rule is that the "brain" and the "company memory" are different systems.

```text
                        KNOWLEDGE AI

             ┌────────────────────────┐
             │     REASONING MODEL    │
             │ Gemini / Claude / GPT  │
             │ or open/local model    │
             └────────────┬───────────┘
                          │
        ┌─────────────────┼──────────────────┐
        ↓                 ↓                  ↓
   COMPANY MEMORY     ANALYTICS          TOOLS/ACTIONS
        │                 │                  │
   documents          SQL/statistics      update data
   structured DB      anomaly detection   create tasks
   vector index       forecasting         reminders
   graph/relations    comparisons         notifications
   event history      calculations        integrations
```

The LLM should reason over evidence and tool results.

The LLM should **not** be treated as the authoritative storage layer for company facts.

We should not train or fine-tune a new foundation model every time a company uploads its information.

---

## 6. Where company knowledge lives

Knowledge AI should eventually use multiple complementary storage layers rather than forcing everything into one format.

### 6.1 Raw source storage

Preserve original authoritative files:

- PDF
- DOCX
- XLSX
- CSV
- images/scans
- presentations
- exports
- attachments

Recommended long-term destination: object storage such as S3-compatible storage, Google Cloud Storage, Azure Blob Storage, or a self-hosted equivalent.

The original source should remain immutable where practical. Derived representations should point back to it.

### 6.2 Relational application database

A relational database should store durable application and company state.

Recommended default: PostgreSQL.

Examples of entities:

- Organization
- Workspace
- User
- Role
- Permission
- Source
- Document
- DocumentVersion
- Dataset
- DatasetVersion
- Entity
- Relationship
- Fact
- Insight
- Alert
- WatchRule
- Task
- Reminder
- BusinessEvent
- ProposedChange
- ApprovedChange
- AnalysisRun
- Conversation
- AuditLog

Structured business records such as orders, customers, products, payments, and inventory may live in domain tables or connected external systems rather than being represented only as chunks of text.

### 6.3 Vector / retrieval index

Use a vector-capable retrieval layer for semantic search over unstructured and semi-structured knowledge.

Possible technologies include:

- PostgreSQL + pgvector
- Qdrant
- another production-ready vector/search engine

The system should support hybrid retrieval rather than vector-only retrieval:

- dense semantic retrieval
- lexical/full-text retrieval
- metadata filters
- reranking
- structured lookups when appropriate

### 6.4 Analytical layer

Structured datasets must remain queryable as structured data.

Do **not** turn a 100,000-row spreadsheet into only text chunks and expect an LLM to calculate business analytics reliably.

Possible analytical engines:

- PostgreSQL for initial operational analytics
- DuckDB for file-oriented analytical workloads
- ClickHouse or another OLAP store later if scale requires it
- controlled Python/statistical jobs for specialized analysis

### 6.5 Knowledge graph / relationship layer

A graph can represent relationships such as:

```text
Customer → placed → Order
Order → contains → Product
Product → supplied by → Supplier
Supplier → governed by → Contract
Contract → contains → Deadline
Employee → owns → Project
Project → has → Milestone
```

A dedicated graph database is **not automatically required**. Start with relational/derived graph structures and introduce specialized graph infrastructure only when measured retrieval or reasoning needs justify it.

### 6.6 Event history

Company state should have history.

Instead of only storing:

```text
invoice.remaining = 42000
```

also preserve meaningful events:

```text
OrderCreated
PaymentReceived
OrderCancelled
InventoryReceived
PriceChanged
PolicyUpdated
ContractRenewed
DeadlineMoved
```

This creates a timeline Knowledge AI can reason about and makes auditing, rollback, temporal questions, and "what changed?" features possible.

---

## 7. Hugging Face's role

Hugging Face is **not where company knowledge is stored**.

Hugging Face may provide models and ML components for tasks such as:

- embedding generation
- reranking
- classification
- entity extraction
- document understanding
- table understanding
- summarization
- time-series forecasting
- anomaly detection
- local/open-weight LLM inference

Conceptually:

```text
Hugging Face / model provider
           ↓
        MODELS

Company files + databases
           ↓
        KNOWLEDGE
```

The architecture should let us replace individual models without rebuilding the entire product.

---

## 8. Model/provider strategy

Do not create a proprietary foundation model as a prerequisite for the product.

Use capable existing models through a stable provider interface.

Target abstraction:

```text
LLMProvider
  generate()
  stream()
  capabilities()
  healthCheck()

EmbeddingProvider
  embedText()
  embedBatch()

RerankerProvider
  rerank()

ProviderRouter
  primary
  fallback
  optional verifier
```

Initial cloud/provider usage can be server-managed for a smooth user experience.

Long-term deployment options may include:

- Knowledge AI managed provider
- Gemini
- OpenAI-compatible providers
- Anthropic
- local/open-weight models
- enterprise-managed providers
- BYOK (bring your own key)

BYOK is an optional deployment/control feature, not the central product experience.

---

## 9. Ingestion architecture

All incoming information should pass through an ingestion pipeline that understands the source type.

```text
SOURCE
  ↓
file / API / user message / database / integration
  ↓
TYPE DETECTION
  ↓
┌───────────────────────────┬────────────────────────────┐
│ UNSTRUCTURED              │ STRUCTURED                 │
│ PDF/DOCX/text             │ XLSX/CSV/database          │
└──────────────┬────────────┴──────────────┬─────────────┘
               ↓                           ↓
         parse/layout                 schema inference
         sectioning                   type inference
         chunking                     data quality checks
         entities                     normalization
         metadata                     table registration
               ↓                           ↓
        retrieval index              analytical store
               └──────────────┬────────────┘
                              ↓
                       KNOWLEDGE LAYER
                              ↓
                entities / facts / relations
                              ↓
                    discovery + answering
```

Every derived item should preserve provenance back to the original source/version.

---

## 10. Structured data and spreadsheet intelligence

Spreadsheet support should become a first-class product capability.

When a user uploads a spreadsheet, Knowledge AI should inspect:

- sheets
- headers
- inferred column types
- dates
- currencies
- categorical fields
- identifiers
- missing values
- duplicate rows
- totals
- relationships between sheets
- likely business semantics

Example:

```text
sales.xlsx

Date        → date
Product     → categorical/entity
Quantity    → integer
Revenue     → currency
Cost        → currency
Branch      → categorical/entity
Customer    → entity
```

The system can then make the dataset queryable through safe analytical tools.

Natural-language question:

> Why was August revenue lower?

Potential execution:

```text
question
  ↓
analytical plan
  ↓
validated SQL / calculation tools
  ↓
results
  ↓
statistical checks
  ↓
LLM interpretation
  ↓
evidence-backed explanation
```

**Code should perform calculations; the LLM should interpret results.**

Never rely on an LLM alone to accurately calculate large datasets row by row.

---

## 11. Discovery Engine

The Discovery Engine is one of the most important long-term differentiators.

Its purpose is:

> **Find important things the user did not know to ask about.**

Possible detector families:

```text
DiscoveryEngine
├── TrendDetector
├── AnomalyDetector
├── DeadlineExtractor
├── ChangeDetector
├── OverdueDetector
├── InventoryRiskDetector
├── MarginDetector
├── CustomerPatternDetector
├── CorrelationExplorer
├── ContradictionDetector
├── MissingRequirementDetector
└── OpportunityDetector
```

A detector should create structured candidate findings before an LLM turns them into human-readable insight.

Example:

```text
Insight
  type: ANOMALY
  title: "Cancellation rate increased"
  severity: HIGH
  metrics:
    previousRate: 0.032
    currentRate: 0.091
  source: orders.xlsx
  evidenceRange: rows / query reference
  confidence: 0.94
  generatedAt: ...
```

The LLM may explain *why the finding matters*, but it must not invent the underlying measurement.

---

## 12. Insight quality and prioritization

Knowledge AI should not overwhelm users with hundreds of observations.

Insights need ranking based on factors such as:

- severity
- financial impact
- urgency
- confidence
- novelty
- trend strength
- number of affected records
- user role
- user preferences
- whether the issue is already acknowledged

The product should aim to surface **a few important things**, not reproduce a BI dashboard containing every metric.

Example home experience:

```text
Good morning.

3 things need your attention

URGENT
Supplier payment due in 2 days
NPR 127,000

WATCH
Product A may run out in approximately 8 days

OPPORTUNITY
Customers who buy Product B frequently purchase Product D within 30 days
```

---

## 13. Ask: conversational company intelligence

The existing grounded Q&A capability remains essential.

The long-term Ask system should route questions to the correct knowledge mechanism.

```text
QUESTION
  ↓
intent / planning
  ↓
┌──────────────────────────────────────────────────────┐
│ documents | structured data | graph | event history │
│ analytics | external integrations | mixed evidence  │
└──────────────────────────────────────────────────────┘
  ↓
retrieve / calculate / investigate
  ↓
verify
  ↓
answer
  ↓
citations + analytical provenance
```

Examples:

- "What is our leave policy?" → document retrieval
- "How much revenue did we make last month?" → structured analytics
- "Which supplier contract covers Product X?" → graph/relational traversal
- "What changed since Monday?" → version/event comparison
- "Why are margins lower?" → multi-step analytical investigation

The assistant should choose tools based on the question rather than forcing every question through the same RAG pipeline.

---

## 14. Natural-language writes and company updates

Knowledge AI should eventually allow users to maintain company information conversationally.

Example user input:

> "We got an order from Suman for 4 chairs at NPR 18,000 each. Delivery is September 25 and he paid NPR 20,000 advance."

The system should parse this into a proposed structured operation:

```text
customer: Suman
orderDate: 2026-09-17
item: Chair
quantity: 4
unitPrice: 18000
total: 72000
paid: 20000
remaining: 52000
deliveryDate: 2026-09-25
status: CONFIRMED
```

Then:

```text
user message
    ↓
intent + entity extraction
    ↓
find destination / authoritative model
    ↓
validate
    ↓
calculate effects
    ↓
preview proposed change
    ↓
approval if required
    ↓
transactional write
    ↓
audit event
    ↓
re-analysis / downstream effects
```

### 14.1 Do not make Excel the canonical database

For a prototype it can be impressive to show an Excel row being updated.

For the full product, the safer architecture is:

```text
             KNOWLEDGE AI DATA MODEL
                       │
          ┌────────────┼─────────────┐
          ↓            ↓             ↓
      Excel import  Sheets sync   CSV export
```

Structured business state should live in a durable database or authoritative connected system.

Excel/CSV is an input, output, or synchronized representation—not necessarily the ultimate source of truth.

### 14.2 Document changes

Documents such as policies and SOPs need versioning rather than silent destructive edits.

```text
Policy v1
  ↓ approved change
Policy v2
```

Store:

- old value/text
- new value/text
- effective date
- actor
- reason
- approval
- source
- version

The assistant should be able to answer temporal questions such as:

> What was the policy in August?

---

## 15. Information authority and truth model

Not every statement should instantly become company truth.

Knowledge AI should model source authority.

Illustrative hierarchy (workspace-configurable):

```text
1. Signed / approved legal document
2. Approved company policy
3. Authoritative operational database
4. Approved structured dataset
5. Meeting minutes
6. Employee statement
7. Unverified observation
8. AI inference
```

If sources disagree, Knowledge AI should expose the conflict rather than silently select whichever text was retrieved first.

Example:

> The approved pricing sheet lists Product A at NPR 5,000. Your message proposes NPR 4,000. Would you like to submit a price change?

AI-generated inference must never silently become authoritative company fact.

---

## 16. Observations vs facts vs inferences

The knowledge layer should explicitly distinguish:

### Fact

A claim supported by an authoritative source.

### Observation

Information entered or detected but not yet confirmed as authoritative.

Example:

> "Customers have recently been complaining that deliveries are late."

### Inference

A conclusion produced from facts/observations/data.

Example:

> "Delivery delays appear correlated with Supplier B's late material arrivals."

### Prediction

A forward-looking estimate.

Example:

> "At the current sales rate, Product X may run out in approximately 8 days."

The UI should communicate these distinctions clearly.

---

## 17. Write safety and approvals

The system may propose changes freely, but write authority must be controlled.

Risk classes can include:

### Low risk

- personal note
- draft task
- non-authoritative tag

May be auto-applied based on settings.

### Medium risk

- create ordinary order
- record payment
- update non-critical operational field

May require confirmation depending on role/workspace configuration.

### High risk

- delete records
- modify approved policy
- change prices
- modify financial data
- alter legal/contract information
- mass update
- external side effects

Must require explicit confirmation/approval and strong permission checks.

Every material write should have:

- actor
- timestamp
- source input
- before state
- after state
- reason
- approval state
- tool/action executed
- correlation/transaction id

---

## 18. Watch Engine

The Watch Engine turns company knowledge into proactive monitoring.

A watch is a persisted condition evaluated over time.

Examples:

```text
WHEN contract.expiry <= 30 days
THEN notify legal/owner

WHEN unpaidInvoiceTotal > 500000
THEN notify finance

WHEN projectedStockDays < 7
THEN notify purchasing

WHEN weeklySales deviates materially from baseline
THEN create insight
```

Watches may be created:

- automatically from extracted deadlines
- manually in natural language
- from company templates
- from insights
- from domain rules

The Watch Engine should be deterministic where possible. An LLM may translate natural language into a validated rule, but recurring evaluation should not require an expensive generative model for simple conditions.

---

## 19. Smart reminders

Reminders should go beyond clock-based reminders.

Traditional:

> Remind me Friday at 10 AM.

Knowledge-aware:

> Remind me three days before this contract expires.

Condition-aware:

> Tell me if this customer has not paid within seven days.

State-aware:

> Remind me when the inventory required for Order #1048 becomes available.

These reminders are derived from business knowledge, not isolated calendar entries.

---

## 20. "What changed?" as a first-class feature

Knowledge AI should make change intelligence easy.

Sources may be versioned over time:

```text
Monday
sales.xlsx
inventory.xlsx
orders.xlsx
project-plan.docx

Friday
updated versions
```

Knowledge AI should be able to produce:

```text
Since Monday:

Revenue        +8.3%
Open orders    +17
Inventory      -11.2%

3 invoices became overdue
2 deadlines were added
1 milestone moved

Unusual:
Product X cancellation rate increased from 3.1% to 9.8%
```

This requires versioning, event history, structured diffs, and analytical comparison—not merely summarizing both documents independently.

---

## 21. Cross-source reasoning

One of the most valuable capabilities will be connecting information across sources.

Examples:

### Specification vs tracker

- specification says mobile offline mode is required
- project tracker contains no corresponding task
- Knowledge AI flags the gap

### Contract vs payment ledger

- contract requires payment by September 29
- finance dataset shows unpaid balance
- Knowledge AI surfaces the approaching obligation

### Sales vs inventory

- Product X sales velocity increased
- inventory is declining
- replenishment lead time is 14 days
- Knowledge AI predicts a stockout risk

### Meeting vs execution

- meeting notes assign an action to Sanam by October 5
- task system contains no matching task
- Knowledge AI proposes creating one

This is where the product becomes substantially more useful than document chat.

---

## 22. Company knowledge graph / semantic model

Over time the system should develop an explicit semantic model of the company.

```text
                         COMPANY
                            │
       ┌────────────────────┼────────────────────┐
       ↓                    ↓                    ↓
   Customers             Products             Projects
       │                    │                    │
       ↓                    ↓                    ↓
     Orders ─────────── Inventory            Milestones
       │                    │                    │
       └────────────── Revenue ──────────────────┘
                            │
                         Sources
                            │
               Contracts / Policies / Notes
```

This graph is not the same as storing all information in a graph database. It is a semantic layer describing important entities and relationships regardless of the physical storage mechanism.

---

## 23. Suggested domain model

The exact schema will evolve, but future agents should preserve these concepts.

### Tenancy and identity

- Organization
- Workspace
- User
- Membership
- Role
- Permission

### Sources and knowledge

- Source
- SourceVersion
- Document
- DocumentChunk
- Dataset
- DatasetTable
- DatasetColumn
- Entity
- Relationship
- Fact
- Observation
- Inference
- Citation / Provenance

### Intelligence

- AnalysisRun
- Metric
- Insight
- InsightEvidence
- Prediction
- Anomaly
- Contradiction

### Action

- ProposedAction
- Approval
- ActionExecution
- BusinessEvent
- AuditLog

### Proactivity

- WatchRule
- Reminder
- Alert
- Notification

### Conversation

- Conversation
- Message
- ToolInvocation
- EvidenceBundle

---

## 24. Agent architecture

"Agent" should not mean one unconstrained LLM loop with access to everything.

Prefer bounded, testable capabilities.

Possible logical agents/services:

```text
Coordinator
├── RetrievalAgent
├── DataAnalystAgent
├── DocumentAnalystAgent
├── DiscoveryAgent
├── ChangeAgent
├── ActionAgent
├── WatchAgent
└── VerificationAgent
```

Each agent should have:

- a narrow purpose
- explicit tools
- permission boundaries
- structured inputs/outputs
- limits
- traceable evidence
- tests

The coordinator should select the minimum necessary workflow.

Not every request requires multiple agents.

---

## 25. Example end-to-end user flows

### Flow A — Upload and discover

```text
Upload sales.xlsx + inventory.xlsx + supplier-contract.pdf
        ↓
Knowledge AI indexes and profiles them
        ↓
Discovery Engine runs
        ↓
Home shows:

1. Supplier payment due in 9 days
2. Product A projected to run low
3. Category B revenue declined 24%
```

### Flow B — Ask

User:

> Why did Category B decline?

System:

- queries sales history
- compares time periods
- segments by branch/product/customer
- identifies major contributors
- generates explanation
- shows exact dataset/query evidence

### Flow C — Add an order through language

User:

> Suman ordered four chairs at NPR 18,000 each, paid NPR 20,000, delivery September 25.

System:

- extracts fields
- resolves Suman/customer and Chair/product
- computes totals
- previews proposed order
- user approves
- writes transaction
- records event
- updates downstream metrics

### Flow D — Update existing state

User:

> Suman paid another NPR 10,000 today.

System:

- finds matching order/customer
- proposes payment
- verifies amount
- writes payment
- reduces balance
- records event
- recalculates receivables

### Flow E — Knowledge-aware watch

User:

> Tell me if we are likely to run out of any product within 10 days.

System:

- converts request into validated watch rule
- uses stock + sales velocity + lead-time inputs
- evaluates on schedule/new data
- alerts only when condition is met

---

## 26. Home experience

The future home page should not primarily be a document list.

Possible structure:

```text
KNOWLEDGE AI

TODAY
────────────────────────────────
3 things need your attention

[URGENT] Supplier payment due in 2 days
[WATCH]  Product A may run out in ~8 days
[INSIGHT] Product B margin improved 17%

ASK YOUR COMPANY
────────────────────────────────
[ What do you want to know?                         ]

RECENT CHANGES
────────────────────────────────
4 new orders
2 documents updated
1 milestone moved

KNOWLEDGE STATUS
────────────────────────────────
127 documents · 8 datasets · 14,382 entities
Last analyzed 7 minutes ago
```

The core UX principle is:

> **Tell the user what matters before forcing them to hunt through modules.**

---

## 27. Navigation direction

Potential long-term primary navigation:

```text
Home
Ask
Insights
Knowledge
Watch
```

Secondary/admin surfaces may include:

- Sources
- Integrations
- Actions / approvals
- Audit history
- Quality / evaluation
- Workspace settings
- Model/provider settings
- Developer/API settings

"Documents" becomes part of **Knowledge**, not the identity of the entire product.

---

## 28. Integrations

Later phases can connect Knowledge AI directly to company systems.

Potential categories:

- Google Drive
- OneDrive / SharePoint
- Dropbox / Box
- Google Sheets
- Microsoft Excel/Graph
- Gmail / Outlook
- Slack / Teams
- CRMs
- accounting platforms
- databases
- ERP/POS systems
- project management systems
- GitHub
- custom REST APIs
- webhooks

Integrations should map into the same source, provenance, permission, and event architecture rather than becoming isolated one-off features.

---

## 29. External knowledge

Private workspace information should remain the default authority.

External/web knowledge may be optionally enabled for tasks that require it.

The system must clearly distinguish:

- internal authoritative evidence
- external retrieved information
- general model knowledge
- inference

Never silently merge them into one indistinguishable answer.

---

## 30. Trust contract

The trust principles in the current product remain non-negotiable as capabilities expand.

### 30.1 Provenance

Every important factual claim should be traceable to:

- document/page/section
- dataset/query/row scope
- business event
- connected system record
- approved user action

### 30.2 Evidence before assertion

If the evidence is insufficient, say so.

### 30.3 Calculations must be reproducible

Business metrics should come from deterministic calculations/tools, not hidden LLM arithmetic.

### 30.4 AI inference must be labeled

An inferred explanation is different from an observed fact.

### 30.5 Conflicts must be surfaced

Do not hide contradictory sources.

### 30.6 Writes must be auditable

Every material action must be attributable and reversible where practical.

### 30.7 Permissions are authoritative

The AI cannot grant itself authority because a prompt requests it.

---

## 31. Security and privacy direction

Because Knowledge AI may contain a company's most sensitive information, security cannot be an afterthought.

Long-term requirements include:

- strict tenant isolation
- role-based access control
- source-level permissions where required
- encryption in transit and at rest
- secret isolation
- secure file handling
- audit logs
- action approvals
- retention controls
- deletion controls
- export controls
- prompt-injection defense
- tool permission boundaries
- least-privilege integrations
- configurable model/data-sharing policies

An answer must never retrieve evidence the current user is not authorized to see.

---

## 32. Evaluation strategy

Success should be measured separately for each system capability.

### Retrieval/Q&A

- retrieval recall
- reranking recall
- answer correctness
- citation precision
- claim grounding
- refusal accuracy
- false-refusal rate
- hallucination rate

### Structured analytics

- query correctness
- calculation correctness
- schema interpretation accuracy
- anomaly precision/recall
- explanation faithfulness

### Actions

- intent classification accuracy
- entity resolution accuracy
- field extraction accuracy
- validation accuracy
- write correctness
- approval policy correctness
- rollback/audit completeness

### Proactive intelligence

- useful-insight rate
- false-alert rate
- missed-important-event rate
- duplicate insight rate
- time-to-detection
- user dismiss/accept/action rate

### Security

- tenant isolation
- unauthorized retrieval rate
- unauthorized action rate
- prompt-injection resistance

Do not hide weak subsystems behind one overall "AI accuracy" score.

---

## 33. What should remain deterministic

Use LLMs where language understanding and flexible reasoning provide value.

Prefer deterministic systems for:

- arithmetic
- financial calculations
- thresholds
- permissions
- state transitions
- transaction validation
- database writes
- scheduled rule evaluation
- versioning
- audit logs
- duplicate detection where exact matching works

A useful rule:

> **LLMs decide what something means; deterministic tools should decide what the numbers are and whether a write is valid.**

---

## 34. What we should not do

Avoid these traps:

### Do not rebuild a foundation model from scratch

It is not required to create the product and would distract from the actual value.

### Do not convert every data type into plain RAG chunks

Structured data deserves structured querying.

### Do not make the LLM the database

Models are reasoning engines, not durable company memory.

### Do not silently rewrite authoritative documents

Use versioning, approvals, and provenance.

### Do not allow autonomous destructive writes by default

Progressive automation must be earned through permission and trust.

### Do not expose architecture jargon as the product

Users care about answers, insights, actions, and warnings—not GraphRAG terminology.

### Do not add agents because "multi-agent" sounds advanced

Each agent must solve a concrete problem better than a simpler workflow.

### Do not add model providers without measurable value

Provider count is not product quality.

### Do not optimize for a demo in a way that corrupts the long-term data model

Hackathon prototypes can be narrower, but core product principles should remain clear.

---

## 35. Recommended technical target architecture

This is a direction, not an immutable dependency list.

```text
                         FRONTEND
                    React / web client
                           │
                           ↓
                     API / BACKEND
                  TypeScript services
                           │
      ┌────────────────────┼──────────────────────┐
      │                    │                      │
      ↓                    ↓                      ↓
 Knowledge Service   Analytics Service       Action Service
      │                    │                      │
      ↓                    ↓                      ↓
 Retrieval/RAG       SQL / DuckDB / jobs     Validation/approval
      │                    │                      │
      └───────────────┬────┴──────────────┬───────┘
                      ↓                   ↓
                Intelligence / Agent Orchestrator
                      │
              ┌───────┴────────┐
              ↓                ↓
         Model Providers     Tool Registry
              │
              ↓
     Gemini / other LLMs / open models

Persistence
──────────────────────────────────────────────
PostgreSQL       → application + business state
Vector search    → semantic/hybrid retrieval
Object storage   → original source files
Event/audit log  → history and change tracking
Cache/queue      → background work when needed
```

The current monolithic `server.ts` should eventually be modularized around bounded services/modules, but correctness and behavior should remain more important than refactoring for aesthetics.

---

## 36. Background processing

As the system becomes proactive, ingestion and analysis should move toward durable background jobs.

Examples:

- parse newly uploaded file
- extract tables
- create embeddings
- run document entities
- profile dataset
- run detectors
- recalculate insights
- evaluate watch rules
- send notifications
- refresh connected sources

Job execution should be idempotent and observable.

Long-running work should not depend on a single HTTP request remaining open.

---

## 37. Versioning strategy

Version anything whose historical state matters:

- documents
- datasets
- source connections
- business policies
- important structured records
- extracted knowledge where source revisions affect truth

Temporal knowledge should support questions like:

- "What did we know at the time?"
- "What changed?"
- "When did this value change?"
- "Who changed it?"
- "What source caused the update?"

---

## 38. Product phases

The phases below are directional. Do not interpret them as a rigid release calendar.

### Phase 0 — Trustworthy knowledge foundation

Goal: Make the current document assistant genuinely reliable.

- clean retrieval benchmark
- remove benchmark-specific production shortcuts
- strong citations
- refusal behavior
- provider abstraction
- tenant/security baseline
- modularize only where necessary

### Phase 1 — First-class structured data

Goal: Excel/CSV is no longer treated as "just another document".

- robust XLSX/CSV ingestion
- schema inference
- tabular storage/query
- safe calculations
- dataset citations/provenance
- natural-language analytical questions

### Phase 2 — Discovery

Goal: Find important things automatically.

- analysis runs
- trend detection
- anomaly detection
- deadline extraction
- change detection
- insight model
- insight ranking
- Insights UI

### Phase 3 — Living company knowledge

Goal: Model company entities, relationships, events, and versions.

- semantic entity layer
- relationship layer
- source authority
- facts/observations/inferences distinction
- event history
- source/version diffs
- "What changed?"

### Phase 4 — Safe natural-language actions

Goal: Language becomes an interface for company updates.

- action planning
- structured proposed changes
- validation
- approval workflows
- transactional writes
- audit history
- spreadsheet sync/export where useful

### Phase 5 — Watch and proactive intelligence

Goal: Knowledge AI watches the business.

- watch rules
- knowledge-aware reminders
- threshold monitoring
- deadline monitoring
- proactive notifications
- incremental re-analysis

### Phase 6 — Integrations

Goal: Reduce manual uploads.

- drives
- spreadsheets
- communication systems
- databases
- business platforms
- APIs/webhooks

### Phase 7 — Controlled automation

Goal: Trusted low-risk actions can execute automatically.

- workspace policy engine
- per-action risk levels
- role-based automation
- approval thresholds
- rollback/recovery
- automation analytics

### Phase 8 — Platform

Goal: Knowledge AI becomes an extensible company intelligence platform.

- developer APIs
- custom tools
- custom detectors
- domain packs
- organization-specific workflows
- optional self-hosting / enterprise deployment

---

## 39. Builder Fest / hackathon relationship

The Builder Fest version should **not** attempt to build this entire vision.

Hackathon code is a focused proof of the product idea.

A strong demo can cover only a thin vertical slice, for example:

```text
Upload orders.xlsx + inventory.xlsx + contract.pdf
        ↓
AI finds 3 useful insights
        ↓
User asks a question
        ↓
User adds/updates an order conversationally
        ↓
Numbers update
        ↓
AI surfaces an approaching risk/deadline
```

That demo proves the larger direction:

```text
READ → UNDERSTAND → ACT → WATCH
```

The full GitHub project remains the long-term system and should not be reduced to hackathon shortcuts.

---

## 40. Relationship to the current repository

### Keep and strengthen

- document ingestion
- grounded retrieval
- hybrid search
- reranking
- hierarchical retrieval
- corrective retrieval
- knowledge/graph experimentation
- citation system
- claim verification
- conversational resolution
- multilingual retrieval
- abstention/refusal behavior
- evaluation infrastructure
- workspace concept
- provider work

### Modify / evolve

- Documents should become one source type within a broader Knowledge system.
- Structured tables should evolve into a real analytical layer.
- Memory experiments should evolve toward explicit durable company state/history.
- Graph capabilities should serve cross-source entity reasoning rather than exist mainly as an architecture showcase.
- The UI should shift from implementation phases toward Home / Ask / Insights / Knowledge / Watch.
- `server.ts` should gradually become modular as new domains are added.

### Add over time

- relational persistence
- robust file/object storage
- vector/search persistence
- XLSX/CSV ingestion
- analytical query engine
- insights
- source authority model
- business events
- versions/diffs
- action proposals and approvals
- audit trail
- watch engine
- reminders/notifications
- integrations

### Do not throw away

The trustworthy RAG work is not obsolete. It becomes one of the foundational subsystems of the larger company-intelligence product.

---

## 41. North-star UX examples

### Ask

> "What did we agree with ABC Supplier about late deliveries?"

Response includes exact contract/meeting evidence.

### Discover

> "I found that late deliveries increased 31% after Supplier B became the primary source for Product X."

Response links calculation + data evidence and labels this as an inference if causation is not proven.

### Act

> "Record NPR 10,000 payment from Suman."

System previews the correct invoice/order update and executes after required confirmation.

### Watch

> "Tell me if Suman's balance is still unpaid three days before delivery."

System creates a persisted condition.

### Explain

Every card/action has a "Why?" or "Show evidence" path.

---

## 42. Product principles

Future work should be evaluated against these principles.

### Principle 1 — Useful before impressive

The product should solve actual company information problems before adding architecture for its own sake.

### Principle 2 — Proactive, not noisy

Find what matters; do not flood the user with observations.

### Principle 3 — Evidence everywhere

Important claims must be inspectable.

### Principle 4 — Language is an interface, not the database

Users can speak naturally; the system converts language into validated structured operations.

### Principle 5 — Preserve history

Company knowledge changes. Do not destroy the past when recording the present.

### Principle 6 — AI proposes, policy authorizes

Model intelligence never bypasses business permissions.

### Principle 7 — Structured data stays structured

Use the right computational tool for each source.

### Principle 8 — The user should not need to know the architecture

No one should need to understand RAG, embeddings, agents, or vector databases to receive value.

### Principle 9 — Build replaceable AI components

No critical product concept should depend permanently on one model vendor.

### Principle 10 — Grow from trustworthy foundations

A proactive system with bad grounding is worse than a simple reliable Q&A system.

---

## 43. North-star definition

Knowledge AI has reached its long-term vision when a company can connect its important information and experience something like this:

> **Knowledge AI knows what the organization has explicitly told it and can show the evidence. It understands structured operational data. It notices meaningful changes. It can investigate questions across multiple sources. It can safely translate natural language into business updates. It remembers history. It watches conditions over time. It warns people before important things are missed. And it never hides whether something is a fact, an inference, or a prediction.**

At that point, the product is no longer merely a document assistant.

It is a **living, explainable intelligence layer for the organization**.

---

## 44. Guidance for future AI coding agents

When an AI coding agent is asked to continue this repository, it should follow this order:

1. Read `README.md`.
2. Read `docs/PRODUCT_DIRECTION.md` to understand the current milestone.
3. Read `docs/EFFECTIVENESS_AUDIT.md` to understand existing reliability gaps.
4. Read this file (`docs/LONG_TERM_PRODUCT_VISION.md`) to understand the destination.
5. Determine which phase the requested task belongs to.
6. Preserve the trust contract and provenance model.
7. Do not replace working grounded systems merely to adopt a fashionable framework.
8. Separate current capabilities from aspirational architecture in documentation and UI.
9. Prefer incremental migration over unnecessary rewrites.
10. Add tests/evaluations appropriate to the subsystem being changed.

If current implementation and this long-term vision conflict, do not blindly rewrite the system. Treat this file as the destination, determine the safest migration path from the current repository, and document the decision.

---

## 45. Final summary

The project started with an important capability:

> **Ask questions about private documents and receive grounded answers.**

The destination is substantially larger:

```text
                   KNOWLEDGE AI

                      READ
                       ↓
                   UNDERSTAND
                       ↓
                      ACT
                       ↓
                     WATCH

Files + data + events + integrations
              ↓
       Living company memory
              ↓
     Retrieval + analytics
              ↓
     Evidence-backed reasoning
              ↓
Insights + answers + safe actions + alerts
```

**Do not rebuild the brain from scratch. Build the memory, analytical systems, tools, controls, provenance, and product experience that let strong existing models reason safely over a company's real world.**
