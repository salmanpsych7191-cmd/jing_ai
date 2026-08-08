import { Request, Response, NextFunction } from 'express';
import { ENV } from '../config/env';

// Paths Twilio calls directly (webhooks, media streaming) can't do an interactive
// login, so they're exempt here and protected separately by Twilio request-signature
// validation instead.
const AUTH_EXEMPT_PREFIXES = ['/webhook/', '/health'];

export function dashboardAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (AUTH_EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) {
    next();
    return;
  }

  if (!(ENV.dashboardUsername && ENV.dashboardPassword)) {
    res.status(503).send(
      'Dashboard login is not configured. Set DASHBOARD_USERNAME and DASHBOARD_PASSWORD in .env before this server can be used.',
    );
    return;
  }

  const authHeader = req.headers.authorization ?? '';
  if (authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const idx = decoded.indexOf(':');
    const username = idx >= 0 ? decoded.slice(0, idx) : '';
    const password = idx >= 0 ? decoded.slice(idx + 1) : '';
    if (timingSafeEqualStr(username, ENV.dashboardUsername) && timingSafeEqualStr(password, ENV.dashboardPassword)) {
      next();
      return;
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="JING Dashboard"').status(401).send('Authentication required.');
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
