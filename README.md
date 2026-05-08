# Saukele Back

Saukele is a wedding registry backend built with Express.js, Prisma, and PostgreSQL.

## Overview

This repository implements a production-grade backend for the Saukele wedding registry platform.
The system allows users to create wedding registries, add gift items, and collect contributions from guests using a pool-funding model.

### Key Features:
- **Authentication & Authorization**: JWT access/refresh tokens, email verification, password reset, RBAC (GUEST, REGISTRANT, ADMIN).
- **Registry Management**: Create, update, delete registries with unique share codes.
- **Gift Items**: Manage items with target amounts, priority, and status state machine (PENDING → FUNDED → PURCHASED → DELIVERED).
- **Contributions**: Pool-funding logic with atomic transactions, exchange rate locking, and kinship tier suggestions.
- **Family Tree**: Manage family members with relationship types and kinship tiers.
- **Background Jobs**: Asynchronous email sending (BullMQ + Redis) and scheduled cleanup tasks.
- **Audit Logs**: Track key actions in the system.
- **API Documentation**: Swagger UI available at `/api/docs`.

## Architecture decisions

- **Framework**: Express.js for fast, minimal backend routing and middleware.
- **ORM**: Prisma with PostgreSQL for schema-first migrations and type-safe DB access.
- **Authentication**:
  - JWT access tokens (short-lived) and refresh tokens (long-lived, stored in DB).
  - Email verification on signup (via Nodemailer + BullMQ queue).
  - Password reset via email link.
  - Token versioning for secure logout (invalidates all refresh tokens).
- **Validation**: `Zod` for request body validation and standardized error responses.
- **Security**:
  - `helmet` for secure headers.
  - CORS configured with allowlist origins.
  - Rate limiting on auth endpoints (`express-rate-limit`).
- **Background Processing**: BullMQ with Redis for email queue and cleanup tasks.
- **Testing**: Jest + Supertest for integration tests.

## Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Redis (optional, for background jobs)
- Docker / Docker Compose (optional)

## Local setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Edit `.env` with your database credentials, JWT secret, and SMTP settings.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start infrastructure (PostgreSQL and Redis) using Docker:
   ```bash
   docker-compose up -d
   ```
5. Run Prisma migrations and seed the database (if applicable):
   ```bash
   npx prisma migrate dev
   npm run seed
   ```
6. Start the server (and background workers):
   ```bash
   npm run dev
   ```

## Postman Collection / Pre-Defense Preparation

A complete Postman collection is included in the root directory: `postman_collection.json`. 
Load this collection into your Postman workspace before the Oral Defense. It contains prepared requests for:
- All Authentication flows (Register, Login, Email Verify, Password Reset, Refresh, Logout)
- Business Logic endpoints (Registries, Gift Items, Contributions)
- Admin endpoints
- Background Trigger endpoints

Make sure to set your environment variables in Postman (e.g., `{{baseUrl}} = http://localhost:4000` and authentication tokens).

## Testing

Run the test suite:
```bash
npm test
```
Tests are written using Jest and Supertest. They cover authentication flows and business logic transactions.

## API Documentation

Swagger UI is available at:
```
http://localhost:4000/api/docs
```
The OpenAPI specification is located in `blueprint/openapi.yaml`.

## Environment Variables

See `.env.example` for a full list of required environment variables. Key variables include:
- `DATABASE_URL`: PostgreSQL connection string.
- `JWT_ACCESS_SECRET`: Secret key for signing JWT tokens.
- `SMTP_*`: Settings for the email service (Nodemailer).
- `REDIS_URL`: Connection string for Redis (used by BullMQ).

## Project Structure

```
src/
  app.js           # Express app setup
  config/config.js # Environment configuration
  lib/             # Utilities (Prisma client, Email service)
  middleware/       # Auth, Rate limiting
  routes/           # API route handlers
  workers/          # Background job workers (BullMQ)
tests/             # Jest integration tests
prisma/            # Schema and migrations
blueprint/         # OpenAPI spec and project docs
```
4. Run migrations:
   ```bash
   npm run migrate
   ```
5. Seed the database:
   ```bash
   npm run seed
   ```
6. Start the application:
   ```bash
   npm run dev
   ```
7. Open Swagger UI in the browser:
   ```text
   http://localhost:4000/api/docs
   ```

## Docker setup

Start app and database together:
```bash
docker compose up --build
```

The app will be available at `http://localhost:4000`.

## Postman / Defense flow

A ready-to-import Postman collection is available in `postman_collection.json`.
Use the following endpoints in Postman with base URL `http://localhost:4000/api`.
Set `Authorization: Bearer <accessToken>` for protected routes.

### Auth endpoints
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Business endpoints
- `POST /api/registries` — create registry (REGISTRANT / ADMIN)
- `GET /api/registries` — get own registries
- `GET /api/registries/share/{shareCode}` — public registry by share code
- `POST /api/registries/{registryId}/items` — add gift item
- `GET /api/registries/{id}/items` — list registry items
- `POST /api/items/{itemId}/contributions` — create a contribution
- `POST /api/family-members` — add family member
- `GET /api/family-members` — list own family members
- `GET /api/family-members/kinship-tier/{userId}` — find kinship tier

### Defense flow
1. Register a new user with `POST /api/auth/register`
2. Login with `POST /api/auth/login`
3. Use returned `accessToken` to call `GET /api/auth/me`
4. Refresh access token with `POST /api/auth/refresh`
5. Logout with `POST /api/auth/logout`
6. Create a registry and a gift item
7. Execute `POST /api/items/{itemId}/contributions`
8. Show Swagger UI at `/api/docs`
9. Run tests live:
   ```bash
   npm test
   ```

## Example Postman requests

### Register
```json
POST /api/auth/register
{
  "email": "tester@example.com",
  "name": "Tester",
  "password": "Test12345"
}
```

### Login
```json
POST /api/auth/login
{
  "email": "tester@example.com",
  "password": "Test12345"
}
```

### Create registry
```json
POST /api/registries
Headers: Authorization: Bearer <accessToken>
{
  "title": "Asel & Nurlan Wedding",
  "coupleName": "Asel & Nurlan",
  "weddingDate": "2026-12-31",
  "isPublic": true
}
```

### Add gift item
```json
POST /api/registries/{registryId}/items
Headers: Authorization: Bearer <accessToken>
{
  "title": "Kitchen set",
  "description": "Gift for the couple",
  "targetAmountKzt": "50000.00",
  "priority": "HIGH"
}
```

### Contribution
```json
POST /api/items/{itemId}/contributions
{
  "contributorName": "Guest Tester",
  "amountKzt": 15000,
  "message": "Поздравляю!"
}
```

## Tests
Run unit and integration tests:
```bash
npm test
```

## Notes
- The app loads validated environment variables from `.env`.
- Refresh tokens are stored and can be revoked on logout.
- Core contribution logic uses Prisma transactions to prevent overfunding.
- Swagger is generated from `blueprint/openapi.yaml`.
