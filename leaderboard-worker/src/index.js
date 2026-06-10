const DEFAULT_PUBLIC_KEY = '69f664cb8f40bb1068bd441a';
const DREAMLO_BASE_URL = 'http://dreamlo.com/lb';
const MAX_NAME_LENGTH = 24;
const MAX_SCORE = 999999999;

const jsonHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const jsonResponse = (payload, status = 200, extraHeaders = {}) =>
  Response.json(payload, {
    status,
    headers: {
      ...jsonHeaders,
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });

const sanitizeName = (value) =>
  String(value || '')
    .replace(/[^\w -]/g, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);

const parseScore = (value) => {
  const score = Number(value);
  if (!Number.isFinite(score)) return null;
  return Math.max(0, Math.min(MAX_SCORE, Math.floor(score)));
};

const dreamloUrl = (key, path) => `${DREAMLO_BASE_URL}/${key}${path}?_=${Date.now()}`;

const fetchDreamloJson = async (url) => {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Dreamlo returned HTTP ${response.status}: ${text.slice(0, 120)}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Dreamlo returned invalid JSON: ${text.slice(0, 120)}`);
  }
};

const addDreamloScore = async (url) => {
  const response = await fetch(url);
  const text = await response.text();

  if (!response.ok || /^ERROR/i.test(text)) {
    throw new Error(`Dreamlo score submit failed: ${text.slice(0, 120)}`);
  }

  return text;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const publicKey = env.DREAMLO_PUBLIC_KEY || DEFAULT_PUBLIC_KEY;
    const privateKey = env.DREAMLO_PRIVATE_KEY;
    const pathname = url.pathname.replace(/\/$/, '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: jsonHeaders });
    }

    try {
      if (request.method === 'GET' && (pathname === '/api/leaderboard' || pathname === '')) {
        const data = await fetchDreamloJson(dreamloUrl(publicKey, '/json'));
        return jsonResponse(data);
      }

      if (request.method === 'POST' && (pathname === '/api/leaderboard/score' || pathname === '/score')) {
        if (!privateKey) {
          return jsonResponse({ error: 'Leaderboard submit is not configured.' }, 503);
        }

        const payload = await request.json().catch(() => null);
        const name = sanitizeName(payload?.name);
        const score = parseScore(payload?.score);

        if (!name || !score) {
          return jsonResponse({ error: 'A valid player name and score are required.' }, 400);
        }

        await addDreamloScore(dreamloUrl(privateKey, `/add/${encodeURIComponent(name)}/${score}`));
        return jsonResponse({ ok: true });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error(JSON.stringify({ message: error.message, path: pathname }));
      return jsonResponse({ error: 'Leaderboard service is temporarily unavailable.' }, 502);
    }
  },
};
