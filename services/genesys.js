const axios = require('axios');
const axiosRetry = require('axios-retry').default;

const genesysClient = axios.create({ timeout: 10000 });

axiosRetry(genesysClient, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (err) =>
    axiosRetry.isNetworkOrIdempotentRequestError(err) ||
    (err.response?.status >= 500 && err.response?.status !== 501),
});

// In-memory token cache per clientId
const tokenCache = {};

async function getAccessToken(region, clientId, clientSecret) {
  const cached = tokenCache[clientId];
  if (cached && cached.expiresAt > Date.now() + 5000) {
    return cached.token;
  }

  const response = await genesysClient.post(
    `https://login.${region}/oauth/token`,
    'grant_type=client_credentials',
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      auth: { username: clientId, password: clientSecret },
    }
  );

  const { access_token, expires_in } = response.data;
  tokenCache[clientId] = {
    token: access_token,
    expiresAt: Date.now() + expires_in * 1000,
  };

  return access_token;
}

/**
 * Sends an inbound (customer) message to Genesys Cloud Open Messaging.
 */
async function sendInboundMessage(genesysConfig, event) {
  const { region, clientId, clientSecret, integrationId } = genesysConfig;
  const token = await getAccessToken(region, clientId, clientSecret);

  const payload = {
    channel: {
      platform: 'Open',
      type: 'Private',
      messageId: event.messageId,
      to: { id: integrationId },
      from: {
        idType: 'Opaque',
        id: event.senderId,
        firstName: event.senderName,
      },
      time: event.timestamp,
    },
    type: 'Text',
    text: event.text,
    originatingEntity: 'Human',
  };

  const response = await genesysClient.post(
    `https://api.${region}/api/v2/conversations/messages/inbound/open`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}

module.exports = { sendInboundMessage };
