const express = require('express');
const router = express.Router();
const { getAccountByTikTokBusinessId } = require('../config/accounts');
const { verifySignature, parseMessageEvent } = require('../services/tiktok');
const { sendInboundMessage } = require('../services/genesys');
const conversationStore = require('../services/conversationStore');
const logger = require('../services/logger');

// TikTok GET challenge verification (required when registering the webhook URL)
router.get('/', (req, res) => {
  const challenge = req.query.challenge;
  if (challenge) {
    logger.info('TikTok webhook challenge received', { challenge });
    return res.json({ challenge });
  }
  res.status(200).send('Webhook active');
});

// TikTok POST inbound event handler
router.post('/', express.raw({ type: '*/*' }), async (req, res) => {
  const rawBody = req.body;
  const signature = req.headers['x-tiktok-signature'];

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    logger.warn('Received invalid JSON body from TikTok');
    return res.status(200).json({ status: 'ignored', reason: 'invalid JSON' });
  }

  // Log full payload so we can see exactly what TikTok sends
  logger.info('TikTok webhook received', { payload: JSON.stringify(body), headers: req.headers });

  // Extract business_id — TikTok may use different field names
  const businessId =
    body?.business_id ||
    body?.data?.business_id ||
    body?.sender?.business_id ||
    body?.app_id ||          // some TikTok events use app_id
    body?.data?.app_id ||
    null;

  // No business_id — could be a test ping, return 200 so TikTok doesn't reject the webhook
  if (!businessId) {
    logger.warn('Missing business_id — returning 200 to accept webhook', { body });
    return res.status(200).json({ status: 'received', note: 'no business_id found' });
  }

  const account = getAccountByTikTokBusinessId(businessId);
  if (!account) {
    logger.warn(`No account configured for business_id: ${businessId}`);
    // Return 200 so TikTok doesn't keep retrying — just log it
    return res.status(200).json({ status: 'received', note: `no account for ${businessId}` });
  }

  // Verify HMAC signature if app secret is configured
  const isPlaceholder = !account.tiktokAppSecret || account.tiktokAppSecret.startsWith('TIKTOK_APP_SECRET');
  if (!isPlaceholder) {
    const valid = verifySignature(rawBody, signature, account.tiktokAppSecret);
    if (!valid) {
      logger.warn('Invalid TikTok signature', { account: businessId });
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const eventType = body?.event_type || body?.type || body?.data?.type || '';
  const hasMessage = body?.message || body?.data?.message;

  // Return 200 for non-message events (test pings, status events, etc.)
  if (eventType !== 'MESSAGE' && eventType !== 'message' && !hasMessage) {
    logger.info('Ignored non-message event', { account: businessId, eventType });
    return res.status(200).json({ status: 'ignored', eventType });
  }

  const event = parseMessageEvent(body);

  if (!event.text) {
    logger.info('Ignored message with no text content', { account: businessId });
    return res.status(200).json({ status: 'ignored', reason: 'no text content' });
  }

  logger.info('Forwarding TikTok message to Genesys', {
    account: businessId,
    messageId: event.messageId,
    senderId: event.senderId,
  });

  try {
    const result = await sendInboundMessage(account.genesys, event);
    const genesysConversationId = result?.id || result?.conversation?.id;

    if (genesysConversationId && event.conversationId) {
      conversationStore.set(genesysConversationId, {
        tiktokConversationId: event.conversationId,
        tiktokBusinessId: businessId,
        senderId: event.senderId,
      });
    }

    logger.info('Message forwarded to Genesys successfully', {
      account: businessId,
      genesysId: genesysConversationId,
    });

    return res.status(200).json({ status: 'ok', genesysId: genesysConversationId });
  } catch (err) {
    const detail = err.response?.data || err.message;
    logger.error('Failed to forward message to Genesys', {
      account: businessId,
      detail,
      stack: err.stack,
    });
    return res.status(502).json({ error: 'Failed to forward message to Genesys', detail });
  }
});

module.exports = router;
