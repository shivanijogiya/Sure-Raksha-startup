// Suraksha — services/gemini.js
// Single place that talks to Google Gemini.
// Auth: GEMINI_API_KEY (AI Studio) or GOOGLE_GENAI_USE_VERTEXAI=true (Cloud Run service account).
// If the main model is overloaded (503/429), we automatically try fallback models.
const { GoogleGenAI } = require('@google/genai');

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.5-flash-lite')
  .split(',').map((s) => s.trim()).filter(Boolean);

let client = null;

function isConfigured() {
  return process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' || Boolean(process.env.GEMINI_API_KEY);
}

function getClient() {
  if (client) return client;
  if (!isConfigured()) {
    const e = new Error('Gemini is not configured (set GEMINI_API_KEY or GOOGLE_GENAI_USE_VERTEXAI=true)');
    e.status = 503;
    throw e;
  }
  client =
    process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true'
      ? new GoogleGenAI({
          vertexai: true,
          project:  process.env.GOOGLE_CLOUD_PROJECT,
          location: process.env.GOOGLE_CLOUD_LOCATION || 'asia-south1',
        })
      : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(Object.assign(new Error('Gemini request timed out'), { status: 504 })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function isRetryable(err) {
  const msg = String(err.message || '');
  return err.status === 504 || /"code":\s*(429|500|503)|UNAVAILABLE|RESOURCE_EXHAUSTED/.test(msg);
}

// Try the main model, then each fallback, only for overload/timeout errors.
async function generate(params, timeoutMs) {
  const models = [MODEL, ...FALLBACK_MODELS.filter((m) => m !== MODEL)];
  let lastErr;
  for (const model of models) {
    try {
      return await withTimeout(getClient().models.generateContent({ ...params, model }), timeoutMs);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) throw err;
      console.warn(`[GEMINI] ${model} unavailable, trying next model`);
    }
  }
  throw lastErr;
}

async function chat(messages, opts = {}) {
  const contents = messages.map((m) => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const res = await generate(
    {
      contents,
      config: {
        systemInstruction: opts.systemInstruction,
        maxOutputTokens:   opts.maxOutputTokens ?? 800,
        temperature:       opts.temperature ?? 0.4,
        topP:              0.9,
      },
    },
    opts.timeoutMs ?? 20000
  );
  return (res.text || '').trim();
}

async function generateJson({ prompt, schema, systemInstruction, timeoutMs = 10000, temperature = 0.1 }) {
  const res = await generate(
    {
      contents: prompt,
      config: {
        systemInstruction,
        temperature,
        responseMimeType: 'application/json',
        responseSchema:   schema,
      },
    },
    timeoutMs
  );
  return JSON.parse(res.text);
}

module.exports = { chat, generateJson, isConfigured, MODEL };