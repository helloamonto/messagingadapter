/**
 * Message format transformers between TikTok and Genesys Cloud Open Messaging.
 *
 * Unlike the single-account version, integrationId is passed explicitly
 * as a parameter (not read from process.env) so each account can use
 * its own Genesys integration.
 *
 * TikTok inbound DM webhook payload shape:
 * {
 *   "client_key": "...",
 *   "event": "direct_message_received",
 *   "create_time": 1700000000,
 *   "content": {
 *     "message_id": "...",
 *     "conversation_id": "...",
 *     "from_user_id": "...",
 *     "to_user_id": "...",
 *     "message": { "type": "text", "content": "Hello" }
 *   }
 * }
 *
 * TikTok inbound Comment webhook payload shape:
 * {
 *   "client_key": "...",
 *   "event": "comment_received",
 *   "create_time": 1700000000,
 *   "content": {
 *     "comment_id": "...",
 *     "video_id": "...",
 *     "user_id": "...",
 *     "comment": "Nice video!",
 *     "create_time": 1700000000
 *   }
 * }
 */

/**
 * Transform a TikTok DM webhook event into a Genesys Open Messaging body.
 *
 * @param {object} payload        - Raw TikTok webhook payload
 * @param {string} integrationId  - Genesys Open Messaging integration ID for this account
 */
function tiktokDMToGenesys(payload, integrationId) {
  const { content } = payload;
  const msg = content.message || {};
  const text = msg.content || msg.text || '[unsupported message type]';

  return {
    channel: {
      id: content.conversation_id,
      platform: 'Open',
      type: 'Private',
      messageId: content.message_id,
      time: new Date(payload.create_time * 1000).toISOString(),
      to: { id: integrationId },
      from: {
        id: content.from_user_id,
        idType: 'Opaque',
        firstName: content.from_username || content.from_user_id,
      },
    },
    type: 'Text',
    text,
    originatingEntity: 'Human',
  };
}

/**
 * Transform a TikTok comment webhook event into a Genesys Open Messaging body.
 * Comments are treated as "Private" channel messages with video/comment metadata.
 *
 * @param {object} payload        - Raw TikTok webhook payload
 * @param {string} integrationId  - Genesys Open Messaging integration ID for this account
 */
function tiktokCommentToGenesys(payload, integrationId) {
  const { content } = payload;

  return {
    channel: {
      // Stable conversation thread ID per (video, user) pair
      id: `comment_${content.video_id}_${content.user_id}`,
      platform: 'Open',
      type: 'Private',
      messageId: content.comment_id,
      time: new Date((content.create_time || payload.create_time) * 1000).toISOString(),
      to: { id: integrationId },
      from: {
        id: content.user_id,
        idType: 'Opaque',
        firstName: content.username || content.user_id,
      },
    },
    type: 'Text',
    text: content.comment || content.text || '',
    originatingEntity: 'Human',
  };
}

/**
 * Parse a Genesys outbound webhook notification and extract what we need
 * to reply back to TikTok.
 *
 * @param {object} payload - Raw Genesys outbound webhook payload
 */
function genesysOutboundToTikTok(payload) {
  const channel = payload.channel || {};
  const customAttrs = (payload.metadata && payload.metadata.customAttributes) || {};

  return {
    source: customAttrs.source || 'tiktok_dm',
    recipientUserId: channel.to && channel.to.id,
    conversationId: customAttrs.tiktokConversationId || channel.id,
    videoId: customAttrs.tiktokVideoId,
    commentId: customAttrs.tiktokCommentId,
    text: payload.text || '',
  };
}

module.exports = {
  tiktokDMToGenesys,
  tiktokCommentToGenesys,
  genesysOutboundToTikTok,
};
