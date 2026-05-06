# Feature Research

**Domain:** Single-host Docker Compose AI operator copilot (knowledge layer + state-as-git + tool-use)
**Researched:** 2026-05-06
**Confidence:** HIGH (competitor features verified via official docs/GitHub; knowledge-layer and git-audit patterns verified via multiple source types)

---

## Competitive Baseline

Before categorizing, the relevant products split into two camps:

| Camp | Products | What They Do | What They Miss |
|------|----------|-------------|----------------|
| Docker UI (controls only) | Portainer, Dockge, Dozzle, Beszel, Arcane, Dockhand | Container list/stop/start, compose edit, log tail, metrics | No AI reasoning, no environment domain knowledge, no action audit trail |
| AI infra assistants (k8s-shaped) | k8sgpt, Robusta, HolmesGPT | NL troubleshooting, runbooks, alert correlation | k8s substrate only, no docker-compose native, no per-homelab knowledge |
| AI homelab agents (emerging) | TadMSTR/homelab-agent, herms14/homelab-agent | Claude + MCP over infra docs | Markdown docs only (no RAG query loop), no approval gate, no git audit trail |
| GitOps for docker-compose | Komodo, ConOps, homelab-gitops patterns | Declarative state-in-git, auto-reconcile on push | No NL, no AI reasoning, no action provenance (desired-state not event-log) |

**Key finding**: No existing tool combines (a) per-homelab domain knowledge via RAG, (b) NL → tool-use bridge with approve/deny gate, and (c) action-as-git-commit where the commit body carries user prompt + AI reasoning. That combination is the open niche.

---

## Feature Landscape

### Table Stakes

Features users expect from any Docker operator tool. Missing any of these means the user returns to Dockge or their shell.

| Feature | Why Expected | Complexity | Phase | Notes |
|---------|--------------|------------|-------|-------|
| List containers with status | Every Docker UI has this; `docker ps` is the mental model | S | Phase 1 | `listContainers` tool wraps `docker context dserver ps`. JSON output → LLM formats in prose |
| Tail container logs (NL window query) | Dozzle/Portainer both offer this; "show last N lines" is muscle memory | S | Phase 1 | `readLogs` tool + NL time-window parsing ("last night 1-3am"). Sanitize SECRET/KEY/PASSWORD before prompt |
| View compose file for a stack | Dockge core feature; users want to see what's declared | S | Phase 1 | `readCompose` tool via SSH cat. Read-only in Phase 1 |
| Restart / stop / start a container or stack | Dockge one-click; missing this makes the tool read-only forever | M | Phase 2 | Delivered via `proposePatch` + `applyPatch` with explicit approval gate. Not bare-call |
| Readable error messages | Every tool bundles `docker inspect` errors; raw JSON is unusable | S | Phase 1 | `{ problem, cause, fix }` error envelope on every tool wrapper try-catch |
| Streaming response (not spinner → wall of text) | ChatGPT / OpenWebUI / Aider all stream; waiting 10s for a wall of text feels broken | S | Phase 1 | Hono SSE + htmx `hx-swap="beforeend"` on SSE events |
| Persistent conversation context | Users expect follow-up questions to work ("what about redis?") | S | Phase 1 | Claude tool-use loop keeps message history in-memory per session (SQLite log for durability) |
| Services / stacks known by name | "ais-prod" not "docker context dserver ps -f name=ais" — user talks in domain names | M | Phase 0 + 1 | `services.yaml` is the foundation. Without this, every answer requires user to re-explain topology |

### Differentiators

Features that no existing tool provides in combination. These are the non-replicable value axis.

