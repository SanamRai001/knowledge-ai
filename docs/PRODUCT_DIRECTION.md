# Knowledge AI Product Direction

> **Current-state note — 2026-09-26**
>
> The original document-assistant positioning below remains the trust foundation, but the implemented product has expanded substantially beyond document Q&A. Product Phases 0–8 and Production Hardening A–J are complete on `main`.
>
> For the authoritative description of what exists today, what is definitely next, and what remains optional future work, read:
>
> `docs/CURRENT_PRODUCT_STATE_AND_ROADMAP.md`
>
> Current committed next objective: **L1 — Real staging promotion**.
>
> Do not interpret older “advanced/future” wording in this file as evidence that a capability is still missing; check the canonical current-state roadmap first.

## Positioning

**Knowledge AI is a trustworthy private company intelligence platform for teams.**

It helps teams bring company knowledge and structured data into one governed system that can:

- answer questions with evidence
- surface useful Insights
- maintain Living Company Knowledge
- propose and confirm safe Actions
- Watch important conditions
- connect external sources
- run controlled low-risk Automation

The product is not sold as “GraphRAG”, “CRAG”, “multi-agent mediation”, or a collection of AI phases. Those are implementation mechanisms.

The user-facing promise is:

> Bring your company's information. Knowledge AI turns it into a living, explainable understanding of the business that can answer, discover, update, and monitor—without giving up provenance, permissions, or safe approval boundaries.

## Primary users

The first target users should be small and medium teams that already have important knowledge trapped in PDFs and internal documents:

- HR / policy teams
- operations teams using SOPs and manuals
- customer-support teams using product documentation
- software teams using runbooks and technical documentation
- training and onboarding teams
- consultancies creating private knowledge assistants for clients

## Core jobs to be done

### 1. Find an answer quickly

A user should not have to manually open multiple PDFs and search each one.

### 2. Verify the answer

Every material factual answer should make it easy to inspect the supporting source.

### 3. Know when the system does not know

A high-quality refusal is better than a plausible unsupported answer.

### 4. Ask follow-up questions naturally

Conversational context should resolve references such as “it”, “that policy”, “that model”, or “the second location” without treating prior assistant output as authoritative evidence.

## Default product surface

The normal authenticated experience should emphasize:

- **Home / attention**
- **Ask**
- **Insights**
- **Knowledge**
- **Watch**

Task-oriented surfaces may include:

- **Actions / approvals**
- **Integrations**
- **Automation**

Privileged/admin surfaces include:

- organization/member administration
- Platform/API-key administration
- integration lifecycle controls
- Automation policy administration
- operator diagnostics/recovery

Developer-facing capabilities should remain separate from normal product navigation:

- stable API documentation/explorer
- provider/system diagnostics where authorized
- benchmark/evaluation tooling
- internal retrieval/orchestration implementation details

The normal user should not need to understand GraphRAG, CRAG, internal phase numbers, or retired prototype surfaces.

## Trust contract

Knowledge AI should follow these invariants:

1. Workspace documents are the authoritative factual source unless a workspace explicitly enables external knowledge.
2. Retrieval runs on every grounded factual turn.
3. Assistant chat history may help resolve the question, but does not become authoritative evidence.
4. Generated claims must be checked against retrieved evidence.
5. Citations must point to evidence actually used to support the answer.
6. Insufficient evidence should produce an abstention/refusal.
7. Production benchmark scores must not depend on hard-coded benchmark answers.
8. Simulated provider behavior must never be presented as measured live-provider performance.
9. Estimated telemetry must be labeled as estimated.
10. Security and tenant isolation outrank answer convenience.

## Provider strategy

Do not call multiple paid models for every request.

Recommended routing:

```text
Normal grounded question
        ↓
Primary provider
        ↓
claim verification
        ↓
answer
```

For high-risk or difficult requests:

```text
retrieval
   ↓
primary model answer
   +
independent verifier model
   ↓
disagreement / evidence arbitration
   ↓
final answer or abstention
```

For provider outages:

```text
primary provider
   ↓ failure / rate limit
fallback provider
```

A second provider should be added only after baseline metrics are trustworthy enough to prove whether it improves correctness, reliability, or refusal behavior.

## MVP success criteria

The first strong product milestone is not “more features”. It is a reliable document assistant that can demonstrate:

- strong retrieval recall
- strong citation precision
- low unsupported-claim rate
- high refusal accuracy
- low false-refusal rate
- correct conversational follow-up behavior
- acceptable response latency
- clear source inspection UX

## Non-goals for the current milestone

- generic open-domain chatbot
- autonomous company agent
- large marketplace of agents
- dozens of model providers
- self-modifying production knowledge
- claiming enterprise readiness from simulated telemetry

Those can be explored later if the core document-answering product proves useful and trustworthy.
