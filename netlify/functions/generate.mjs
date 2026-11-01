// Axcela Practice Engine V0.3 – AI personalization. Never expose OPENAI_API_KEY to browsers.
export default async (request) => {
  if (request.method !== 'POST') return Response.json({ error: 'POST required' }, { status: 405 });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: 'OPENAI_API_KEY is not configured in this Practice Engine Netlify project.' }, { status: 503 });
  try {
    const p = await request.json();
    if (!p || typeof p.job !== 'string' || typeof p.context !== 'string' || !Array.isArray(p.points) || p.points.length < 1 || p.points.length > 5)
      return Response.json({ error: 'Job, context, and 1–5 learning points are required.' }, { status: 400 });
    const clean = (s, n) => String(s || '').trim().slice(0, n);
    const profile = { job: clean(p.job, 160), context: clean(p.context, 650), level: clean(p.level, 3), points: p.points.map(v => clean(v, 80)), website: clean(p.website, 240) };
    if (!['A1','A2','B1','B2','C1'].includes(profile.level)) return Response.json({ error: 'Invalid CEFR level' }, { status: 400 });
    if (profile.website) {
      let url; try { url = new URL(profile.website); } catch { return Response.json({ error: 'Invalid website URL' }, { status: 400 }); }
      if (!['http:', 'https:'].includes(url.protocol)) return Response.json({ error: 'Invalid website URL' }, { status: 400 });
      profile.website = url.hostname; // domain hint only; no untrusted website fetch / SSRF.
    }
    const instructions = `You design excellent practical spoken workplace English practice for Vietnamese working adults. Return ONLY strict JSON with object {"parts":[part1,part2,part3,part4,part5]}. Each part exactly 5 question objects. ALL scenarios are directly related to the user's JOB FUNCTION and DAILY SPOKEN COMMUNICATION context. Mix the user's selected grammar points naturally across the exercises. Keep language at CEFR level. Never invent company-specific factual claims; website hostname is a weak contextual clue, not researched evidence.\nPart1 grammar comprehension: each object {"q":string,"a":[4 unique short options],"ok":integer 0..3,"why":string}. Five meaningful grammar applications, diverse sentence forms and grammar points. Exactly one unambiguous correct answer.\nPart2 listening comprehension: each object {"audio":string,"q":string,"a":[4 options],"ok":integer 0..3,"why":string}. Short clear spoken workplace message or exchange, question about details/meaning, one valid answer. Do NOT reveal audio answer in q.\nPart3 vocabulary in context: same shape as part1; test transferable workplace phrases/collocations used for speaking rather than obscure technical jargon.\nPart4 listen & speak: each object {"audio":string,"q":"Listen and repeat this sentence."}; each audio is a natural 7-17 word spoken sentence relevant to role and grammar.\nPart5 guided conversation: each object {"audio":string,"q":"Choose a professional response and read it aloud.","a":[4 practical spoken replies],"ok":integer 0..3,"why":string}; audio is a workplace conversational prompt. Only one reply clearly best. Avoid trivially offensive alternatives; make distractors plausible but less suitable.\nUse professional natural English, no emojis; vary the placement of correct answers. Return no additional fields.`;
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.45, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: instructions }, { role: 'user', content: JSON.stringify(profile) }] }) });
    const api = await r.json().catch(() => ({}));
    if (!r.ok) return Response.json({ error: api.error?.message || 'OpenAI generation unavailable' }, { status: 502 });
    let parsed; try { parsed = JSON.parse(api.choices?.[0]?.message?.content || '{}'); } catch { throw Error('Invalid AI JSON output'); }
    if (!Array.isArray(parsed.parts) || parsed.parts.length !== 5 || parsed.parts.some((part, i) => !Array.isArray(part) || part.length !== 5 || part.some(x => !x || typeof x.q !== 'string' || (i === 1 || i >= 3) && typeof x.audio !== 'string' || (i <= 2 || i === 4) && (!Array.isArray(x.a) || x.a.length !== 4 || x.a.some(v => typeof v !== 'string') || !Number.isInteger(x.ok) || x.ok < 0 || x.ok > 3)))) throw Error('Incomplete AI practice set');
    return Response.json({ parts: parsed.parts }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return Response.json({ error: e.message || 'Generation failed' }, { status: 500 }); }
};
