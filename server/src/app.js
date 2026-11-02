import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/authRoutes.js';
import mailboxRoutes from './routes/mailboxRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import sequenceRoutes from './routes/sequenceRoutes.js';
import campaignRoutes from './routes/campaignRoutes.js';
import replyRoutes from './routes/replyRoutes.js';
import unsubscribeRoutes from './routes/unsubscribeRoutes.js';
import suppressionRoutes from './routes/suppressionRoutes.js';
import complianceRoutes from './routes/complianceRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';

export function createApp() {
  const app = express();

  app.use(helmet({
    contentSecurityPolicy: false
  }));
  app.use(cors({
    origin: process.env.APP_BASE_URL || '*',
    credentials: true
  }));

  // Parse JSON and URL-encoded bodies (including RFC 8058 List-Unsubscribe=One-Click form posts)
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Rate limiting (Section 13)
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false
  });
  app.use(apiLimiter);

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Mount routes under both /api/* and /* so either convention works seamlessly
  const mountRoutes = (prefix = '') => {
    app.use(`${prefix}/auth`, authRoutes);
    app.use(`${prefix}/mailboxes`, mailboxRoutes);
    app.use(`${prefix}/contacts`, contactRoutes);
    app.use(`${prefix}/sequences`, sequenceRoutes);
    app.use(`${prefix}/campaigns`, campaignRoutes);
    app.use(`${prefix}/replies`, replyRoutes);
    app.use(`${prefix}/unsubscribe`, unsubscribeRoutes);
    app.use(`${prefix}/suppression`, suppressionRoutes);
    app.use(`${prefix}/compliance`, complianceRoutes);
    app.use(`${prefix}/webhooks`, webhookRoutes);
  };

  mountRoutes('/api');
  mountRoutes('');

  // Error handler
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    res.status(status).json({
      error: err.message || 'Internal Server Error'
    });
  });

  return app;
}
