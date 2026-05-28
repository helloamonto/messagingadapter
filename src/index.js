/**
 * TikTok ↔ Genesys Cloud Open Messaging Adapter (Multi-Account)
 *
 * Bootstraps Express server, loads all accounts from accounts.json,
 * registers per-account webhook routes, and starts comment pollers.
 *
 * Webhook URLs (set these in TikTok Developer Portal and Genesys Admin):
 *   TikTok  inbound:  POST /webhook/tiktok/:accountId
 *   Genesys outbound: POST /webhook/genesys/:accountId
 *
 * Where :accountId matches the "id" field in each entry of accounts.json.
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const logger = require('./utils/logger');
const { loadAccounts } = require('./config/accounts');
const registry = require('./registry/accountRegistry');
const tiktokRouter = require('./routes/tiktok');
const genesysRouter = require('./routes/genesys');

// ─── Load & Register Accounts ──────────────────────────────────────────────

const accounts = loadAccounts();
registry.init(accounts);

// ─── Express App ───────────────────────────────────────────────────────────

const app = express();

/**
 * Raw body capture middleware — needed for HMAC signature verification
 * on both TikTok and Genesys webhooks.
 */
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);

app.use(express.urlencoded({ extended: true }));

// ─── Static Files ──────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, '../public')));

// ─── Health Check ──────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'amontoadapter-multi',
    accounts: registry.ids(),
  });
});

// ─── Accounts Status ───────────────────────────────────────────────────────

app.get('/accounts', (_req, res) => {
  const summary = registry.ids().map((id) => {
    const { config } = registry.get(id);
    return {
      id,
      tiktokBusinessId: config.tiktok.businessId,
      genesysIntegrationId: config.genesys.integrationId,
      webhookUrls: {
        tiktok: `/webhook/tiktok/${id}`,
        genesys: `/webhook/genesys/${id}`,
      },
    };
  });
  res.json({ accounts: summary });
});

// ─── Landing Page ──────────────────────────────────────────────────────────

const SHARED_STYLE = `
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: #f8fafc; color: #0f172a; line-height: 1.7; }
    header { background: #fff; border-bottom: 1px solid #e2e8f0; padding: 0 2rem; display: flex;
             align-items: center; gap: 1rem; height: 64px; }
    header .logo { font-size: 1.25rem; font-weight: 700; color: #0f172a; text-decoration: none; }
    header .logo span { color: #0ea5e9; }
    header nav { margin-left: auto; display: flex; gap: 1.5rem; }
    header nav a { font-size: 0.9rem; color: #64748b; text-decoration: none; }
    header nav a:hover { color: #0ea5e9; }
    main { max-width: 780px; margin: 3rem auto; padding: 0 1.5rem 4rem; }
    h1 { font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; }
    h2 { font-size: 1.2rem; font-weight: 600; margin: 2rem 0 0.5rem; color: #0f172a; }
    p, li { color: #334155; margin-bottom: 0.75rem; }
    ul { padding-left: 1.25rem; }
    .pill { display: inline-block; background: #e0f2fe; color: #0369a1; font-size: 0.78rem;
            font-weight: 600; padding: 0.2rem 0.6rem; border-radius: 999px; margin-bottom: 1rem; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
             padding: 2rem; margin-bottom: 1.5rem; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1.5rem; }
    .feature { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 1.25rem; }
    .feature h3 { font-size: 0.95rem; font-weight: 600; margin-bottom: 0.35rem; }
    .feature p { font-size: 0.875rem; color: #64748b; margin: 0; }
    footer { text-align: center; padding: 2rem; font-size: 0.8rem; color: #94a3b8; }
    a { color: #0ea5e9; }
    @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } h1 { font-size: 1.5rem; } }
  </style>
`;

