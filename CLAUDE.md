# QuikBoys ONDC — Development Guide

## What This Repo Is
Standalone ONDC module extracted from the QuikBoys NestJS monolith.
Implements Beckn Protocol BPP for ONDC:LOG (Logistics) domain.

## Key Rules
- **Prisma schema here is a COPY** — the monolith schema is the source of truth for production
- **Stubs in `src/stubs/`** are placeholder implementations for monolith services. They log warnings and return mock data. Replace them with real integrations when deploying as part of the monolith.
- **Never commit `.env` or `.env.local`** — use `.env.example` as template
- All Beckn protocol endpoints require Ed25519 signature verification (except test BAPs)
- Internal imports within `src/ondc/` use relative paths — don't change these

## Running
```bash
npm run start:dev    # Development with watch mode
npm run build        # Production build
npm run start:prod   # Run production build
```

## Testing Against ONDC Sandbox
1. Set `ONDC_ENVIRONMENT=staging` in `.env.local`
2. Set `ONDC_TRUSTED_TEST_BAPS` with Pramaan BAP IDs to skip signature verification
3. Use ONDC Pramaan tool to send test requests

## Architecture
- Processors handle each Beckn action asynchronously (ACK immediately, callback later)
- CallbackService sends `on_*` responses back to BAP with retry logic
- SignatureService handles Ed25519 signing/verification per Beckn spec
- NetworkObservabilityService tracks response time metrics for N.O. compliance
