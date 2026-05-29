const fs = require('fs');
const path = require('path');

/**
 * Loads accounts from accounts.json (local dev) or ACCOUNTS_JSON env var (production/Render).
 *
 * On Render: set an environment variable named ACCOUNTS_JSON with the full JSON content.
 * Example value:
 * {"accounts":[{"tiktokBusinessId":"...","tiktokAppSecret":"...","tiktokAccessToken":"...","genesys":{"region":"mypurecloud.com","clientId":"...","clientSecret":"...","integrationId":"..."}}]}
 */
function loadAccounts() {
  // 1. Try ACCOUNTS_JSON environment variable (used on Render/production)
  if (process.env.ACCOUNTS_JSON) {
    try {
      const { accounts } = JSON.parse(process.env.ACCOUNTS_JSON);
      console.log(`Loaded ${accounts.length} account(s) from ACCOUNTS_JSON env var`);
      return accounts;
    } catch (e) {
      throw new Error('Failed to parse ACCOUNTS_JSON environment variable: ' + e.message);
    }
  }

  // 2. Try accounts.json file (local development)
  const accountsPath = path.join(__dirname, '..', 'accounts.json');
  if (fs.existsSync(accountsPath)) {
    const { accounts } = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
    console.log(`Loaded ${accounts.length} account(s) from accounts.json`);
    return accounts;
  }

  // 3. No config found — start with empty accounts (server still boots)
  console.warn('WARNING: No accounts configured. Set ACCOUNTS_JSON env var or create accounts.json');
  return [];
}

const accounts = loadAccounts();

function getAccountByTikTokBusinessId(tiktokBusinessId) {
  return accounts.find(a => a.tiktokBusinessId === tiktokBusinessId) || null;
}

function getAccountByIntegrationId(integrationId) {
  return accounts.find(a => a.genesys.integrationId === integrationId) || null;
}

module.exports = { getAccountByTikTokBusinessId, getAccountByIntegrationId };
