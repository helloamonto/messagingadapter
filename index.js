require('dotenv').config();
const express = require('express');
const logger = require('./services/logger');
const webhookRouter = require('./routes/webhook');
const genesysRouter = require('./routes/genesys');

const app = express();
const PORT = process.env.PORT || 3000;

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(`${req.method} ${req.path}`, {
      status: res.statusCode,
      ms: Date.now() - start,
      ip: req.ip,
    });
  });
  next();
});

// Serve TikTok domain verification file
app.use(express.static('public'));

app.use('/webhook', webhookRouter);
app.use('/genesys', genesysRouter);

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  logger.info(`AmontoTTAdapter running on port ${PORT}`);
  logger.info(`Endpoints:`);
  logger.info(`  TikTok inbound  -> POST http://localhost:${PORT}/webhook`);
  logger.info(`  Genesys outbound -> POST http://localhost:${PORT}/genesys/outbound`);
  logger.info(`  Health check    -> GET  http://localhost:${PORT}/health`);
});
