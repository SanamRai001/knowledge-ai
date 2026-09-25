import type express from 'express';
import type {
  RuntimeEdgeConfig,
} from './runtimeEdgeConfig.js';

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  "script-src 'self' https://apis.google.com https://accounts.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://accounts.google.com https://www.googleapis.com https://oauth2.googleapis.com",
  "frame-src 'self' https://accounts.google.com https://docs.google.com https://drive.google.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ');

export function securityHeadersMiddleware(
  config: RuntimeEdgeConfig
): express.RequestHandler {
  return (req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      CSP
    );
    res.setHeader(
      'X-Content-Type-Options',
      'nosniff'
    );
    res.setHeader(
      'X-Frame-Options',
      'DENY'
    );
    res.setHeader(
      'Referrer-Policy',
      'strict-origin-when-cross-origin'
    );
    res.setHeader(
      'Permissions-Policy',
      [
        'camera=()',
        'microphone=()',
        'geolocation=()',
        'payment=()',
        'usb=()',
      ].join(', ')
    );
    res.setHeader(
      'Cross-Origin-Opener-Policy',
      'same-origin-allow-popups'
    );

    if (
      config.hstsOwner === 'app' &&
      req.secure
    ) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains'
      );
    }

    next();
  };
}

export function requestSizeGuard(
  maxBytes: number
): express.RequestHandler {
  return (req, res, next) => {
    const raw =
      req.header('content-length');
    if (!raw) {
      next();
      return;
    }

    if (!/^\d+$/.test(raw)) {
      res.status(400).json({
        error:
          'Invalid Content-Length header.',
        code:
          'INVALID_CONTENT_LENGTH',
      });
      return;
    }

    const size = Number(raw);
    if (
      !Number.isSafeInteger(size) ||
      size < 0
    ) {
      res.status(400).json({
        error:
          'Invalid Content-Length header.',
        code:
          'INVALID_CONTENT_LENGTH',
      });
      return;
    }

    if (size > maxBytes) {
      res.status(413).json({
        error:
          'Request body exceeds the configured application edge limit.',
        code:
          'REQUEST_BODY_TOO_LARGE',
      });
      return;
    }

    next();
  };
}
