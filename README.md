# JobWingman — Backend Express.js API

This repository houses the primary application backend for JobWingman, built using Node.js, Express, TypeScript, and Prisma ORM. It serves as the orchestration layer between the frontend Remix client and the Python ML microservice.

---

## 🛠️ Tech Stack & Services
* **Runtime**: Node.js (v18+)
* **Framework**: Express.js with TypeScript (`ts-node`/`nodemon` for development)
* **ORM**: [Prisma](https://www.prisma.io/)
* **Database**: PostgreSQL (running in Docker locally) & fallback SQLite (`dev.db` for isolated testing)
* **Background Queue**: Custom interval-based database scheduler polling the `JobQueue` table
* **Package Manager**: `pnpm`

---

## 🚀 Getting Started

### 1. Prerequisites
Ensure you have Node.js (v18+), `pnpm` (v11+), and Docker (to run PostgreSQL) installed.

### 2. Environment Variables
Create a `.env` file in the root of this directory with the following variables:
```env
PORT=5000
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/jobwingman?schema=public"
ML_SERVICE_URL="http://localhost:8000"
```

### 3. Installation
Install project dependencies:
```bash
pnpm install
```

### 4. Database Setup & Migrations
Sync the Prisma schema to your active database instance and generate the Prisma Client:
```bash
pnpm prisma generate
pnpm prisma db push
```

### 5. Running the Server (Development Mode)
To run the server with hot reloading enabled:
```bash
pnpm run dev
```
The server will start on `http://localhost:5000`.

### 6. Production Build
To compile the TypeScript code and start the compiled output:
```bash
pnpm run build
pnpm run start
```

---

## 📁 Repository Structure
* `/src/index.ts`: The server entry point mounting middleware, routes, and initiating background workers.
* `/src/routes/`:
  * `applications.ts`: Handles application submission, file ingestion (proxied to ML parser), evaluation trigger, and "Applied" gate transition.
  * `resumes.ts`: Manages structured resume JSON retrievals and edits.
  * `drafts.ts`: Serves generated aging email follow-up drafts.
* `/src/workers/`:
  * `scheduler.ts`: Interval queue worker that polls the database for due follow-up draft tasks (`DAY_7_CHECK`).
* `/prisma`:
  * `schema.prisma`: Defines the schema models (User, Resume, JobDescription, Application, Suggestion, EmailDraft, JobQueue) mapping to PostgreSQL/SQLite.

---

## 🔒 Scoring & Application Gating
The backend enforces a strict gate limit on the `/api/applications/:id/apply` endpoint:
* If the alignment match score returned by the ML service is **below 70%**, the `gatingFlag` is set to `true`.
* Attempting to transition the status to `APPLIED` will return a `403 Forbidden` unless the request includes a bypass override (`bypassGate: true`).
