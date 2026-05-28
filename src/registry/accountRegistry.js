/**
 * Account Registry
 *
 * Holds one TikTokClient, one GenesysClient, and one CommentPoller
 * per configured account. Routes look up the correct set of clients
 * by account ID.
 *
 * Usage:
 *   const registry = require('./accountRegistry');
 *   const { tiktok, genesys } = registry.get('brand_a');
 */

const TikTokClient = require('../services/TikTokClient');
const GenesysClient = require('../services/GenesysClient');
const CommentPoller = require('../services/CommentPoller');
const logger = require('../utils/logger');

class AccountRegistry {
  constructor() {
    /** @type {Map<string, { tiktok: TikTokClient, genesys: GenesysClient, poller: CommentPoller, config: object }>} */
    this._accounts = new Map();
  }

  /**
   * Initialise the registry from an array of account configs.
   * Creates client instances and starts comment pollers for each account.
   *
   * @param {Array<object>} accounts - from loadAccounts()
   */
  init(accounts) {
    for (const config of accounts) {
      const tiktok = new TikTokClient(config.tiktok);
      const genesys = new GenesysClient(config.genesys);
      const poller = new CommentPoller({ tiktok, genesys, cron: config.commentPollCron });

      this._accounts.set(config.id, { tiktok, genesys, poller, config });
      logger.info(`Account registered: ${config.id}`, {
        businessId: config.tiktok.businessId,
        integrationId: config.genesys.integrationId,
      });
    }
  }

  /**
   * Start comment pollers for all accounts.
   */
  startPollers() {
    for (const [id, { poller }] of this._accounts) {
      logger.info(`Starting comment poller for account: ${id}`);
      poller.start();
    }
  }

  /**
   * Stop all comment pollers (called on graceful shutdown).
   */
  stopPollers() {
    for (const [id, { poller }] of this._accounts) {
      logger.info(`Stopping comment poller for account: ${id}`);
      poller.stop();
    }
  }

  /**
   * Retrieve the clients for a given account ID.
   *
   * @param {string} accountId
   * @returns {{ tiktok: TikTokClient, genesys: GenesysClient, config: object } | null}
   */
  get(accountId) {
    return this._accounts.get(accountId) || null;
  }

  /**
   * Check if an account exists.
   * @param {string} accountId
   * @returns {boolean}
   */
  has(accountId) {
    return this._accounts.has(accountId);
  }

  /**
   * Return all registered account IDs.
   * @returns {string[]}
   */
  ids() {
    return Array.from(this._accounts.keys());
  }

  /**
   * Find an account by its TikTok client_key.
   * Used as a secondary check when TikTok embeds client_key in the webhook payload.
   *
   * @param {string} clientKey
   * @returns {{ tiktok: TikTokClient, genesys: GenesysClient, config: object } | null}
   */
  getByClientKey(clientKey) {
    for (const entry of this._accounts.values()) {
      if (entry.config.tiktok.clientKey === clientKey) return entry;
    }
    return null;
  }
}

// Singleton — shared across all route modules
module.exports = new AccountRegistry();
