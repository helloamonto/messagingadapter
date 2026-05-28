/**
 * TikTok Business API client.
 *
 * Instantiated once per configured account — NOT a singleton.
 * Accepts a config object so multiple accounts can each have
 * their own credentials and independent token caches.
 *
 * Handles:
 *  - OAuth 2.0 token management (client credentials flow)
 *  - Sending DMs via Business Messaging API
 *  - Replying to / listing comments via Content API
 */

const axios = require('axios');
const logger = require('../utils/logger');

const TIKTOK_AUTH_URL = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/token/';
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

class TikTokClient {
  /**
   * @param {object} config
   * @param {string} config.clientKey
   * @param {string} config.clientSecret
   * @param {string} config.businessId
   * @param {string} [config.webhookVerifyToken]
   */
  constructor(config) {
    this.clientKey = config.clientKey;
    this.clientSecret = config.clientSecret;
    this.businessId = config.businessId;
    this.webhookVerifyToken = config.webhookVerifyToken || '';

    this._accessToken = null;
    this._tokenExpiresAt = null;
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  async _fetchToken() {
    try {
      const response = await axios.post(TIKTOK_AUTH_URL, {
        client_key: this.clientKey,
        client_secret: this.clientSecret,
        grant_type: 'client_credentials',
      });

      const data = response.data && response.data.data;
      if (!data || !data.access_token) {
        throw new Error(`Unexpected token response: ${JSON.stringify(response.data)}`);
      }

      this._accessToken = data.access_token;
      this._tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
      logger.info('TikTok access token refreshed', {
        businessId: this.businessId,
        expiresIn: data.expires_in,
      });
    } catch (err) {
      logger.error('Failed to fetch TikTok access token', {
        businessId: this.businessId,
        error: err.message,
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
      'Access-Token': token,
      'Content-Type': 'application/json',
    };
  }

  // ─── Direct Messages ───────────────────────────────────────────────────────

  /**
   * Send a text direct message to a TikTok user.
   *
   * @param {string} recipientUserId  - TikTok user open_id of the recipient
   * @param {string} text             - Message text
   * @param {string} [conversationId] - Existing conversation ID (if any)
   */
  async sendDM({ recipientUserId, text, conversationId }) {
    const headers = await this._headers();
    const body = {
      business_id: this.businessId,
      to_user_id: recipientUserId,
      message: { type: 'text', content: text },
    };
    if (conversationId) body.conversation_id = conversationId;

    try {
      const res = await axios.post(
        `${TIKTOK_API_BASE}/business/messaging/send/`,
        body,
        { headers }
      );
      logger.info('TikTok DM sent', {
        businessId: this.businessId,
        recipientUserId,
        messageId: res.data?.data?.message_id,
      });
      return res.data;
    } catch (err) {
      logger.error('Failed to send TikTok DM', {
        businessId: this.businessId,
        recipientUserId,
        error: err.response?.data || err.message,
      });
      throw err;
    }
  }

  // ─── Comments ──────────────────────────────────────────────────────────────

  /**
   * Reply to a comment on a TikTok video.
   *
   * @param {string} videoId    - TikTok video ID
   * @param {string} commentId  - Comment ID to reply to
   * @param {string} text       - Reply text
   */
  async replyToComment({ videoId, commentId, text }) {
    const headers = await this._headers();
    const body = {
      business_id: this.businessId,
      video_id: videoId,
      comment_id: commentId,
      text,
    };

    try {
      const res = await axios.post(
        `${TIKTOK_API_BASE}/business/comment/reply/`,
        body,
        { headers }
      );
      logger.info('TikTok comment reply sent', {
        businessId: this.businessId,
        videoId,
        commentId,
      });
      return res.data;
    } catch (err) {
      logger.error('Failed to reply to TikTok comment', {
        businessId: this.businessId,
        videoId,
        commentId,
        error: err.response?.data || err.message,
      });
      throw err;
    }
  }

  /**
   * List recent comments on a video (used for polling fallback).
   *
   * @param {string} videoId - TikTok video ID
   * @param {number} count   - Number of comments to fetch (max 50)
   * @param {string} [cursor] - Pagination cursor
   */
  async listComments({ videoId, count = 20, cursor }) {
    const headers = await this._headers();
    const params = { business_id: this.businessId, video_id: videoId, count };
    if (cursor) params.cursor = cursor;

    try {
      const res = await axios.get(
        `${TIKTOK_API_BASE}/business/comment/list/`,
        { headers, params }
      );
      return res.data;
    } catch (err) {
      logger.error('Failed to list TikTok comments', {
        businessId: this.businessId,
        videoId,
        error: err.response?.data || err.message,
      });
      throw err;
    }
  }

  /**
   * List recent videos for the business account (used for comment polling).
   *
   * @param {number} count - Number of videos to return
   */
  async listVideos({ count = 10 } = {}) {
    const headers = await this._headers();
    try {
      const res = await axios.get(
        `${TIKTOK_API_BASE}/business/video/list/`,
        { headers, params: { business_id: this.businessId, fields: 'id,create_time', count } }
      );
      return res.data?.data?.videos || [];
    } catch (err) {
      logger.error('Failed to list TikTok videos', {
        businessId: this.businessId,
        error: err.response?.data || err.message,
      });
      return [];
    }
  }

  /**
   * Hide (delete) a comment. Useful for moderation.
   *
   * @param {string} videoId
   * @param {string} commentId
   */
  async hideComment({ videoId, commentId }) {
    const headers = await this._headers();
    try {
      const res = await axios.post(
        `${TIKTOK_API_BASE}/business/comment/hide/`,
        { business_id: this.businessId, video_id: videoId, comment_id: commentId, is_hidden: true },
        { headers }
      );
      logger.info('TikTok comment hidden', { businessId: this.businessId, videoId, commentId });
      return res.data;
    } catch (err) {
      logger.error('Failed to hide TikTok comment', {
        businessId: this.businessId,
        error: err.response?.data || err.message,
      });
      throw err;
    }
  }
}

module.exports = TikTokClient;
