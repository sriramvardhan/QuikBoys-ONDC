# QuikBoys ONDC Module

Standalone NestJS service for ONDC (Open Network for Digital Commerce) integration.
This repo contains the **Beckn Protocol BPP implementation** for the `ONDC:LOG` (Logistics) domain.

## Architecture

This module was extracted from the QuikBoys monolith for independent ONDC team development.
It runs standalone with stub implementations for monolith dependencies (dispatch, hubs, payments).

```
src/
├── ondc/                    # Core ONDC module (86 files)
│   ├── controllers/         # Webhook, verification, redirect controllers
│   ├── processors/          # Beckn action processors (search, select, init, confirm, etc.)
│   ├── services/            # Business logic (catalog, quotes, tracking, AWB, RTO, etc.)
│   ├── guards/              # Beckn signature verification
│   ├── igm/                 # Issue & Grievance Management (IGM)
│   ├── rsp/                 # Reconciliation, Settlement & Payouts (RSP/RSF 2.0)
│   ├── constants/           # Beckn actions, error codes, fulfillment states
│   ├── interfaces/          # TypeScript interfaces for Beckn protocol
│   └── config/              # ONDC configuration
├── contracts/               # Interface contracts for monolith dependencies
├── stubs/                   # Stub implementations for standalone development
├── database/                # Prisma database module
├── auth/                    # Auth decorators & guards (stubs)
├── common/                  # Shared utilities (resilience, events, errors)
└── config/                  # Environment config helpers
```

## Beckn Protocol Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/ondc/search` | Find logistics services |
| POST | `/ondc/select` | Select a service |
| POST | `/ondc/init` | Initialize order |
| POST | `/ondc/confirm` | Confirm order |
| POST | `/ondc/status` | Get order status |
| POST | `/ondc/track` | Get tracking info |
| POST | `/ondc/cancel` | Cancel order |
| POST | `/ondc/update` | Update order |
| POST | `/ondc/on_subscribe` | Registry subscription |
| POST | `/ondc/igm/issue` | IGM - receive issue |
| POST | `/ondc/rsp/webhook` | RSP settlement webhook |
| GET | `/ondc/health` | Health check |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment config
cp .env.example .env.local
# Edit .env.local with your ONDC credentials and database URL

# 3. Generate Prisma client
npx prisma generate

# 4. Push schema to database (dev only)
npx prisma db push

# 5. Start development server
npm run start:dev
```

## External Dependencies (Stubs)

These services are stubbed for standalone development. In production (monolith),
the real implementations are used:

| Dependency | Stub | What it does in production |
|-----------|------|--------------------------|
| `AutoDispatchService` | Logs & no-ops | Two-phase driver assignment (sequential → broadcast) |
| `HubLoadBalancingService` | Returns default hub | Routes orders to optimal hub by location/capacity |
| `IciciPayoutOrchestratorService` | Logs & no-ops | ICICI bank payouts for settlements |
| `LocationModule` | Empty module | GPS tracking & location accuracy pipeline |

## Integration with Monolith

When merging changes back to the monolith:

1. Copy `src/ondc/` files back to `backend/delivery-app-backend/src/ondc/`
2. Revert import paths from stubs to monolith modules
3. Sync any Prisma schema changes to the monolith's `schema.prisma`
4. Run `prisma migrate dev` in the monolith

## ONDC Compliance

- **Phase 1**: AWB generation, PCC/DCC confirmation codes, cancellation terms
- **Phase 2**: Weight differential charges, e-way bills, shipping labels, RTO workflow
- **Phase 3**: Multimodal transport, hyperlocal optimization, delivery slots, surge pricing
- **IGM**: Full Issue & Grievance Management (issue, issue_status)
- **RSP**: RSF 2.0 compliant reconciliation, settlement batches, GST invoicing
- **N.O.**: Network Observability metrics tracking (response times per action)

## Environment Variables

See `.env.example` for the full list. Key variables:

- `ONDC_SUBSCRIBER_ID` — Your ONDC subscriber ID
- `ONDC_SIGNING_PRIVATE_KEY` — Ed25519 private key (Base64)
- `ONDC_SIGNING_PUBLIC_KEY` — Ed25519 public key (Base64)
- `ONDC_ENVIRONMENT` — `staging` or `production`
- `DATABASE_URL` — PostgreSQL connection string
