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
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const businessId = body?.business_id || body?.data?.business_id;
  if (!businessId) {
    logger.warn('Missing business_id in TikTok webhook body');
    return res.status(400).json({ error: 'Missing business_id in request body' });
  }

  const account = getAccountByTikTokBusinessId(businessId);
  if (!account) {
    logger.warn(`No account configured for business_id: ${businessId}`);
    return res.status(404).json({ error: `No account configured for business_id: ${businessId}` });
  }

  // Verify HMAC signature if app secret is a real value
  const isPlaceholder = !account.tiktokAppSecret || account.tiktokAppSecret.startsWith('TIKTOK_APP_SECRET');
  if (!isPlaceholder) {
    const valid = verifySignature(rawBody, signature, account.tiktokAppSecret);
    if (!valid) {
      logger.warn('Invalid TikTok signature', { account: businessId });
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const eventType = body?.event_type || body?.type || '';
  const hasMessage = body?.message || body?.data?.message;

  if (eventType !== 'MESSAGE' && eventType !== 'message' && !hasMessage) {
    logger.info(`Ignored non-message event`, { account: businessId, eventType });
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

    // Store mapping so agent replies can be routed back to TikTok
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
    const status = err.response?.status || 500;
    const detail = err.response?.data || err.message;
    logger.error('Failed to forward message to Genesys', {
      account: businessId,
      status,
      detail,
      stack: err.stack,
    });
    return res.status(502).json({ error: 'Failed to forward message to Genesys', detail });
  }
});

module.exports = router;