| Feature | Value Proposition | Complexity | Phase | Competitor Gap |
|---------|-------------------|------------|-------|----------------|
| **Environment-specific knowledge layer (services.yaml RAG)** | AI answers "why is ais-prod redis memory growing?" with your specific topology: which service uses which redis, normal traffic patterns, key log locations — not generic k8s runbook advice | M | Phase 0 (bootstrap) + Phase 1 (query) | Portainer/Dockge: no AI. HolmesGPT: k8s only, pattern runbooks not homelab-specific. homelab-agent (herms14/TadMSTR): markdown docs, no semantic search |
| **Action-as-git-commit with AI reasoning in commit body** | Every `docker compose stop`, env var change, or restart becomes a git commit in `state/`. Commit message = user prompt + AI reasoning summary. `git log state/` is your ops journal, audit trail, and undo ledger simultaneously | M | Phase 2 | Komodo/ConOps: declarative desired-state GitOps (TOML/YAML in git, reconcile on push). That's state-as-desired-config not event-provenance. Nobody logs "user said X, AI decided Y, result was Z" as a git commit |
| **NL → approve/deny gate → exec chain** | User types "stop krdn-fx for the weekend", AI produces unified diff + reasoning, user presses `y` — action executes and commits. Escape hatches: `n` (abort), `e` (edit diff), `d` (show full diff), `a` (abort all). No existing homelab tool has a human-in-the-loop gate before execution | M | Phase 2 | Dockge: one-click no review. Portainer: no AI. HolmesGPT: suggests but delegates execution to human outside the tool. Claude Code plan mode: closest analogy (Shift+Tab enters plan mode, approve before exec), but code-focused not infra-focused |
| **AI-bootstrapped services.yaml from live docker state** | Phase 0: AI reads `docker ps`, compose files, running container labels and generates the initial `services.yaml`. Eliminates 2-4h of manual YAML authoring. Knowledge base self-initializes | S | Phase 0 | No existing tool does this. herms14/homelab-agent requires manual markdown docs. Komodo requires manual TOML |
| **Staleness detection with lazy reconcile** | On startup, diff `docker ps` vs `services.yaml`. If drift detected, show a banner: "3 containers not in services.yaml. Ask AI to update?" Keeps knowledge layer fresh without polling daemon | S | Phase 1 | Nobody ships this for homelab. Komodo detects compose drift for GitOps reconciliation but not AI knowledge drift |

### Anti-Features

Features that are out-of-scope with explicit reasoning. Each entry includes a counter-argument check.

| Feature | Why Requested | Why Out of Scope | Counter-Argument Check | Alternative |
|---------|---------------|-----------------|------------------------|-------------|
| **Pretty dashboard (metrics graphs, CPU/mem charts)** | Portainer/Beszel look polished; users assume a "management tool" has graphs | Beszel (single-binary Go agent, MIT) already covers this 50%. Building equivalent graphs in htmx + SSE adds 2-4 weeks for zero differentiation value | Counter: N/A — Beszel is already deployed on 192.168.0.5 | Install Beszel alongside. Out-of-scope confirmed |
| **Multi-user RBAC / access control** | "What if someone else needs to use it?" | 1-user single-host tool by design. RBAC adds auth middleware, permission model, user table — weeks of work that the single user never needs | Counter: Keep a network-level guard (bind to localhost only). That's sufficient for 1-user | Bind server to `127.0.0.1:PORT` only |
| **OAuth / SSO / Magic Link auth** | Makes it feel production-grade | No authentication need for local single-user tool. OAuth adds callback routes, token storage, provider config — pure overhead | Counter: N/A | Localhost-only binding is the security model |
| **Kubernetes / multi-cluster support** | k8sgpt / HolmesGPT do this | Substrate mismatch. Docker Compose and k8s have different primitives. Supporting both means supporting neither well. 192.168.0.5 runs no k8s | Counter: Future milestone possible if gons-works migrates to k3s | Explicit milestone boundary. k8s in v2+ milestone only |
| **Mobile UI / native app** | "Check my homelab from phone" | htmx renders in mobile browser for free (responsive by default). Zero extra effort needed — this is a non-issue, not an anti-feature | Counter: CONFIRMED — htmx is responsive. Remove from anti-feature concern | Already handled; no mobile-native app needed |
| **Alert routing (PagerDuty / Slack / Discord)** | "Notify me when something breaks" | Phase 1-2 scope is read-query + approve/apply. Proactive alerting is a different product shape (poller + threshold + delivery) | Counter: A 10-line Discord webhook on `applyPatch` failure is feasible. Flag for v1.x | Phase 2.5: `onFailure` → Discord webhook. Out of Phase 1-2 |
| **Metric time-series storage (Prometheus/InfluxDB)** | Beszel shows graphs, maybe we should too | Phase 1 reads live `docker stats` on demand. Storing time-series adds scrape daemon + TSDB + query layer | Counter: N/A — Beszel + open-webui's system monitor cover this | Beszel already deployed. Out-of-scope confirmed |
| **OpenWebUI pipeline approach (Approach C)** | Re-use existing open-webui (:8088) as UI | Vendor-lock to open-webui plugin API; git audit trail requires workaround; "I built something" feeling is weak | Counter: Valid for rapid iteration but reduces dogfood pipeline value | Approach A (Bun/Hono direct) confirmed. OpenWebUI remains as fallback LLM proxy only |
| **Embedding model indirection (vector DB)** | pgvector or Qdrant for "production RAG" | SQLite + Claude Haiku embeddings is sufficient for 6-10 stacks. pgvector adds Postgres dependency, defeating "SQLite to start" principle | Counter: When stacks exceed ~50 entries, migrate. Not now | SQLite FTS5 + Haiku embeddings. Postgres in Phase 2.5+ if needed |

