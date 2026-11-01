// V0.2 speech-to-text only. Word matching occurs in the client; it is not a pronunciation score.
export default async (request) => {
  if (request.method !== 'POST') return Response.json({ error: 'POST required' }, { status: 405 });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: 'Speech transcription not configured. Add OPENAI_API_KEY to this NEW Netlify project.' }, { status: 503 });
  try {
    const data = await request.formData();
    const audio = data.get('audio');
    if (!audio || typeof audio.arrayBuffer !== 'function') return Response.json({ error: 'Missing audio recording' }, { status: 400 });
    if (audio.size > 8 * 1024 * 1024) return Response.json({ error: 'Recording is too large (8 MB maximum).' }, { status: 413 });
    const payload = new FormData();
    payload.append('file', audio, audio.name || 'recording.webm');
    payload.append('model', 'gpt-4o-mini-transcribe');
    payload.append('language', 'en');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: payload });
    const result = await r.json().catch(() => ({}));
    if (!r.ok) return Response.json({ error: result.error?.message || 'Transcription service error' }, { status: 502 });
    return Response.json({ text: String(result.text || '') }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return Response.json({ error: 'Could not process audio recording.' }, { status: 500 }); }
};
export const config = { path: '/.netlify/functions/transcribe' };
