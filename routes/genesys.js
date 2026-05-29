const express = require('express');
const router = express.Router();
const { getAccountByIntegrationId } = require('../config/accounts');
const { sendMessage } = require('../services/tiktok');
const conversationStore = require('../services/conversationStore');
const logger = require('../services/logger');

/**
 * POST /genesys/outbound
 *
 * Receives outbound (agent) messages from Genesys Cloud Open Messaging
 * and forwards them to the correct TikTok conversation.
 *
 * Configure this URL in Genesys: Admin > Messaging > Open Messaging Integration
 * under "Outbound Notification Webhook URL".
 */
router.post('/outbound', express.json(), async (req, res) => {
  const body = req.body;

  // Acknowledge immediately — Genesys expects a fast 200 response
  res.status(200).json({ status: 'received' });

  const direction = body?.channel?.direction || body?.direction || '';
  const msgType = body?.type || '';

  // Only process outbound text messages from agents
  if (direction !== 'Outbound' || msgType !== 'Text') {
    logger.info('Ignored Genesys event', { direction, msgType });
    return;
  }

  const genesysConversationId = body?.channel?.messageId || body?.id;
  const integrationId = body?.channel?.from?.id;
  const text = body?.text;

  if (!text) {
    logger.info('Ignored Genesys outbound with no text', { genesysConversationId });
    return;
  }

  // Look up which TikTok conversation this maps to
  const tiktokContext = genesysConversationId
    ? conversationStore.get(genesysConversationId)
    : null;

  if (!tiktokContext) {
    logger.warn('No TikTok conversation found for Genesys message', {
      genesysConversationId,
      integrationId,
    });
    return;
  }

  // Look up account credentials
  const account = getAccountByIntegrationId(integrationId);
  if (!account) {
    logger.warn('No account found for integrationId', { integrationId });
    return;
  }

  const isPlaceholder =
    !account.tiktokAccessToken || account.tiktokAccessToken.startsWith('TIKTOK_ACCESS_TOKEN');

  if (isPlaceholder) {
    logger.warn('TikTok access token not configured, cannot send reply', {
      account: tiktokContext.tiktokBusinessId,
    });
    return;
  }

  logger.info('Sending agent reply to TikTok', {
    account: tiktokContext.tiktokBusinessId,
    conversationId: tiktokContext.tiktokConversationId,
  });

  try {
    await sendMessage(
      account.tiktokAccessToken,
      tiktokContext.tiktokConversationId,
      text
    );

    logger.info('Agent reply sent to TikTok successfully', {
      account: tiktokContext.tiktokBusinessId,
    });
  } catch (err) {
    logger.error('Failed to send agent reply to TikTok', {
      account: tiktokContext.tiktokBusinessId,
      error: err.message,
      tiktokCode: err.tiktokCode,
      stack: err.stack,
    });
  }
});

module.exports = router;
