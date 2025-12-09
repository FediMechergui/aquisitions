# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Key commands

All commands are intended to be run from the repository root.

### Install dependencies

```bash path=null start=null
npm install
```

### Run the API in development

Uses `nodemon` to reload on file changes, bootstrapping via `src/index.js`.

```bash path=null start=null
npm run dev
```

The server listens on `process.env.PORT` or falls back to `3000`, and logs `Server is running on port http://localhost:<PORT>` when ready.

### Linting

ESLint is configured via `eslint.config.js` and applies to the whole project.

```bash path=null start=null
npm run lint        # check
npm run lint:fix    # check and auto-fix
```

### Formatting

Prettier is configured as a dev dependency and used across the project.

```bash path=null start=null
npm run format        # write changes
npm run format:check  # check only
```

### Database schema and migrations (Drizzle + Neon)

Drizzle CLI is configured in `drizzle.config.js` and uses `process.env.DATABASE_URL`. Ensure this variable is set before running any DB commands.

```bash path=null start=null
npm run db:generate   # generate SQL migrations from Drizzle schema in src/models
npm run db:migrate    # apply migrations to the DATABASE_URL database
npm run db:studio     # open Drizzle Studio for inspecting the schema/data
```

Note: there is currently no `test` script in `package.json` and no test runner configured. To add tests, first introduce a test framework (e.g. Jest or Vitest) and a corresponding `npm test` script, then follow that framework’s conventions for running a single test file or test case.

## Architecture overview

This is a small Node.js/Express API using ESM modules, Drizzle ORM, and Neon for PostgreSQL. Paths below are relative to the repo root.

### Entry point and server lifecycle

- `src/index.js`
  - Loads environment variables via `dotenv/config`.
  - Imports `./server.js` to start the HTTP server as a side effect.
- `src/server.js`
  - Imports the Express app from `./app.js`.
  - Determines `PORT` from `process.env.PORT` or defaults to `3000`.
  - Calls `app.listen(PORT, ...)` and logs a startup message.

This separation allows `app.js` to be imported independently (e.g., for tests or alternative server wrappers) without immediately starting a listener.

### Express application and middleware

- `src/app.js`
  - Creates the main Express application instance.
  - Global middleware stack:
    - `helmet()` for basic security headers.
    - `cors()` with default settings.
    - `express.json()` and `express.urlencoded({ extended: true })` for body parsing.
    - `cookie-parser` to support reading cookies (used by `src/utils/cookies.js`).
    - `morgan('combined', ...)` configured to write logs through the custom Winston logger.
  - Health and root endpoints:
    - `GET /` returns a plain-text greeting and logs via the shared logger.
    - `GET /health` returns JSON with `status`, `timestamp`, and `uptime`.
    - `GET /api` returns a simple JSON "API is running" payload with a version string.
  - Mounts feature routes:
    - `app.use('/api/auth', authRoutes)` where `authRoutes` comes from `src/routes/auth.routes.js` via the imports alias `#routes/auth.routes.js`.

### Module path aliases

`package.json` defines Node `imports` aliases to keep imports organized by layer:

- `#config/*` → `./src/config/*`
- `#controllers/*` → `./src/controllers/*`
- `#middleware/*` → `./src/middleware/*`
- `#models/*` → `./src/models/*`
- `#routes/*` → `./src/routes/*`
- `#utils/*` → `./src/utils/*`
- `#services/*` → `./src/services/*`
- `#validations/*` → `./src/validations/*`

When adding new modules, prefer placing them into one of these directories and importing via the corresponding `#...` alias to stay consistent with the existing structure.

### Configuration layer

Located in `src/config`:

- `database.js`
  - Uses `@neondatabase/serverless` to create a `sql` client bound to `process.env.DATABASE_URL`.
  - Wraps the Neon client with `drizzle-orm/neon-http` to expose a `db` instance used by services.
  - Exports both `db` (ORM interface) and `sql` (raw SQL interface) for use elsewhere.
- `logger.js`
  - Creates a Winston logger instance with:
    - Log level from `process.env.LOG_LEVEL` or `'info'`.
    - Timestamped, JSON-formatted logs (with error stacks).
    - File transports: `error.log` (level `error`) and `combined.log` (all logs).
  - In non-production environments (`NODE_ENV !== 'production'`), adds a colorized `Console` transport for local debugging.
  - Exported as the default `logger` used across the app (e.g., in controllers, services, and the morgan HTTP logger).

### Data model and database tooling

- `src/models/user.module.js`
  - Defines the `users` table via `drizzle-orm/pg-core`:
    - `id` serial primary key.
    - `name`, `email`, `password`, `role` fields with length constraints and a default `role` of `'user'`.
    - `created_at` and `updated_at` timestamps defaulting to `now()`.
  - This schema is the source of truth for Drizzle migrations and type-safe queries.

- `drizzle.config.js`
  - Points Drizzle CLI at `./src/models/*.js` as schema input and `./drizzle` as the migrations output directory.
  - Uses `process.env.DATABASE_URL` for `dbCredentials.url`.

