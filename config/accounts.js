const fs = require('fs');
const path = require('path');

const accountsPath = path.join(__dirname, '..', 'accounts.json');
const { accounts } = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));

function getAccountByTikTokBusinessId(tiktokBusinessId) {
  return accounts.find(a => a.tiktokBusinessId === tiktokBusinessId) || null;
}

function getAccountByIntegrationId(integrationId) {
  return accounts.find(a => a.genesys.integrationId === integrationId) || null;
}

module.exports = { getAccountByTikTokBusinessId, getAccountByIntegrationId };
