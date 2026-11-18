# AGENTS.md — Herald Stories

Rules for every AI coding agent (Claude Code, Cursor, Copilot, Codex…) and every human working in this repo.
Read this file and `ARCHITECTURE.md` **before writing any code**. If anything here conflicts with a prompt, this file wins.

---

## 1. What we are building

Herald Stories is a college-only, Reddit-style platform. Students sign up with a college email, write or import Markdown blogs and stories, browse a feed, search inside full post content, comment and like.

| Layer | Stack |
|---|---|
| Frontend | React + Vite + TypeScript (strict), TanStack Query, react-markdown |
| Backend | 3 Django 5 microservices on Python 3.12 + DRF + drf-spectacular — **auth**, **post**, **browse** |
| Data | Postgres (one DB per service, pgvector in browse), Redis, MinIO |
| Async | Celery workers inside the post and browse services (Redis broker) |
| Gateway | Traefik, one origin for everything |
| Auth | RS256 JWT (access token in memory, refresh token in httpOnly cookie) |
| Dev / CI | Docker Compose, Make, GitHub Actions, ruff, ESLint, Prettier, pytest |

Full design: `ARCHITECTURE.md`. Task board: Trello "Herald Stories — Phase 1".

---

## 2. Before you write code

1. Find the Trello card you are working on. Read its description and checklist.
2. Read the contract for your area in `contracts/` (`auth.yaml`, `post.yaml`, `browse.yaml`, `events.md`).
3. Read the existing code in the folder you are changing. Follow its patterns.
4. Only change files inside the scope of your card. If you need a change elsewhere, stop and say so.

---

## 3. Hard rules — never do these

- **Never invent an endpoint, field, error code or event name.** If it is not in `contracts/`, it does not exist. Propose a contract change in its own PR first.
- **Never read or write another service's database.** Services talk only through HTTP APIs (via the gateway) or Celery events.
- **Never import code from another service.** Shared helpers (JWT verify, permissions) are *copied* into each service.
- **Never render raw HTML from Markdown.** No `dangerouslySetInnerHTML`, no `rehype-raw`, no `html=True` in markdown-it.
- **Never commit secrets.** No keys, passwords, tokens or `.env` files. Only `.env.example`.
- **Never store tokens in `localStorage` or `sessionStorage`.** Access token lives in memory; refresh token is an httpOnly cookie.
- **Never log OTP codes, passwords, tokens or full request bodies of auth endpoints.**
- **Never trust user IDs from the request body.** The user is whoever the JWT says (`sub`).
- **Never write migrations for a Django app you don't own on your card.**
- **Never push to `main`.** Branch → PR → review → squash merge.
- **Never add a dependency without naming it and the reason in the PR description.**
- **Never disable a test, lint rule or CI check to make a build pass.**

---

## 4. Repo layout

```
herald-stories/
  frontend/              React + Vite + TS
  services/
    auth/                Django: config/, apps/, tests/
    post/                Django: apps posts/ + interactions/, Celery worker
    browse/              Django: Celery worker, pgvector
  contracts/             auth.yaml, post.yaml, browse.yaml, events.md  ← source of truth
  infra/                 docker-compose.yml, traefik/, postgres/init.sql, seed/
  docs/decisions/        one short file per architecture decision (ADR)
  .github/workflows/     CI
  AGENTS.md  ARCHITECTURE.md  README.md  Makefile  .env.example  .gitignore
```

Django service layout (same in all three):

```
services/<name>/
  config/        settings.py, urls.py, celery.py, wsgi.py
  apps/<app>/    models.py, serializers.py, views.py, urls.py, services.py, tasks.py, admin.py
  common/        errors.py, jwt_auth.py, permissions.py, pagination.py
  tests/
  Dockerfile  pyproject.toml
```

Business logic goes in `services.py`, not in views or serializers. Views stay thin.

---

## 5. Commands

| Command | What it does |
|---|---|
| `make up` | Start the whole stack (Traefik, frontend, 3 services, 2 workers, Postgres, Redis, MinIO, Mailpit) |
| `make down` | Stop everything |
| `make logs` | Follow logs |
| `make migrate` | Run migrations for all services |
| `make seed` | Create test users and sample posts |
| `make test` | Run all tests |
| `make lint` | ruff + ESLint + Prettier check |
| `make api-types` | Regenerate frontend TypeScript types from `contracts/` |
| `make keys` | Generate dev RS256 key pair for JWT |
| `make shell-auth` / `shell-post` / `shell-browse` | Django shell in a service |

Run `make lint && make test` before every push.

---

## 6. Conventions

### API

- JSON only. **snake_case** field names. IDs are **UUID v4** strings. Timestamps are **ISO 8601 UTC** (`2026-11-20T12:15:00Z`).
- URL prefixes: `/api/auth/…`, `/api/posts/…`, `/api/browse/…`
- Every service exposes `GET /health` → `{"status": "ok"}` and its OpenAPI schema at `/api/<service>/schema/`.
- Lists: cursor pagination (`?cursor=`, response has `next_cursor`) for feed and comments; page numbers (`?page=`) for search. Default 20 items.
- **One error shape everywhere:**

```json
{ "error": { "code": "otp_expired", "message": "The code has expired.", "details": {} } }
```

- `code` — snake_case, machine-readable, must be listed in the contract. Clients branch on this, never on `message`.
- `message` — short, human-readable, safe to show to the user. No internal details.
- `details` — always present (use `{}` when empty). For validation errors, map field name → list of messages: `{"email": ["Enter a valid email."]}`.
- Build errors only through `common/errors.py` (DRF exception handler); never hand-roll the shape in a view.