app.get('/', (_req, res) => {
  res.send(`<!DOCTYPE html><html lang="en">
<head>${SHARED_STYLE}<title>TikTok Business Messaging for Genesys Cloud — Multi-Account</title></head>
<body>
<header>
  <a class="logo" href="/">Amonto<span>.</span></a>
  <nav>
    <a href="/health">Status</a>
    <a href="/accounts">Accounts</a>
    <a href="/terms">Terms</a>
    <a href="/privacy">Privacy</a>
  </nav>
</header>
<main>
  <span class="pill">Multi-Account Edition</span>
  <h1>TikTok Business Messaging<br/>for Genesys Cloud</h1>
  <p>A middleware adapter that bridges TikTok Business Messaging — Direct Messages and Post Comments — with Genesys Cloud Open Messaging, supporting <strong>multiple TikTok accounts</strong> simultaneously.</p>

  <div class="grid">
    <div class="feature">
      <h3>Multi-Account</h3>
      <p>Run as many TikTok business accounts as you need — each with its own Genesys integration and isolated webhook URL.</p>
    </div>
    <div class="feature">
      <h3>Per-Account Routing</h3>
      <p>Webhook URLs include the account ID so events are always routed to the correct TikTok ↔ Genesys pair.</p>
    </div>
    <div class="feature">
      <h3>Comment Polling</h3>
      <p>Per-account cron-based fallback polls for new comments every 2 minutes where webhooks are unavailable.</p>
    </div>
    <div class="feature">
      <h3>Secure by Default</h3>
      <p>HMAC-SHA256 signature verification per account. OAuth tokens rotate automatically per account.</p>
    </div>
  </div>

  <div class="card" style="margin-top:2rem;">
    <h2 style="margin-top:0">Contact</h2>
    <p>For support or enquiries, contact us at <a href="mailto:lek@amonto.co.th">lek@amonto.co.th</a>.</p>
  </div>
</main>
<footer>&copy; ${new Date().getFullYear()} Amonto. All rights reserved. &nbsp;&middot;&nbsp; <a href="/terms">Terms of Service</a> &nbsp;&middot;&nbsp; <a href="/privacy">Privacy Policy</a></footer>
</body></html>`);
});

// ─── Legal Pages ───────────────────────────────────────────────────────────

app.get('/terms', (_req, res) => {
  res.send(`<!DOCTYPE html><html lang="en">
<head>${SHARED_STYLE}<title>Terms of Service — Amonto</title></head>
<body>
<header>
  <a class="logo" href="/">Amonto<span>.</span></a>
  <nav><a href="/privacy">Privacy Policy</a></nav>
</header>
<main>
  <h1>Terms of Service</h1>
  <p style="color:#64748b;margin-bottom:2rem;">Effective Date: 19 May 2026</p>
  <h2>1. Acceptance of Terms</h2>
  <p>By installing, accessing, or using TikTok Business Messaging for Genesys Cloud (the &ldquo;Service&rdquo;), you agree to be bound by these Terms.</p>
  <h2>2. Description of the Service</h2>
  <p>The Service is a middleware adapter that routes TikTok Business Messages and Post Comments to Genesys Cloud Open Messaging, supporting multiple TikTok business accounts.</p>
  <h2>3. Contact</h2>
  <p>Questions? Email us at <a href="mailto:lek@amonto.co.th">lek@amonto.co.th</a>.</p>
</main>
<footer>&copy; ${new Date().getFullYear()} Amonto. &nbsp;&middot;&nbsp; <a href="/">Home</a></footer>
</body></html>`);
});

app.get('/privacy', (_req, res) => {
  res.send(`<!DOCTYPE html><html lang="en">
<head>${SHARED_STYLE}<title>Privacy Policy — Amonto</title></head>
<body>
<header>
  <a class="logo" href="/">Amonto<span>.</span></a>
  <nav><a href="/terms">Terms of Service</a></nav>
</header>
<main>
  <h1>Privacy Policy</h1>
  <p style="color:#64748b;margin-bottom:2rem;">Effective Date: 19 May 2026</p>
  <h2>1. Overview</h2>
  <p>This Privacy Policy describes how Amonto handles information when you use TikTok Business Messaging for Genesys Cloud. The Service is a middleware adapter — it does not persistently store message content beyond short-term operational logs.</p>
  <h2>2. Contact</h2>
  <p>Privacy questions? Email us at <a href="mailto:lek@amonto.co.th">lek@amonto.co.th</a>.</p>
</main>
<footer>&copy; ${new Date().getFullYear()} Amonto. &nbsp;&middot;&nbsp; <a href="/">Home</a></footer>
</body></html>`);
});

// ─── Webhook Routes (per-account) ──────────────────────────────────────────

app.use('/webhook/tiktok/:accountId', tiktokRouter);
app.use('/webhook/genesys/:accountId', genesysRouter);

// ─── 404 Handler ──────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Global Error Handler ──────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ─────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT, 10) || 3000;

app.listen(PORT, () => {
  logger.info(`Amonto multi-account adapter listening on port ${PORT}`);
  logger.info('Registered accounts and webhook endpoints:');
  for (const id of registry.ids()) {
    logger.info(`  [${id}]  TikTok  → POST /webhook/tiktok/${id}`);
    logger.info(`  [${id}]  Genesys → POST /webhook/genesys/${id}`);
  }

  registry.startPollers();
});

// ─── Graceful Shutdown ─────────────────────────────────────────────────────

function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);
  registry.stopPollers();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
