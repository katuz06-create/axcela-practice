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
    const instructions = `You design excellent practical spoken workplace English practice for Vietnamese working adults. Return ONLY strict JSON with object {"parts":[part1,part2,part3,part4,part5]}. Each part exactly 5 question objects. IMPORTANT: Every audio property is the ACTUAL natural English sentence(s) to be SPOKEN ALOUD (plain spoken script), NEVER an audio filename, path, URL, file extension, placeholder, markup, instructions, or the words "audio mp3". Do not create or refer to audio files. ALL scenarios are directly related to the user's JOB FUNCTION and DAILY SPOKEN COMMUNICATION context. Mix the user's selected grammar points naturally across the exercises. Keep language at CEFR level. Never invent company-specific factual claims; website hostname is a weak contextual clue, not researched evidence.\nPart1 grammar comprehension: each object {"q":string,"a":[4 unique short options],"ok":integer 0..3,"why":string}. Five meaningful grammar applications, diverse sentence forms and grammar points. Exactly one unambiguous correct answer.\nPart2 listening comprehension: each object {"audio":string,"q":string,"a":[4 options],"ok":integer 0..3,"why":string}. Short clear spoken workplace message or exchange, question about details/meaning, one valid answer. Do NOT reveal audio answer in q.\nPart3 vocabulary in context: same shape as part1; test transferable workplace phrases/collocations used for speaking rather than obscure technical jargon.\nPart4 listen & speak: each object {"audio":string,"q":"Listen and repeat this sentence."}; each audio is a natural 7-17 word spoken sentence relevant to role and grammar.\nPart5 guided conversation: each object {"audio":string,"q":"Choose a professional response and read it aloud.","a":[4 practical spoken replies],"ok":integer 0..3,"why":string}; audio is a workplace conversational prompt. Only one reply clearly best. Avoid trivially offensive alternatives; make distractors plausible but less suitable.\nUse professional natural English, no emojis; vary the placement of correct answers. Return no additional fields.`;
    const validAudio = value => {
      if (typeof value !== 'string') return false;
      const t = value.trim();
      if (t.length < 20 || t.length > 1000 || t.split(/\s+/).length < 5) return false;
      if (/(?:^|[\s/\\])(?:audio|recording|file|sound)[-_\s]*\d*\.(?:mp3|wav|m4a|ogg|webm)\b/i.test(t)) return false;
      if (/\b(?:https?:\/\/|www\.)/i.test(t) || /\.(?:mp3|wav|m4a|ogg|webm)(?:\?|$)/i.test(t)) return false;
      if (/^(?:audio|mp3|audio mp3|play audio|listen|placeholder|sample audio)$/i.test(t)) return false;
      return true;
    };
    const validParts = parts => Array.isArray(parts) && parts.length === 5 && parts.every((part, i) =>
      Array.isArray(part) && part.length === 5 && part.every(x => x && typeof x.q === 'string' && x.q.trim().length > 5 &&
        (i !== 1 && i < 3 || validAudio(x.audio)) &&
        (i > 2 && i !== 4 || (Array.isArray(x.a) && x.a.length === 4 && x.a.every(v => typeof v === 'string' && v.trim().length > 0) && Number.isInteger(x.ok) && x.ok >= 0 && x.ok <= 3))
      ));
    let parsed, lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const extra = attempt ? '\nPrevious generation had invalid audio text. Regenerate ALL five parts. Every audio must be full spoken English, never a filename such as audio.mp3.' : '';
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.35,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: instructions + extra }, { role: 'user', content: JSON.stringify(profile) }] })
      });
      const api = await r.json().catch(() => ({}));
      if (!r.ok) return Response.json({ error: api.error?.message || 'OpenAI generation unavailable' }, { status: 502 });
      try { parsed = JSON.parse(api.choices?.[0]?.message?.content || '{}'); }
      catch { lastError = 'AI returned invalid JSON'; continue; }
      if (validParts(parsed.parts)) break;
      parsed = null;
      lastError = 'AI returned invalid audio scripts or incomplete exercises';
    }
    if (!parsed) return Response.json({error: lastError + '. Please generate again.'}, {status: 502});
    return Response.json({ parts: parsed.parts }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return Response.json({ error: e.message || 'Generation failed' }, { status: 500 }); }
};