Use the status codes 400, 401, 403, 404, 409, 413, 429 as appropriate. Never return a stack trace.

### Auth in services

- Every view requires a valid JWT unless the contract marks it public.
- Use `common/jwt_auth.py` (verifies RS256 locally with the cached public key from `/api/auth/.well-known/jwks.json`).
- Check **permissions, not roles**: `permission_classes = [HasPerm("post.delete_any")]`.
- Permission codes: `content.read`, `content.write`, `content.edit_own`, `post.delete_any`, `user.suspend`, `admin.manage`.

### Events (post → browse)

- Sent as Celery tasks **by name** to the `browse` queue with `send_task(...)`, inside `transaction.on_commit`.
- Names and payloads exactly as in `contracts/events.md`: `post.published`, `post.deleted`, `post.stats_changed`.
- Consumers must be **idempotent**. Ignore a `post.published` whose `version` is older than the stored one.
- Retries: 3, exponential backoff.

### Python

- Python 3.12, Django 5, DRF, drf-spectacular. Format + lint with **ruff**.
- Type hints on all functions in `services.py` and `tasks.py`.
- Settings only from environment variables (django-environ). No hard-coded hosts or credentials.
- Models: UUID primary key, `created_at`, `updated_at`. Use `select_related`/`prefetch_related` to avoid N+1 queries.
- Counters (`like_count`, `comment_count`) update with `F()` expressions in the same transaction.

### Frontend

- TypeScript `strict`. ESLint + Prettier. Functional components and hooks only.
- API types come from `frontend/src/api/types` (generated — never edit by hand).
- All server calls go through `src/api/client.ts` and TanStack Query hooks. No `fetch` inside components.
- Render Markdown **only** with the shared `<Markdown>` component (react-markdown + remark-gfm + rehype-sanitize).
- Use shared components from `src/components/ui` before creating new ones.
- Keep filters and pagination state in the URL query string.
- Every screen handles three states: loading, empty, error.

### Naming

| Thing | Style | Example |
|---|---|---|
| Branch | `feat/`, `fix/`, `chore/`, `test/`, `docs/`, `contract/` + area | `feat/auth-otp` |
| Commit | Conventional Commits | `feat: add OTP verification` |
| PR title | `[NN] Short title` (NN = Trello card number) | `[18] Signup + OTP email` |
| Python | snake_case functions, PascalCase classes | `create_draft_post()` |
| React component | PascalCase file and name | `PostCard.tsx` |
| Hook | `use` + PascalCase | `useFeed.ts` |
| Error code | snake_case | `domain_not_allowed` |
| JSON field / query param | snake_case (never camelCase) | `author_id`, `next_cursor` |
| ID | UUID v4 string, field named `id` or `<thing>_id` | `"post_id": "3f2b…-…"` |
| Timestamp field | `<verb>_at`, ISO 8601 UTC | `published_at` |
| Celery event | `<entity>.<past_tense_verb>` | `post.published` |
| DB table | Django default `<app>_<model>` | `posts_post` |

---

## 7. Security checklist (apply on every change)

- Markdown: server renders with markdown-it-py `html=False`, cleans with **nh3**; client renders with rehype-sanitize. Allowed link schemes: `http`, `https`, `mailto`.
- Passwords: Argon2. OTPs: 6 digits from `secrets`, stored hashed, expire in 10 min, max 5 attempts, resend cooldown 60 s.
- Refresh token cookie: `httpOnly`, `Secure`, `SameSite=Lax`, path `/api/auth`, rotated on use, blacklisted on logout.
- Upload limits: `.md` files max 1 MB, UTF-8 only. Gateway rejects bodies over 2 MB on `/api/posts`.
- Same response for "email exists" and "email doesn't exist" on signup and password reset.
- MinIO buckets are private. Only the post service has MinIO credentials.

---

## 8. Testing rules

Every endpoint ships with at least:

1. A **success** test
2. A **failure** test (bad input or missing resource)
3. A **permission** test (no token → 401, wrong role → 403)

Also:

- Workers: test idempotency (same event twice → same result).
- Markdown: test that `<script>`, `javascript:` links and `<img onerror>` are removed.
- Use pytest + pytest-django with real Postgres/Redis/MinIO (the CI service containers), not mocks of the database.
- Frontend: test utilities (comment tree builder, error parsing) and the `<Markdown>` component.

---

## 9. Workflow

1. Pick a card on Trello. Add yourself, move it to **In Progress** (max 2 per person).
2. `git checkout main && git pull && git checkout -b <branch from card>`
3. Work through the card's checklist. Keep the PR small (aim for under 400 changed lines).
4. `make lint && make test`
5. Push, open a PR titled `[NN] …` with the card link. Move the card to **Review**.
6. One teammate reviews. CI must be green. You must be able to explain every line.
7. Squash merge, delete the branch, move the card to **Done**.

---

## 10. Definition of done

- [ ] Matches the contract in `contracts/`
- [ ] Tests: success, failure, permission
- [ ] `make lint` and `make test` pass; CI green
- [ ] No secrets, no new unexplained dependencies
- [ ] Works on a fresh clone with `make up`
- [ ] Reviewed by one teammate and merged to `main`

---

## 11. When you're unsure

- Missing endpoint or field → stop, propose a contract change PR.
- Need to touch another service → stop, comment on the Trello card.
- Unsure which approach → check `ARCHITECTURE.md` and `docs/decisions/`. If it's not covered, ask in the team chat before writing code.
- Prefer the simplest solution that meets the card's "Done when". Don't add features that aren't on the card.
