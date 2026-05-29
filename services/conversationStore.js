/**
 * In-memory store mapping Genesys conversation IDs to TikTok conversation context.
 * For production, replace with Redis or a database.
 *
 * Schema:
 *   genesysConversationId -> { tiktokConversationId, tiktokBusinessId, senderId, createdAt }
 */
const store = new Map();

// Expire entries after 24 hours to prevent unbounded growth
const TTL_MS = 24 * 60 * 60 * 1000;

function set(genesysConversationId, tiktokContext) {
  store.set(genesysConversationId, { ...tiktokContext, createdAt: Date.now() });
}

function get(genesysConversationId) {
  const entry = store.get(genesysConversationId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(genesysConversationId);
    return null;
  }
  return entry;
}

function remove(genesysConversationId) {
  store.delete(genesysConversationId);
}

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of store.entries()) {
    if (now - value.createdAt > TTL_MS) store.delete(key);
  }
}, 60 * 60 * 1000);

module.exports = { set, get, remove };
