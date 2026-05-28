# TikTok ↔ Genesys Cloud Adapter — Multi-Account Edition

A middleware adapter that bridges **TikTok Business Messaging** (Direct Messages + Post Comments) with **Genesys Cloud Open Messaging**, supporting **multiple TikTok accounts** running on a single server.

---

## What Changed from v1 (Single-Account)

| Area | v1 (Single) | v2 (Multi) |
|---|---|---|
| Config | `.env` only | `accounts.json` (preferred) or `.env` fallback |
| TikTok client | Singleton | One instance per account |
| Genesys client | Singleton | One instance per account |
| Comment poller | One global poller | One poller per account |
| Webhook URL | `/webhook/tiktok` | `/webhook/tiktok/:accountId` |
| Genesys URL | `/webhook/genesys` | `/webhook/genesys/:accountId` |

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure your accounts
```bash
cp accounts.json.example accounts.json
```
Edit `accounts.json` and fill in credentials for each TikTok account.

### 3. Set environment variables
```bash
cp .env.example .env
# Edit .env — only PORT and NODE_ENV are needed when using accounts.json
```

### 4. Start the server
```bash
npm start        # production
npm run dev      # development (auto-restart)
```

---

## accounts.json Structure

```json
[
  {
    "id": "brand_a",
    "tiktok": {
      "clientKey": "...",
      "clientSecret": "...",
      "businessId": "...",
      "webhookVerifyToken": "..."
    },
    "genesys": {
      "clientId": "...",
      "clientSecret": "...",
      "baseUrl": "https://api.mypurecloud.com",
      "integrationId": "...",
      "webhookSecret": "..."
    },
    "commentPollCron": "*/2 * * * *"
  }
]
```

Add as many objects as you have TikTok accounts. The `id` must be unique — it becomes part of the webhook URL.

---

## Webhook URLs

For each account with `"id": "brand_a"`, set these URLs in the respective portals:

| Portal | Setting | URL |
|---|---|---|
| TikTok Developer Portal | Webhook URL | `https://your-domain.com/webhook/tiktok/brand_a` |
| Genesys Cloud Admin | Open Messaging outbound webhook | `https://your-domain.com/webhook/genesys/brand_a` |

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Server health + list of registered account IDs |
| `GET /accounts` | Summary of all accounts and their webhook URLs |
| `GET /` | Landing page |

---

## Genesys Cloud Setup (per account)

1. Create a separate **Open Messaging Integration** for each TikTok account
2. Note its **Integration ID** — goes into `accounts.json → genesys.integrationId`
3. Set the outbound webhook URL to `https://your-domain.com/webhook/genesys/<accountId>`
4. Copy the webhook secret into `accounts.json → genesys.webhookSecret`

---

## Architecture

```
accounts.json
      │
      ▼
AccountRegistry (singleton)
  ├── brand_a: { TikTokClient, GenesysClient, CommentPoller }
  └── brand_b: { TikTokClient, GenesysClient, CommentPoller }

POST /webhook/tiktok/:accountId
  → registry.get(accountId)
  → tiktokDMToGenesys(payload, integrationId)
  → genesysClient.sendInboundMessage(...)

POST /webhook/genesys/:accountId
  → registry.get(accountId)
  → genesysOutboundToTikTok(payload)
  → tiktokClient.sendDM(...) | tiktokClient.replyToComment(...)
```
