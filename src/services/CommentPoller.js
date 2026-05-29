/**
 * Comment Poller — Fallback for TikTok Comment Webhooks
 *
 * Instantiated once per account — NOT a singleton.
 * Periodically fetches new comments from recent videos for a specific
 * TikTok business account and forwards unseen ones to its Genesys integration.
 *
 * Runs on a cron schedule defined per account in accounts.json
 * (commentPollCron, default: every 2 minutes).
 */

const cron = require('node-cron');
const { tiktokCommentToGenesys } = require('../utils/transform');
const logger = require('../utils/logger');

class CommentPoller {
  /**
   * @param {object} opts
   * @param {import('./TikTokClient')} opts.tiktok   - TikTokClient for this account
   * @param {import('./GenesysClient')} opts.genesys - GenesysClient for this account
   * @param {string} opts.cron                       - Cron expression
   */
  constructor({ tiktok, genesys, cron: cronExpr }) {
    this.tiktok = tiktok;
    this.genesys = genesys;
    this.cronExpr = cronExpr || '*/2 * * * *';

    this._task = null;
    this._isRunning = false;

    // In-memory store of processed comment IDs (per account instance).
    // Replace with Redis for persistence across restarts.
    this._seenCommentIds = new Set();
    this._lastPollTime = Math.floor(Date.now() / 1000) - 120;
  }

  start() {
    if (!cron.validate(this.cronExpr)) {
      logger.error('Invalid cron expression for CommentPoller', {
        businessId: this.tiktok.businessId,
        cron: this.cronExpr,
      });
      return;
    }

    this._task = cron.schedule(this.cronExpr, async () => {
      if (this._isRunning) {
        logger.debug('Comment poll already running — skipping this tick', {
          businessId: this.tiktok.businessId,
        });
        return;
      }
      this._isRunning = true;
      try {
        await this._poll();
      } finally {
        this._isRunning = false;
      }
    });

    logger.info('Comment poller started', {
      businessId: this.tiktok.businessId,
      cron: this.cronExpr,
    });
  }

  stop() {
    if (this._task) {
      this._task.stop();
      logger.info('Comment poller stopped', { businessId: this.tiktok.businessId });
    }
  }

  async _poll() {
    const pollStartTime = Math.floor(Date.now() / 1000);

    try {
      const videos = await this.tiktok.listVideos({ count: 10 });
      if (!videos || videos.length === 0) {
        logger.debug('No videos found for comment polling', {
          businessId: this.tiktok.businessId,
        });
        return;
      }

      for (const video of videos) {
        await this._pollCommentsForVideo(video.id, this._lastPollTime);
      }

      this._lastPollTime = pollStartTime;
    } catch (err) {
      logger.error('Comment poll failed', {
        businessId: this.tiktok.businessId,
        error: err.message,
      });
    }
  }

  async _pollCommentsForVideo(videoId, since) {
    try {
      const result = await this.tiktok.listComments({ videoId, count: 50 });
      const comments = result?.data?.comments || [];

      for (const comment of comments) {
        const commentCreateTime = comment.create_time || 0;

        if (commentCreateTime < since) continue;
        if (this._seenCommentIds.has(comment.id)) continue;

        this._seenCommentIds.add(comment.id);
        // Keep set from growing unboundedly
        if (this._seenCommentIds.size > 10000) {
          const oldest = this._seenCommentIds.values().next().value;
          this._seenCommentIds.delete(oldest);
        }

        logger.info('New TikTok comment found via polling', {
          businessId: this.tiktok.businessId,
          videoId,
          commentId: comment.id,
          userId: comment.user_id,
        });

        // Build a synthetic payload matching the webhook shape
        const syntheticPayload = {
          event: 'comment_received',
          create_time: commentCreateTime,
          content: {
            comment_id: comment.id,
            video_id: videoId,
            user_id: comment.user_id,
            username: comment.username,
            comment: comment.text,
            text: comment.text,
            create_time: commentCreateTime,
          },
        };

        const genesysBody = tiktokCommentToGenesys(syntheticPayload, this.genesys.integrationId);
        await this.genesys.sendInboundMessage(genesysBody);
      }
    } catch (err) {
      logger.error('Failed to poll comments for video', {
        businessId: this.tiktok.businessId,
        videoId,
        error: err.message,
      });
    }
  }
}

module.exports = CommentPoller;