---

## Feature Dependencies

```
[services.yaml bootstrap (Phase 0)]
    └──required by──> [RAG query loop (Phase 1)]
    └──required by──> [staleness detection (Phase 1)]

[listContainers tool (Phase 1)]
    └──enhances──> [services.yaml RAG answers]

[readLogs tool (Phase 1)]
    └──requires──> [log sanitization (Phase 1)]  // prompt injection gate

[readCompose tool (Phase 1)]
    └──feeds──> [proposePatch (Phase 2)]

[proposePatch (Phase 2)]
    └──required by──> [5-key approval gate (Phase 2)]
    └──required by──> [applyPatch (Phase 2)]

[applyPatch (Phase 2)]
    └──requires──> [state/ git repo init (Phase 2)]
    └──requires──> [rollback path (Phase 2)]

[state/ git commits (Phase 2)]
    └──required by──> [action provenance / audit trail (Phase 2)]

[SSE streaming (Phase 1)]
    └──conflicts──> [one-shot HTTP response] // pick one transport model, not both
```

### Dependency Notes

- **services.yaml required before RAG**: Without the knowledge file, the AI answers generic questions only. Phase 0 exists entirely to produce this file before Phase 1 reads it.
- **log sanitization required before readLogs**: Without sanitization, `SECRET_KEY=xyz` in logs reaches the LLM prompt, enabling extraction via prompt injection. This is not optional.
- **state/ git init required before applyPatch**: The commit is the audit trail. If git init fails silently, the safety guarantee disappears without warning.
- **proposePatch and applyPatch are intentionally separate tools**: One generates the diff (read-only, safe), one applies (side-effecting). The gate lives between them. Merging them removes the safety property.

---

## MVP Definition

### Phase 0: Bootstrap (1-2h)

- [ ] Bun + Hono boilerplate running, SSE endpoint returns hello
- [ ] DOCKER_CONTEXT (`dserver`) validation on startup — fail loudly if missing
- [ ] AI reads `docker ps` + existing compose files → generates `kb/services.yaml` draft
- [ ] Developer reviews and commits the draft

### Phase 1: Read-Only Copilot (8h) — v1 launch

- [ ] `listContainers` tool — NL answer grounded in live `docker ps`
- [ ] `readLogs` tool — time-window NL query + sanitization
- [ ] `readCompose` tool — SSH cat + returns to LLM context
- [ ] `services.yaml` RAG — Claude Haiku embeddings → SQLite, top-k retrieval
- [ ] Staleness detection — startup diff, banner in UI
- [ ] Error envelope `{ problem, cause, fix }` on all tool wrappers
- [ ] htmx UI — single input, SSE streaming response
- [ ] Model env var (`COPILOT_MODEL`, default `claude-sonnet-4-6`)

### Phase 2: Write + Audit Trail (8h) — v1.1

