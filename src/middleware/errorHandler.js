import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';
import { isProd } from '../config/env.js';

/* eslint-disable no-unused-vars */
export function notFoundHandler(req, res, _next) {
  res.status(404).json({ error: { message: 'Route not found.' } });
}

export function errorHandler(err, _req, res, _next) {
  // Zod validation errors -> 400 with field messages
  if (err instanceof ZodError) {
    const message = err.errors.map((e) => e.message).join(' ');
    return res.status(400).json({ error: { message: message || 'Invalid request data.' } });
  }

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: { message: err.message, code: err.code },
    });
  }

  // Postgres/RPC errors surfaced with a MESSAGE from RAISE EXCEPTION.
  if (err && err.code && err.message && typeof err.message === 'string') {
    // Map known application-level RAISE codes if present in the hint/message.
    const known = [
      'RESTAURANT_CLOSED', 'PRODUCT_UNAVAILABLE', 'PRODUCT_NOT_FOUND',
      'COUPON_INVALID', 'PROFILE_INCOMPLETE', 'PROFILE_MISSING',
      'EMPTY_CART', 'INVALID_QUANTITY', 'RESTAURANT_NOT_FOUND',
    ];
    if (known.includes(err.code)) {
      return res.status(400).json({ error: { message: err.message, code: err.code } });
    }
  }

  // Unknown / unexpected error — do not leak internals in production.
  if (!isProd) {
    // eslint-disable-next-line no-console
    console.error('Unhandled error:', err);
  }
  return res.status(500).json({
    error: { message: 'Something went wrong. Please try again.' },
  });
}
