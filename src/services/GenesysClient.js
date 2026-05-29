/**
 * Genesys Cloud Open Messaging client.
 *
 * Instantiated once per configured account — NOT a singleton.
 * Accepts a config object so multiple accounts can each have
 * their own Genesys org credentials and integration ID.
 *
 * Handles:
 *  - OAuth 2.0 token management (Client Credentials grant)
 *  - Sending inbound messages to Genesys Cloud Open Messaging API
 *  - Sending typing indicators / delivery receipts
 */

const axios = require('axios');
const logger = require('../utils/logger');

class GenesysClient {
  /**
   * @param {object} config
   * @param {string} config.clientId
   * @param {string} config.clientSecret
   * @param {string} config.baseUrl
   * @param {string} config.integrationId
   * @param {string} [config.webhookSecret]
   */
  constructor(config) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.baseUrl = (config.baseUrl || 'https://api.mypurecloud.com').replace(/\/$/, '');
    this.integrationId = config.integrationId;
    this.webhookSecret = config.webhookSecret || '';

    this._accessToken = null;
    this._tokenExpiresAt = null;

    // Derive auth URL: https://api.mypurecloud.com -> https://login.mypurecloud.com
    this._authBase = this.baseUrl.replace('https://api.', 'https://login.');
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  async _fetchToken() {
    try {
      const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      const res = await axios.post(
        `${this._authBase}/oauth/token`,
        'grant_type=client_credentials',
        {
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
      this._accessToken = res.data.access_token;
      this._tokenExpiresAt = Date.now() + (res.data.expires_in - 60) * 1000;
      logger.info('Genesys Cloud access token refreshed', {
        integrationId: this.integrationId,
        expiresIn: res.data.expires_in,
      });
    } catch (err) {
      logger.error('Failed to fetch Genesys access token', {
        integrationId: this.integrationId,
        error: err.response?.data || err.message,
      });
      throw err;
    }
  }

  async _getToken() {
    if (!this._accessToken || Date.now() >= this._tokenExpiresAt) {
      await this._fetchToken();
    }
    return this._accessToken;
  }

  async _headers() {
    const token = await this._getToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  // ─── Inbound Message ───────────────────────────────────────────────────────

  /**
   * Send an inbound message (from customer) to Genesys Cloud.
   * Genesys will route it to the correct queue / agent.
   *
   * @param {object} messageBody - Genesys normalised message body (from transform.js)
   */
  async sendInboundMessage(messageBody) {
    const headers = await this._headers();
    const url = `${this.baseUrl}/api/v2/conversations/messages/${this.integrationId}/inbound/open/message`;

    try {
      const res = await axios.post(url, messageBody, { headers });
      logger.info('Inbound message sent to Genesys', {
        integrationId: this.integrationId,
        channelId: messageBody.channel?.id,
        status: res.status,
      });
      return res.data;
    } catch (err) {
      logger.error('Failed to send inbound message to Genesys', {
        integrationId: this.integrationId,
        error: err.response?.data || err.message,
        body: messageBody,
      });
      throw err;
    }
  }

  /**
   * Send a typing indicator event.
   *
   * @param {object} eventBody - Genesys normalised event body
   */
  async sendTypingEvent(eventBody) {
    const headers = await this._headers();
    const url = `${this.baseUrl}/api/v2/conversations/messages/${this.integrationId}/inbound/open/event`;

    try {
      const res = await axios.post(url, eventBody, { headers });
      logger.debug('Typing event sent to Genesys', {
        integrationId: this.integrationId,
        status: res.status,
      });
      return res.data;
    } catch (err) {
      logger.warn('Failed to send typing event to Genesys', {
        integrationId: this.integrationId,
        error: err.message,
      });
      // Non-fatal — don't rethrow
    }
  }

  /**
   * Send a delivery receipt.
   *
   * @param {object} receiptBody - Genesys normalised receipt body
   */
  async sendReceipt(receiptBody) {
    const headers = await this._headers();
    const url = `${this.baseUrl}/api/v2/conversations/messages/${this.integrationId}/inbound/open/receipt`;

    try {
      const res = await axios.post(url, receiptBody, { headers });
      logger.debug('Receipt sent to Genesys', {
        integrationId: this.integrationId,
        status: res.status,
      });
      return res.data;
    } catch (err) {
      logger.warn('Failed to send receipt to Genesys', {
        integrationId: this.integrationId,
        error: err.message,
      });
      // Non-fatal
    }
  }
}

module.exports = GenesysClient;