- [ ] `proposePatch` tool — unified diff into `state/`, not applied yet
- [ ] 5-key approval gate (`y` apply / `n` abort / `e` edit / `d` diff / `a` abort all) in htmx UI
- [ ] `applyPatch` tool — git commit `state/` first, then docker exec, rollback if exec fails
- [ ] Commit message format: `[timestamp] user: <prompt excerpt>\nai: <reasoning>\n\nDiff: <patch summary>`
- [ ] Commit message injection protection: strip newlines, limit to 500 chars
- [ ] Rollback path: `state/ revert + docker undo` on applyPatch failure
- [ ] Model for propose/apply: default `claude-opus-4-7` (env override)

### Phase 2.5+ (Post-validation, future)

- [ ] `kb/services.yaml` auto-sync via periodic `docker ps` diff — trigger when UI loads, not daemon
- [ ] Discord webhook on `applyPatch` failure — 10-line addition, high value for solo operators
- [ ] Multi-host support — `dlocal` + `dserver` in one copilot session
- [ ] SQLite → Postgres migration path — only when `state/` exceeds 10k commits or teams > 1

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Phase |
|---------|------------|---------------------|----------|-------|
| services.yaml AI bootstrap | HIGH | LOW | P1 | 0 |
| DOCKER_CONTEXT validation | HIGH | LOW | P1 | 0 |
| listContainers (NL) | HIGH | LOW | P1 | 1 |
| readLogs + sanitization | HIGH | LOW | P1 | 1 |
| readCompose | MEDIUM | LOW | P1 | 1 |
| services.yaml RAG query | HIGH | MEDIUM | P1 | 1 |
| Staleness detection | MEDIUM | LOW | P1 | 1 |
| Error envelope { problem, cause, fix } | HIGH | LOW | P1 | 1 |
| SSE streaming UI | HIGH | LOW | P1 | 1 |
| proposePatch + diff display | HIGH | MEDIUM | P1 | 2 |
| 5-key approval gate | HIGH | MEDIUM | P1 | 2 |
| applyPatch + state/ git commit | HIGH | MEDIUM | P1 | 2 |
| Rollback on partial failure | HIGH | MEDIUM | P1 | 2 |
| Discord webhook on failure | MEDIUM | LOW | P2 | 2.5 |
| kb auto-sync | MEDIUM | LOW | P2 | 2.5 |
| Multi-host (dlocal + dserver) | LOW | MEDIUM | P3 | 2.5+ |
| Pretty metrics dashboard | LOW | HIGH | out | never |
| Multi-user RBAC | LOW | HIGH | out | never |

---

## Competitor Feature Analysis

| Feature | Portainer | Dockge | Dozzle | k8sgpt / HolmesGPT | Komodo | gons-works |
|---------|-----------|--------|--------|---------------------|--------|------------|
| Container list/stop/start | Yes (GUI) | Yes (compose-level) | Read-only | k8s only | Yes (compose) | Yes (NL via tools) |
| Log tail | Yes | Basic | Yes (core feature) | k8s logs | Limited | Yes (NL time-window) |
| Compose file view/edit | Yes (clunky) | Yes (syntax highlight) | No | No | Yes (Git-backed) | Yes (read Phase 1, write Phase 2) |
| AI reasoning / NL query | No | No | No | Yes (k8s, runbooks) | No | Yes (Claude, grounded in services.yaml) |
| Domain-specific knowledge | No | No | No | Pattern runbooks only | No | Yes (services.yaml, RAG) |
| Action git audit trail | No | No | No | No | Desired-state only | Yes (event provenance with AI reasoning) |
| Approve before exec | No (immediate) | No (immediate) | No | Suggests only | No (auto-reconcile) | Yes (5-key gate) |
| Single-binary / lightweight | No (Mongo) | Yes | Yes | No (k8s operator) | No (Go binary + Mongo) | Yes (Bun + SQLite) |
| 1-user no-auth setup | CE = yes | Yes | Yes | Enterprise-grade | Yes | Yes (localhost-only) |

---

## Approval Gate UX: Pattern Analysis

