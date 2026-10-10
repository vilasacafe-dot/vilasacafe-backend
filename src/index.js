import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { env, isProd } from './config/env.js';
import routes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

const app = express();

app.set('trust proxy', 1);
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────
// Must come BEFORE every other middleware so OPTIONS pre-flight requests
// get the correct headers. Vercel serverless doesn't persist keep-alive
// connections, so we also explicitly handle OPTIONS here.
const allowedOrigins = env.corsOrigins; // from CORS_ORIGINS env var

app.use(
  cors({
    origin(origin, cb) {
      // Allow server-to-server (no origin), and all configured origins.
      // In production CORS_ORIGINS must contain the exact frontend URL.
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS: origin ${origin} is not allowed`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    optionsSuccessStatus: 200, // some browsers choke on 204
  })
);

// Explicitly handle pre-flight for every route so Vercel's edge doesn't
// swallow it before Express sees it.
app.options('*', cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} is not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200,
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(isProd ? 'combined' : 'dev'));

// Global soft rate limit.
app.use(rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Vilasa Cafe API listening on http://localhost:${env.port}`);
});
