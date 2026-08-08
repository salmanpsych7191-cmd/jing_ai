import { v4 as uuidv4 } from 'uuid';
import { pool, query, nowIso } from '../db';
import { voiceClient } from './llm/voiceAgent';
import { ENV } from '../config/env';
import type { VoiceMessage } from './llm/voiceAgent';

export async function initCallAnalysisTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_analysis (
      id TEXT PRIMARY KEY,
      call_sid TEXT,
      phone TEXT NOT NULL,
      direction TEXT NOT NULL,
      extracted_json TEXT NOT NULL,
      transcript TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
}

// Post-call: ask the LLM to extract structured booking details from the transcript and
// store them for later review (e.g. a future daily digest). Best-effort - must never
// throw, since this runs after the call has already ended.
export async function analyzeCallTranscript(
  callSid: string | null,
  phone: string,
  outbound: boolean,
  history: VoiceMessage[],
): Promise<void> {
  if (history.length <= 1) return; // only the greeting was said - nothing to extract

  const transcriptText = history.map((m) => `${m.role}: ${m.content}`).join('\n');
  const extractionPrompt = `
Extract booking details from this restaurant phone call transcript. Respond with ONLY a JSON object,
no other text, using exactly this shape:
{"guest_name": string or null, "date": string or null, "time": string or null, "party_size": number or null,
"special_requests": string or null, "booking_confirmed": boolean, "summary": string}
Use null for anything not mentioned. "summary" is one short sentence describing the outcome of the call.

Transcript:
${transcriptText}
`.trim();

  let extracted: any;
  try {
    const completion = await voiceClient.chat.completions.create({
      model: ENV.voiceLlmModel,
      messages: [{ role: 'user', content: extractionPrompt }],
      temperature: 0.1,
      max_tokens: 200,
    });
    let raw = (completion.choices[0].message.content ?? '').trim();
    raw = raw.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim();
    extracted = JSON.parse(raw);
  } catch (err) {
    console.warn(`Post-call analysis failed for ${phone}:`, err);
    return;
  }

  try {
    await query(
      `INSERT INTO call_analysis (id, call_sid, phone, direction, extracted_json, transcript, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uuidv4(), callSid, phone, outbound ? 'outbound' : 'inbound', JSON.stringify(extracted), transcriptText, nowIso()],
    );
    console.log(`Post-call analysis stored for ${phone}: ${extracted.summary}`);
  } catch (err) {
    console.warn(`Could not store post-call analysis for ${phone}:`, err);
  }
}
