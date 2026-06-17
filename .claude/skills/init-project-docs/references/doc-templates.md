# Doc templates & mermaid examples

Section skeletons for each file in the suite. Follow the structure so the docs are
consistent across projects; fill from what you read in the code (the grounding rule
in SKILL.md). Delete a section that genuinely doesn't apply rather than padding it.
Keep prose tight — tables and diagrams beat paragraphs.

## Contents
- [OVERVIEW.md](#overviewmd)
- [ARCHITECTURE.md](#architecturemd)
- [TECHSTACK.md](#techstackmd)
- [DATAMODEL.md](#datamodelmd)
- [COREFEATURE.md](#corefeaturemd)
- [API.md](#apimd)
- [DESIGN.md](#designmd)

---

## OVERVIEW.md

The elevator pitch + orientation. A reader should know *what this is* and *how to run it* in two minutes.

```markdown
# <Project> — Overview

## What it is
<1–3 sentences: the problem it solves and for whom.>

## Status & purpose
- **Type**: <web app / API service / CLI / library / mobile / monorepo>
- **Primary users**: <who uses it>
- **Core value**: <the one thing it does well>

## Key capabilities
- <capability 1>
- <capability 2>

## Repository layout
| Path | Purpose |
|------|---------|
| `src/...` | <what lives here> |
| `migrations/` | <...> |

## Running it locally
```bash
<the real install + run commands from README / package scripts / Makefile>
```

## Where to go next
- Architecture → [ARCHITECTURE.md](./ARCHITECTURE.md)
- Data model → [DATAMODEL.md](./DATAMODEL.md)
- API → [API.md](./API.md)
```

---

## ARCHITECTURE.md

How the pieces relate at runtime. Lead with the diagram, then explain the boxes.

```markdown
# Architecture

## System diagram
\`\`\`mermaid
flowchart TD
  Client["Web client"] -->|HTTPS| API["API server (Express)"]
  API --> Svc["Order service"]
  Svc --> DB[("PostgreSQL")]
  Svc --> Queue[["Job queue (BullMQ)"]]
  Queue --> Worker["Email worker"]
  Worker --> Mail["SendGrid"]
\`\`\`

## Components
| Component | Responsibility | Location |
|-----------|----------------|----------|
| API server | HTTP entry, routing, auth | `src/api/` |
| Order service | Domain logic | `src/services/order/` |
| ... | ... | ... |

## Layering & boundaries
<How layers/modules depend on each other; the dependency direction.>

## Runtime data flow
<The path of a typical request through the components above.>

## External integrations
| System | Used for | Failure handling |
|--------|----------|------------------|
| SendGrid | transactional email | retried via queue |

## Cross-cutting concerns
<Auth, logging, error handling, config — only what you found in the code.>
```

Use `flowchart TD` (top-down) or `graph LR` (left-right). `[(text)]` = datastore, `[[text]]` = queue/subroutine, `{text}` = decision.

---

## TECHSTACK.md

Sourced from manifests + lockfiles. Give real versions and the *why* where the code/README reveals it.

```markdown
# Tech Stack

## Languages & runtime
- <language> <version> (from `<manifest>`)

## Frameworks & key libraries
| Library | Version | Role |
|---------|---------|------|
| express | ^4.19 | HTTP framework |
| prisma | ^5.x | ORM / migrations |

## Data stores
- <PostgreSQL 15 — primary store> · <Redis — cache/queue>

## Build, test & tooling
- **Build**: <bundler / compiler> · **Test**: <runner> · **Lint/format**: <tools>

## Infrastructure & deployment
- <Docker / k8s / serverless / CI provider> (from `Dockerfile` / CI workflows)

## Notable choices
<Anything non-obvious the code reveals about why a tool is used here.>
```

---

## DATAMODEL.md

Sourced from migrations / ORM models / schema files. Real fields, types, keys.

```markdown
# Data Model

## Entity-relationship diagram
\`\`\`mermaid
erDiagram
  USER ||--o{ ORDER : places
  ORDER ||--|{ ORDER_ITEM : contains
  PRODUCT ||--o{ ORDER_ITEM : "ordered in"
  USER {
    uuid id PK
    string email "unique, not null"
    string password_hash
    timestamptz created_at
  }
  ORDER {
    uuid id PK
    uuid user_id FK
    string status "enum: pending|paid|shipped"
    numeric total
  }
  ORDER_ITEM {
    uuid id PK
    uuid order_id FK
    uuid product_id FK
    int quantity
  }
\`\`\`

## Entities
### User (`users` table — `migrations/001_users.sql`)
| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | uuid | PK | |
| email | text | unique, not null | login identity |

## Relationships & integrity
<FKs, cascade rules, unique constraints — as actually defined.>

## Notable invariants
<Status enums, soft-delete columns, anything enforced in schema or code.>
```

Cardinality in `erDiagram`: `||--o{` = one-to-many (zero+), `||--|{` = one-to-many (one+), `}o--o{` = many-to-many. Quote any attribute comment with spaces.

---

## COREFEATURE.md

The centrepiece. Pick the 3–6 flows that define the product. **One sequence diagram per flow**, drawn by tracing the real call chain.

```markdown
# Core Features

## 1. User sign-in
**Entry**: `POST /auth/login` (`src/api/auth.ts`) · **What it does**: <one line>

\`\`\`mermaid
sequenceDiagram
  actor U as User
  participant API as API server
  participant Svc as AuthService
  participant DB as PostgreSQL
  U->>API: POST /auth/login {email, password}
  API->>Svc: login(email, password)
  Svc->>DB: SELECT user WHERE email
  DB-->>Svc: user row
  Svc->>Svc: verify password hash
  Svc-->>API: JWT
  API-->>U: 200 {token}
  Note over Svc,DB: on bad credentials → 401, no token
\`\`\`

**Key files**: `src/api/auth.ts`, `src/services/auth.ts`
**Edge cases**: <what happens on failure / boundary, from the code>

## 2. <Next core flow>
...
```

Sequence diagram rules: declare `participant`/`actor` before use; `->>` solid call, `-->>` dashed return; quote labels with punctuation; use `Note over A,B: ...` for error/boundary behaviour; `alt`/`else`/`opt` for branching when it matters.

---

## API.md

The published surface a client codes against. Sourced from routes/controllers/OpenAPI. Group by resource.

```markdown
# API

## Conventions
- **Base URL**: `<https://.../api/v1>`
- **Auth**: <Bearer JWT in `Authorization` header / API key / session> — from the code
- **Content type**: `application/json`
- **Error shape**: `{ "error": { "code": "...", "message": "..." } }` (the real one)

## Endpoints

### Auth
#### `POST /auth/login`
Authenticate and receive a token.
- **Auth**: none
- **Request**: `{ "email": string, "password": string }`
- **Responses**: `200 { token }` · `401 invalid credentials` · `422 validation`
- **Source**: `src/api/auth.ts`

### Orders
#### `GET /orders`
List the caller's orders.
- **Auth**: Bearer · **Query**: `?status=&page=&limit=`
- **Responses**: `200 { data: Order[], page, total }` · `401`
- **Source**: `src/api/orders.ts`
```

If an OpenAPI/GraphQL schema exists, summarise it here and link to the spec rather than transcribing every field. State the real status codes and error envelope, not idealised ones.

---

## DESIGN.md

The UX/UI surface a user interacts with — produced **only for a project with a frontend** (web/mobile/desktop GUI). Sourced from the theme/token files, the component directory, and the router/page definitions. Document the design language the UI *uses*, never a framework's defaults.

```markdown
# Design (UX/UI)

## Design language
<1–2 sentences: the overall direction the UI actually shows — dense data dashboard, minimal marketing site, mobile-first app — as evidenced by the code, not aspiration.>

## Design tokens
Sourced from `<tailwind.config.* / theme.ts / :root CSS custom properties>`.
- **Colour**: <primary / surface / semantic — the real token names & values>
- **Typography**: <font families + the type scale>
- **Spacing, radius, shadow**: <the scale and the named steps>
- **Theming**: <light/dark or brand themes, and how they're toggled — from the code>

## Component inventory
The reusable building blocks, not every one-off. From the component directory.
| Component | Variants / role | Location |
|-----------|-----------------|----------|
| Button | primary · ghost · destructive | `src/components/ui/Button.tsx` |
| Modal | dialog + confirm | `src/components/ui/Modal.tsx` |

## Screen & navigation map
\`\`\`mermaid
flowchart LR
  Login["/login"] --> Dashboard["/dashboard"]
  Dashboard --> Orders["/orders"]
  Orders --> OrderDetail["/orders/:id"]
  Dashboard --> Settings["/settings"]
\`\`\`

## Key screens & states
### Dashboard (`src/pages/Dashboard.tsx`)
- **Purpose**: <one line>
- **States**: loading → <skeleton> · empty → <empty-state copy> · error → <error UI> · loaded → <content>

## Interaction & feedback patterns
<Forms & validation, toasts/notifications, modals/confirms, optimistic updates, loading affordances — as actually implemented, by file.>

## Accessibility
<What the code does — semantic elements, `aria-*`, focus management, keyboard nav, colour contrast. Name honest gaps: "custom dropdown has no keyboard support in the reviewed files".>

## Responsive behaviour
<Breakpoints from the config; how the layout adapts; the mobile-navigation pattern.>
```

For the screen map use `flowchart LR`/`TD` — one node per route/screen, arrows = navigation; label nodes with the real path. For a single screen's lifecycle, a `stateDiagram-v2` (`idle --> loading --> loaded` / `--> error`) is often clearer than prose. Keep tokens and components grounded in the files that define them — cite the path so a reader can verify, and mark anything you couldn't find rather than inventing it.
