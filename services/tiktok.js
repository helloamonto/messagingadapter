const crypto = require('crypto');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;

const tiktokClient = axios.create({
  baseURL: 'https://business-api.tiktok.com/open_api/v1.3',
  timeout: 10000,
});

axiosRetry(tiktokClient, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (err) => axiosRetry.isNetworkOrIdempotentRequestError(err) || err.response?.status >= 500,
});

/**
 * Verifies the TikTok webhook HMAC-SHA256 signature.
 */
function verifySignature(rawBody, signature, appSecret) {
  if (!signature || !appSecret) return false;
  const hmac = crypto.createHmac('sha256', appSecret);
  hmac.update(rawBody);
  const expected = 'sha256=' + hmac.digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Normalizes a TikTok message event into a common internal format.
 */
function parseMessageEvent(body) {
  const message = body?.message || body?.data?.message || {};
  const sender = body?.sender || body?.data?.sender || {};
  const businessId = body?.business_id || body?.data?.business_id || '';

  return {
    businessId,
    messageId: message.message_id || message.id || '',
    conversationId: message.conversation_id || '',
    senderId: sender.id || sender.open_id || '',
    senderName: sender.display_name || sender.nickname || 'TikTok User',
    text: message.content?.text || message.text || '',
    timestamp: message.create_time
      ? new Date(message.create_time * 1000).toISOString()
      : new Date().toISOString(),
  };
}

/**
 * Sends a reply message from agent back to TikTok conversation.
 * https://business-api.tiktok.com/open_api/v1.3/customer_service/conversation/message/send/
 */
async function sendMessage(accessToken, conversationId, text) {
  const response = await tiktokClient.post(
    '/customer_service/conversation/message/send/',
    {
      conversation_id: conversationId,
      message: {
        message_type: 'TEXT',
        content: { text },
      },
    },
    {
      headers: {
        'Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    }
  );

  if (response.data?.code !== 0) {
    const err = new Error(`TikTok API error: ${response.data?.message}`);
    err.tiktokCode = response.data?.code;
    throw err;
  }

  return response.data;
}

module.exports = { verifySignature, parseMessageEvent, sendMessage };
