import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import WebSocket, { WebSocketServer } from 'ws';
import { ENV } from '../config/env';
import { initDb } from '../db/schema';
import { initSchedulerTable, startScheduler } from '../scheduler';
import { registerAllJobHandlers } from '../scheduler/handlers';
import { startColdCallDialer } from '../scheduler/coldCallDialer';
import { presynthesizeGreeting } from '../voice/tts';
import { dashboardAuthMiddleware } from './authMiddleware';
import { verifyTwilioMiddleware } from './verifyTwilio';
import { webhookVoice, webhookVoiceOutbound } from '../telephony/voiceWebhooks';
import { CallSession } from '../voice/orchestrator/callSession';
import { voiceDiagnostics } from '../voice/diagnostics';
import { placeColdCall } from '../telephony/twilio';
import { registerApiRoutes } from './apiRoutes';

async function main(): Promise<void> {
  await initDb();
  await initSchedulerTable();
  registerAllJobHandlers();
  startScheduler();
  startColdCallDialer();
  await presynthesizeGreeting();

  const app = express();
  // Express has no built-in access log (unlike uvicorn, which the Python app relied on
  // for every "call now" debugging session this project). Without this, HTTP traffic
  // is completely invisible in Render's logs - added after a real debugging session
  // where a 35s connected call left zero log trace, making it impossible to tell
  // whether the webhook was even hit.
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.originalUrl}`);
    next();
  });
  app.use(dashboardAuthMiddleware);
  app.use(express.urlencoded({ extended: false }));
  // Bumped from Express's 100kb default - a 100-row cold-call CSV upload is small,
  // but larger lead lists shouldn't get silently rejected.
  app.use(express.json({ limit: '5mb' }));

  const publicDir = path.join(__dirname, '../../public');
  app.use('/assets', express.static(publicDir, {
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    },
  }));

  app.get('/', (_req, res) => {
    let html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf-8');
    const cacheBust = Date.now();
    html = html
      .replace('/assets/styles.css"', `/assets/styles.css?v=${cacheBust}"`)
      .replace('/assets/dashboard.js"', `/assets/dashboard.js?v=${cacheBust}"`);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate').type('html').send(html);
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, restaurant: ENV.restaurantName });
  });

  app.post('/webhook/voice', verifyTwilioMiddleware, webhookVoice);
  app.post('/webhook/voice-outbound', verifyTwilioMiddleware, webhookVoiceOutbound);

  app.get('/api/diagnostics/voice', async (_req, res) => {
    res.json(await voiceDiagnostics());
  });

  app.post('/api/voice/call-out', async (req, res) => {
    const diagnostics = await voiceDiagnostics();
    if (!diagnostics.ready_for_calls) {
      res.status(400).json({
        detail: `Voice agent isn't fully configured yet. Missing: ${diagnostics.missing.join(', ') || 'Twilio/Deepgram credentials'}.`,
      });
      return;
    }
    const { phone, company_name: companyName, contact_name: contactName = null } = req.body;
    if (!companyName) {
      res.status(400).json({ detail: 'company_name is required for an outbound cold call.' });
      return;
    }
    try {
      const callSid = await placeColdCall(phone, companyName, contactName);
      res.json({ status: 'calling', call_sid: callSid, phone });
    } catch (err: any) {
      res.status(400).json({ detail: err?.message ?? 'Could not place the call.' });
    }
  });

  registerApiRoutes(app);

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/media-stream' });

  wss.on('connection', (ws: WebSocket) => {
    console.log('[WS] Twilio Media Stream connected');
    let session: CallSession | null = null;

    ws.on('message', (raw: WebSocket.RawData) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      try {
        switch (message.event) {
          case 'start': {
            const start = message.start as Record<string, any>;
            const callSid = start.callSid as string;
            const streamSid = start.streamSid as string;
            const params = (start.customParameters ?? {}) as Record<string, string>;
            const phone = params.phone ?? 'unknown';
            const outbound = params.outbound === 'true';
            const purpose = params.purpose ?? null;
            const greeting = params.greeting ?? '';
            const coldCall = outbound && params.callType === 'cold_call'
              ? { companyName: params.companyName ?? '', contactName: params.contactName ?? null }
              : null;
            console.log(`[WS] Call started: ${callSid} phone=${phone} outbound=${outbound} callType=${params.callType ?? 'n/a'}`);

            session = new CallSession(callSid, ws, phone, outbound, purpose, greeting, coldCall);
            session.setStreamSid(streamSid);
            setTimeout(() => session?.sendGreeting(), 50);
            break;
          }
          case 'media': {
            const media = message.media as Record<string, string>;
            session?.handleAudioChunk(media.payload);
            break;
          }
          case 'mark': {
            const mark = message.mark as Record<string, string>;
            session?.handleMarkEvent(mark.name);
            break;
          }
          case 'stop': {
            console.log('[WS] Call stopped');
            session?.end();
            session = null;
            break;
          }
        }
      } catch (err) {
        // A synchronous throw here would otherwise be an uncaught exception on the
        // process (this handler isn't inside Express's request/error-handling chain).
        console.error('[WS] Error handling message:', err);
      }
    });

    ws.on('close', () => {
      console.log('[WS] Connection closed');
      session?.end();
    });
    ws.on('error', (err: Error) => {
      console.error('[WS] WebSocket error:', err.message);
      session?.end();
    });
  });

  server.listen(ENV.port, () => {
    console.log(`[Server] JING Node agent listening on port ${ENV.port}`);
    console.log(`[Server] Public URL: ${ENV.publicBaseUrl}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
