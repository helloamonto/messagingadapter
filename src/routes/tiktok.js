/**
 * TikTok Webhook Route Handler (Multi-Account)
 *
 * Each TikTok account gets its own webhook URL:
 *   GET  /webhook/tiktok/:accountId  — TikTok webhook verification challenge
 *   POST /webhook/tiktok/:accountId  — TikTok event delivery
 *
 * The :accountId path segment maps to the "id" field in accounts.json.
 * Set your TikTok Developer Portal webhook URL to:
 *   https://<your-domain>/webhook/tiktok/<accountId>
 */

const express = require('express');
const router = express.Router({ mergeParams: true });

const { verifyTikTokSignature } = require('../utils/crypto');
const { tiktokDMToGenesys, tiktokCommentToGenesys } = require('../utils/transform');
const registry = require('../registry/accountRegistry');
const logger = require('../utils/logger');

// ─── Resolve Account Middleware ────────────────────────────────────────────

/**
 * Looks up the account from :accountId and attaches it to req.account.
 * Returns 404 if the ID is not registered.
 */
function resolveAccount(req, res, next) {
  const { accountId } = req.params;
  const account = registry.get(accountId);

  if (!account) {
    logger.warn('TikTok webhook request for unknown accountId', { accountId });
    return res.status(404).json({ error: `Unknown account: ${accountId}` });
  }

  req.account = account; // { tiktok, genesys, config }
  next();
}

router.use(resolveAccount);

// ─── Webhook Verification (GET) ────────────────────────────────────────────

router.get('/', (req, res) => {
  const challenge = req.query.challenge;
  const verifyToken = req.query.token || req.query.verify_token;
  const { config } = req.account;

  if (!challenge) {
    return res.status(400).json({ error: 'Missing challenge parameter' });
  }

  // Validate verify token if one is configured for this account
  if (
    config.tiktok.webhookVerifyToken &&
    verifyToken !== config.tiktok.webhookVerifyToken
  ) {
    logger.warn('TikTok webhook verification failed: wrong verify token', {
      accountId: config.id,
    });
    return res.status(403).json({ error: 'Invalid verify token' });
  }

  logger.info('TikTok webhook verified successfully', { accountId: config.id });
  return res.status(200).send(challenge);
});

// ─── Event Delivery (POST) ─────────────────────────────────────────────────

router.post('/', async (req, res) => {
  // Respond 200 immediately — TikTok requires this within a short timeout
  res.status(200).json({ received: true });

  const { tiktok: tiktokClient, genesys: genesysClient, config } = req.account;
  const accountId = config.id;

  // --- Signature Verification ---
  const rawBody = req.rawBody;
  const signature = req.headers['x-tiktok-signature'];

  if (config.tiktok.clientSecret && signature) {
    if (!verifyTikTokSignature(rawBody, signature, config.tiktok.clientSecret)) {
      logger.warn('TikTok webhook signature mismatch — ignoring event', { accountId });
      return;
    }
  } else {
    logger.warn('TikTok webhook received without signature — proceeding (configure secret in prod)', {
      accountId,
    });
  }

  const payload = req.body;
  const event = payload.event;

  // Optional: cross-check client_key in payload against registered account
  if (payload.client_key && payload.client_key !== config.tiktok.clientKey) {
    logger.warn('TikTok webhook client_key mismatch — ignoring', {
      accountId,
      payloadClientKey: payload.client_key,
      expectedClientKey: config.tiktok.clientKey,
    });
    return;
  }

  logger.info('TikTok webhook event received', { accountId, event, createTime: payload.create_time });

  try {
    switch (event) {
      case 'direct_message_received':
      case 'message_received':
        await handleDMReceived(payload, genesysClient, accountId);
        break;

      case 'comment_received':
      case 'video_comment':
        await handleCommentReceived(payload, genesysClient, accountId);
        break;

      default:
        logger.debug('Unhandled TikTok event type', { accountId, event });
    }
  } catch (err) {
    logger.error('Error processing TikTok webhook event', {
      accountId,
      event,
      error: err.message,
    });
  }
});

// ─── Handlers ──────────────────────────────────────────────────────────────

async function handleDMReceived(payload, genesysClient, accountId) {
  const genesysBody = tiktokDMToGenesys(payload, genesysClient.integrationId);
  logger.debug('Forwarding TikTok DM to Genesys', {
    accountId,
    channelId: genesysBody.channel.id,
  });
  await genesysClient.sendInboundMessage(genesysBody);
}

async function handleCommentReceived(payload, genesysClient, accountId) {
  const genesysBody = tiktokCommentToGenesys(payload, genesysClient.integrationId);
  logger.debug('Forwarding TikTok comment to Genesys', {
    accountId,
    channelId: genesysBody.channel.id,
    commentId: payload.content?.comment_id,
  });
  await genesysClient.sendInboundMessage(genesysBody);
}

module.exports = router;
