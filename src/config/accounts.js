/**
 * Account Configuration Loader
 *
 * Loads multi-account configuration from accounts.json (preferred)
 * or falls back to a single-account setup via environment variables
 * for backwards compatibility.
 *
 * accounts.json shape:
 * [
 *   {
 *     "id": "brand_a",
 *     "tiktok": {
 *       "clientKey": "...",
 *       "clientSecret": "...",
 *       "businessId": "...",
 *       "webhookVerifyToken": "..."
 *     },
 *     "genesys": {
 *       "clientId": "...",
 *       "clientSecret": "...",
 *       "baseUrl": "https://api.mypurecloud.com",
 *       "integrationId": "...",
 *       "webhookSecret": "..."
 *     },
 *     "commentPollCron": "every 2 minutes cron expression"
 *   }
 * ]
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const ACCOUNTS_FILE = path.resolve(process.cwd(), 'accounts.json');

/**
 * Load and validate account configurations.
 * @returns {Array<object>} Array of validated account config objects
 */
function loadAccounts() {
  // ── Primary: accounts.json ─────────────────────────────────────────────────
  if (fs.existsSync(ACCOUNTS_FILE)) {
    logger.info('Loading accounts from accounts.json', { path: ACCOUNTS_FILE });
    const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
    let accounts;
    try {
      accounts = JSON.parse(raw);
    } catch (err) {
      logger.error('Failed to parse accounts.json', { error: err.message });
      process.exit(1);
    }

    if (!Array.isArray(accounts) || accounts.length === 0) {
      logger.error('accounts.json must be a non-empty array');
      process.exit(1);
    }

    accounts.forEach((acc, i) => validateAccount(acc, i));
    logger.info(`Loaded ${accounts.length} account(s) from accounts.json`);
    return accounts;
  }

  // ── Fallback: single-account via environment variables ────────────────────
  logger.info('accounts.json not found — loading single account from environment variables');

  const REQUIRED_ENV = [
    'TIKTOK_CLIENT_KEY',
    'TIKTOK_CLIENT_SECRET',
    'TIKTOK_BUSINESS_ID',
    'GENESYS_CLIENT_ID',
    'GENESYS_CLIENT_SECRET',
    'GENESYS_BASE_URL',
    'GENESYS_INTEGRATION_ID',
  ];
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    logger.error(
      'Neither accounts.json nor the required env vars are present. ' +
        `Missing: ${missing.join(', ')}`
    );
    process.exit(1);
  }

  return [
    {
      id: 'default',
      tiktok: {
        clientKey: process.env.TIKTOK_CLIENT_KEY,
        clientSecret: process.env.TIKTOK_CLIENT_SECRET,
        businessId: process.env.TIKTOK_BUSINESS_ID,
        webhookVerifyToken: process.env.TIKTOK_WEBHOOK_VERIFY_TOKEN || '',
      },
      genesys: {
        clientId: process.env.GENESYS_CLIENT_ID,
        clientSecret: process.env.GENESYS_CLIENT_SECRET,
        baseUrl: process.env.GENESYS_BASE_URL || 'https://api.mypurecloud.com',
        integrationId: process.env.GENESYS_INTEGRATION_ID,
        webhookSecret: process.env.GENESYS_WEBHOOK_SECRET || '',
      },
      commentPollCron: process.env.COMMENT_POLL_CRON || '*/2 * * * *',
    },
  ];
}

/**
 * Validate a single account config object.
 * Exits the process if required fields are missing.
 */
function validateAccount(acc, index) {
  const label = `accounts[${index}] (id: ${acc.id || 'unknown'})`;

  const requiredFields = [
    ['id', acc.id],
    ['tiktok.clientKey', acc.tiktok && acc.tiktok.clientKey],
    ['tiktok.clientSecret', acc.tiktok && acc.tiktok.clientSecret],
    ['tiktok.businessId', acc.tiktok && acc.tiktok.businessId],
    ['genesys.clientId', acc.genesys && acc.genesys.clientId],
    ['genesys.clientSecret', acc.genesys && acc.genesys.clientSecret],
    ['genesys.integrationId', acc.genesys && acc.genesys.integrationId],
  ];

  const missing = requiredFields.filter(([, val]) => !val).map(([field]) => field);
  if (missing.length > 0) {
    logger.error(`${label} is missing required fields: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Apply defaults
  acc.genesys.baseUrl = acc.genesys.baseUrl || 'https://api.mypurecloud.com';
  acc.genesys.webhookSecret = acc.genesys.webhookSecret || '';
  acc.tiktok.webhookVerifyToken = acc.tiktok.webhookVerifyToken || '';
  acc.commentPollCron = acc.commentPollCron || '*/2 * * * *';
}

module.exports = { loadAccounts };