The 5-key `y/n/e/d/a` gate is a custom design. Here is the landscape of related patterns to confirm there is no better-trained muscle memory to reuse:

| Tool | Approval Pattern | User Training |
|------|-----------------|---------------|
| Aider | Auto-commits every change; `/undo` to revert | Users trained on "just do it, undo if wrong" |
| Claude Code plan mode | `Shift+Tab` enters plan mode; approve then run | Users trained on visual plan document, not keystrokes |
| Cursor agent mode | Button click "Accept" / "Reject" in sidebar | Mouse-driven, not keyboard |
| OpenAgentsControl | Explicit `approve` before each execution | Close to gons-works model but web-form not terminal |
| etckeeper / git | `git diff` then `git commit` | Very close — but manual two-step |

**Recommendation confirmed**: `y/n/e/d/a` is custom, not pre-trained. The htmx UI must display the key legend inline with every proposal. Consider showing `[y]es [n]o [e]dit [d]iff [a]bort` as clickable buttons that also accept keyboard shortcuts — covers mouse and keyboard users.

---

## Knowledge Layer Pattern Analysis

Three patterns exist for "AI knows my environment". Ranking by fit for 6-10 docker-compose stacks:

| Pattern | How It Works | Pros | Cons | Fit |
|---------|-------------|------|------|-----|
| **Manual YAML + RAG** (selected) | Author `services.yaml` once (AI-bootstrapped), embed on write, retrieve on query | Simple, no infra overhead, lazy-init | Requires initial authoring, drifts without staleness check | Best — SQLite + Haiku embeddings, 6-10 stacks trivial |
| Markdown docs + CLAUDE.md | Write free-form markdown, AI reads at session start | Familiar, no code | No semantic search, full context every time, context-window burn | herms14 approach — suitable for 2-3 stacks, not 10 |
| Knowledge graph (Graphiti/Neo4j) | Temporal graph of infra entities + relationships | Rich traversal queries, temporal | Neo4j overhead, Docker dependency, overkill for 10 stacks | Overkill — consider at 50+ stacks / Phase 3+ |

---

## Sources

- [Portainer vs Dockge comparison (2026)](https://kx.cloudingenium.com/en/portainer-vs-dockge-docker-ui-comparison/)
- [Top Portainer Alternatives 2026 (BetterStack)](https://betterstack.com/community/comparisons/docker-ui-alternative/)
- [HolmesGPT CNCF Sandbox (January 2026)](https://www.cncf.io/blog/2026/01/07/holmesgpt-agentic-troubleshooting-built-for-the-cloud-native-era/)
- [k8sgpt GitHub](https://github.com/k8sgpt-ai/k8sgpt)
- [HolmesGPT GitHub](https://github.com/HolmesGPT/holmesgpt)
- [Komodo GitOps for Docker Compose (Medium)](https://medium.com/@mohammadfalahat/komodo-gitops-for-docker-stacks-a-complete-production-grade-guide-e88ebf3ad845)
- [herms14/homelab-agent (GitHub)](https://github.com/herms14/homelab-agent)
- [TadMSTR/homelab-agent (GitHub)](https://github.com/TadMSTR/homelab-agent)
- [Dockge GitHub](https://github.com/louislam/dockge)
- [OpenAgentsControl (GitHub)](https://github.com/darrenhinde/OpenAgentsControl)
- [Aider chat modes](https://aider.chat/docs/usage/modes.html)
- [OpenWebUI Pipelines docs](https://docs.openwebui.com/features/extensibility/pipelines/)
- [n8n AI nodes homelab (Virtualization Howto)](https://www.virtualizationhowto.com/2025/07/automate-your-home-lab-with-n8n-workflow-automation-and-ai/)
- [homelab-gitops GitOps workflow](https://dev.to/veerendra2/how-i-manage-my-homeservers-with-gitops-and-docker-compose-3fcp)
- [Graphiti knowledge graph (GitHub)](https://github.com/getzep/graphiti)

---

*Feature research for: Single-host Docker Compose AI operator copilot*
*Researched: 2026-05-06*