- `drizzle/`
  - Contains generated SQL migration files and metadata (e.g., `_journal.json`, snapshots). These are produced by `npm run db:generate` and consumed by `npm run db:migrate`.

### Auth flow: routes, controller, service, validation, utilities

The auth feature is split across several layers, wired together via the path aliases.

- `src/routes/auth.routes.js`
  - Creates an Express router mounted under `/api/auth`.
  - Currently defines endpoints:
    - `POST /sign-up` → `signup` controller.
    - `POST /sign-in` and `POST /sign-out` are placeholders returning static responses.

- `src/controllers/auth.controller.js`
  - `signup` controller orchestrates request handling:
    - Validates `req.body` against `signupSchema` from `src/validations/auth.validation.js` using `safeParse`.
    - On validation failure, responds with HTTP 400 and a formatted error string via `formatValidationErrors` from `src/utils/format.js`.
    - On success, extracts `{ name, email, password, role }` and calls `createUser` from `src/services/auth.service.js`.
    - Signs a JWT via `jwttoken.sign(...)` from `src/utils/jwt.js` using user `id`, `email`, and `role`.
    - Persists the JWT in a cookie using `cookies.set(res, 'token', token, ...)` from `src/utils/cookies.js`.
    - Logs the signup event and returns a 201 response containing a minimal user object (no password fields).
    - If the service throws an "email already exists" error, maps it to HTTP 409; otherwise, forwards the error to Express error handling via `next(e)`.

- `src/services/auth.service.js`
  - `hashPassword(password)`
    - Uses bcrypt to hash passwords with a salt factor of 10.
    - Logs and throws a generic error message on failure.
  - `createUser({ name, email, password, role = 'user' })`
    - Checks for uniqueness by querying the `users` table with `drizzle-orm` and `eq(users.email, email)`.
    - If a user already exists, throws a specific error consumed by the controller.
    - Hashes the provided password, inserts a new user row via `db.insert(users).values(...)`, and returns a projection containing `id`, `name`, `email`, `role`, and `created_at`.
    - Logs the creation event.

- `src/validations/auth.validation.js`
  - `signupSchema`
    - `name`: string, trimmed, max length 255.
    - `email`: string, validated as an email, lowercased, trimmed, max length 255.
    - `password`: string, 6–128 characters.
    - `role`: enum `'user' | 'admin'` with default `'user'`.
  - `signinSchema`
    - `email` and `password` with basic presence and format constraints (not yet wired to a route/controller).

- `src/utils/format.js`
  - `formatValidationErrors(errors)`
    - Accepts a Zod error object and returns a concise string:
      - If `errors.issues` is an array, joins issue messages with `, `.
      - Otherwise falls back to `JSON.stringify(errors)`.

- `src/utils/jwt.js`
  - Wraps `jsonwebtoken` with a small helper object `jwttoken`:
    - `sign(payload)` uses `JWT_SECRET` from `process.env.JWT_SECRET` (or a default string) with a 1-day expiry.
    - `verify(token)` validates and decodes tokens.
  - Both methods log via `logger` and throw meaningful errors when signing or verification fails.

- `src/utils/cookies.js`
  - Provides a thin abstraction over Express’s cookie API:
    - `getOptions()` returns shared cookie options (HTTP-only, `sameSite: 'strict'`, 15-minute lifetime, and `secure` in production).
    - `set(res, name, value, options)` sets a cookie merging defaults with any overrides.
    - `clear(res, name, options)` clears a cookie with consistent options.
    - `get(req, name)` retrieves a cookie value from `req.cookies`.

### Linting configuration

- `eslint.config.js`
  - Extends `@eslint/js` recommended config.
  - Targets modern ESM (`ecmaVersion: 2022`, `sourceType: 'module'`).
  - Declares common Node globals (`process`, `Buffer`, `__dirname`, timers, etc.).
  - Enforces basic style rules: 2-space indentation, Unix linebreaks, single quotes, required semicolons, `prefer-const`, `no-var`, object shorthand, and arrow callbacks.
  - For `tests/**/*.js`, configures Jest-style globals (though tests are not yet present).
  - Ignores `node_modules`, `coverage`, `logs`, and `drizzle` directories.

## Environment and configuration expectations

This project assumes certain environment variables and runtime configuration:

- `DATABASE_URL` — required for both the runtime database connection (`src/config/database.js`) and Drizzle CLI (`drizzle.config.js`).
- `PORT` — optional, used in `src/server.js`; defaults to `3000` if unset.
- `JWT_SECRET` — optional but strongly recommended; used in `src/utils/jwt.js` to sign and verify tokens. A hardcoded default is present but should be overridden in real deployments.
- `NODE_ENV` — controls logger behavior (`production` disables console logging) and cookie security flags in `src/utils/cookies.js`.
- `LOG_LEVEL` — optional; controls the minimum level logged by Winston.

`dotenv/config` is imported at startup (in `src/index.js` and `drizzle.config.js`), so placing these values into an `.env` file in the project root is sufficient for both application runtime and Drizzle CLI usage.
