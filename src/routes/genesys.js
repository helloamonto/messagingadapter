/**
 * Genesys Cloud Outbound Webhook Route Handler (Multi-Account)
 *
 * Each account gets its own outbound webhook URL:
 *   POST /webhook/genesys/:accountId
 *
 * Set your Genesys Open Messaging outbound webhook URL to:
 *   https://<your-domain>/webhook/genesys/<accountId>
 *
 * Receives agent replies from Genesys Cloud, validates HMAC signatures,
 * and delivers them back to TikTok via DM or comment reply.
 */

const express = require('express');
const router = express.Router({ mergeParams: true });

const { verifyGenesysSignature } = require('../utils/crypto');
const { genesysOutboundToTikTok } = require('../utils/transform');
const registry = require('../registry/accountRegistry');
const logger = require('../utils/logger');

// ─── Resolve Account Middleware ────────────────────────────────────────────

function resolveAccount(req, res, next) {
  const { accountId } = req.params;
  const account = registry.get(accountId);

  if (!account) {
    logger.warn('Genesys webhook request for unknown accountId', { accountId });
    return res.status(404).json({ error: `Unknown account: ${accountId}` });
  }

  req.account = account;
  next();
}

router.use(resolveAccount);

// ─── Outbound Message Handler (POST) ──────────────────────────────────────

router.post('/', async (req, res) => {
  const { tiktok: tiktokClient, config } = req.account;
  const accountId = config.id;

  // --- Signature Verification ---
  const rawBody = req.rawBody;
  const signature = req.headers['x-hub-signature-256'];
  const secret = config.genesys.webhookSecret;

  if (secret) {
    if (!verifyGenesysSignature(rawBody, signature, secret)) {
      logger.warn('Genesys outbound webhook signature mismatch — rejecting', { accountId });
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } else {
    logger.warn('genesys.webhookSecret not set — skipping signature check', { accountId });
  }

  // Acknowledge immediately
  res.status(200).json({ received: true });

  const payload = req.body;
  logger.info('Genesys outbound webhook received', {
    accountId,
    type: payload.type,
    channelId: payload.channel?.id,
  });

  // Only process Text messages from agents
  if (payload.type !== 'Text' || !payload.text) {
    logger.debug('Ignoring non-text or empty Genesys outbound message', {
      accountId,
      type: payload.type,
    });
    return;
  }

  // Ignore messages originating from the customer (would create a loop)
  if (payload.originatingEntity === 'Human') {
    logger.debug('Ignoring customer-originated message reflected by Genesys', { accountId });
    return;
  }

  try {
    const { source, recipientUserId, conversationId, videoId, commentId, text } =
      genesysOutboundToTikTok(payload);

    if (source === 'tiktok_comment' && videoId && commentId) {
      logger.info('Sending TikTok comment reply', { accountId, videoId, commentId });
      await tiktokClient.replyToComment({ videoId, commentId, text });
    } else {
      if (!recipientUserId) {
        logger.error('Cannot send TikTok DM — missing recipientUserId', { accountId, payload });
        return;
      }
      logger.info('Sending TikTok DM reply', { accountId, recipientUserId });
      await tiktokClient.sendDM({ recipientUserId, text, conversationId });
    }
  } catch (err) {
    logger.error('Failed to deliver Genesys reply to TikTok', {
      accountId,
      error: err.message,
    });
  }
});

module.exports = router;
