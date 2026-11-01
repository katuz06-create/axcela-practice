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
    const instructions = `You are an expert EFL assessment author for Vietnamese working adults. Create a high-quality practical workplace-English exercise set matched to the learner profile. Return strict JSON object {"parts":[[five questions],[five questions],[five questions],[five questions],[five questions]]} and no other keys.
MANDATORY FOR EVERY ITEM: explicit task instruction in "q", tailored to what the learner must do; no bare example sentence presented as an unexplained question. Never ask the learner to select a sentence equivalent to the fully written correct sentence already in the prompt. No placeholder questions. Appropriate CEFR. Use grammar points the learner actually selected. All questions contextualize workplace SPEAKING not writing. Domain is a hint, not researched company facts.
FOR MULTIPLE CHOICE: exactly four distinctive options, exactly ONE unambiguously correct based on the wording and provided context. Distractors must be definitely incorrect in grammar OR context for the particular stated task, not alternative grammatical sentences, synonym choices, equally polite responses, or contested usage. The "why" explains why exactly the correct answer works and why the tempting alternative does not. Never assume only one correct answer if two are grammatical. Prefer one clear fill-the-gap with grammar cue, transformation from DIRECT to REPORTED speech with clear source, or choice based on exact workplace evidence; specify grammar point in "learning_point".
Part1 grammar each {"q":explicit instruction with source sentence/context AND question, "a":[4 strings], "ok":integer 0..3, "why":specific explanation, "learning_point":one learner-selected point}. Varied task types. When testing relative clauses avoid two correct alternatives such as "that" and "which" in defining clauses. Avoid prompting "which sentence is correct" when multiple natural possibilities exist.
Part2 listening each {"audio":actual spoken English message/dialogue with all facts necessary (minimum 8 words),"q":clear comprehension question about an explicitly spoken detail, "a":[4 options],"ok":integer,"why":explain citing only the audio information,"learning_point":one learner-selected point}. Do NOT place the answer or a transcript in the displayed question. NEVER filename, URL, .mp3, stage directions or placeholder in audio. Text must be usable as text-to-speech speech.
Part3 vocabulary each {"q":explicit workplace context and task testing meaning/functional phrase/collocation,"a":[4 options],"ok":integer,"why":why the phrase fits and others do not,"learning_point":one learner-selected point}. Test transferable workplace expressions, no irrelevant choices.
Part4 listen and repeat each {"audio":natural 7-17 word workplace sentence, "q":"Listen to the sentence, then record yourself repeating exactly what you hear.", "learning_point":one learner-selected point}. Not a written task; no answer choices.
Part5 guided conversation each {"audio":a COMPLETE natural spoken request from a workplace colleague/client,"q":"Listen to the situation. Choose the most appropriate reply for the stated goal, then read your chosen reply aloud.","a":[4 replies],"ok":integer,"why":a brief specific rationale,"learning_point":one learner-selected point}. The 3 distractors should be plausible but decisively fail the exact communication goal. No two replies can fulfill goal equally well. Audio is real words, not instructions or filenames.
Do not output anything in addition to this schema. Ensure all instructions are clear to someone who has NOT seen the answer key.`;
    const validAudio = value => {
      if (typeof value !== 'string') return false;
      const t = value.trim();
      if (t.length < 20 || t.length > 1000 || t.split(/\s+/).length < 5) return false;
      if (/(?:^|[\s/\\])(?:audio|recording|file|sound)[-_\s]*\d*\.(?:mp3|wav|m4a|ogg|webm)\b/i.test(t)) return false;
      if (/\b(?:https?:\/\/|www\.)/i.test(t) || /\.(?:mp3|wav|m4a|ogg|webm)(?:\?|$)/i.test(t)) return false;
      if (/^(?:audio|mp3|audio mp3|play audio|listen|placeholder|sample audio)$/i.test(t)) return false;
      return true;
    };
    const norm = t => String(t).trim().toLowerCase().replace(/[^a-z0-9]+/g,' ');
    const isGoodInstruction = t => typeof t === 'string' && t.trim().length >= 24 && /(?:\?|choose|select|complete|which|what|why|how|listen|repeat|record|read|fill|transform|combine|respond|reply|meaning|correct)/i.test(t);
    const validParts = parts => Array.isArray(parts) && parts.length === 5 && parts.every((part, i) =>
      Array.isArray(part) && part.length === 5 && part.every(x => x && isGoodInstruction(x.q) &&
        typeof x.learning_point === 'string' && profile.points.some(p=>norm(p)===norm(x.learning_point)) &&
        (i===0 || i===2 || typeof x.audio==='string' && validAudio(x.audio)) &&
        (i===3 ? !x.a : Array.isArray(x.a) && x.a.length===4 && x.a.every(v=>typeof v==='string' && v.trim().length>=3) && new Set(x.a.map(norm)).size===4 && Number.isInteger(x.ok) && x.ok>=0 && x.ok<4 && typeof x.why==='string' && x.why.trim().length>=18)
      ));
    const review = async parts => {
      const prompt = `Act as an adversarial English assessment reviewer. Audit ALL 25 items in five parts. Check every MCQ has one and only one correct answer; other options MUST be wrong according to precisely stated task, not merely less preferred. Grammar: reject ambiguous or missing directions, answers already leaked in prompt, two correct grammatical constructions (especially relative clauses or verb tenses), invalid grammar. Listening: reject if answers are unsupported by literal audio or filenames. Vocabulary: reject synonyms that both work. Speaking: clear instruction and realistic repeatable audio. Conversation: reject multiple equally professional responses. Reject if role/CEFR/learning points are inconsistent. Return strict JSON {"pass":boolean,"issues":[{"part":1,"item":1,"reason":"..."}]} (up to 12 most severe). Conservative: if uncertain FAIL.`;
      const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_REVIEW_MODEL||process.env.OPENAI_MODEL||'gpt-4o-mini',temperature:0,response_format:{type:'json_object'},messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify({profile,parts})}]})});
      const obj=await r.json().catch(()=>({}));
      if(!r.ok) throw Error(obj.error?.message || 'Quality review API failed');
      const verdict=JSON.parse(obj.choices?.[0]?.message?.content||'{}');
      return verdict.pass===true && Array.isArray(verdict.issues) && verdict.issues.length===0 ? {pass:true,issues:[]} : {pass:false,issues:Array.isArray(verdict.issues)?verdict.issues:[]};
    };
    let parsed, lastError='', failedIssues=[];
    for (let attempt=0;attempt<3;attempt++) {
      const extra = attempt ? `\nREGENERATE THE FULL SET. Previous failed quality checks: ${JSON.stringify(failedIssues).slice(0,4000)}. Fix ALL issues. Strict one correct answer only. Explicit directions in every question. Audio is actual spoken script.` : '';
      const r=await fetch('https://api.openai.com/v1/chat/completions',{
        method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4o-mini',temperature:0.2,response_format:{type:'json_object'},messages:[{role:'system',content:instructions+extra},{role:'user',content:JSON.stringify(profile)}]})
      });
      const api=await r.json().catch(()=>({}));
      if(!r.ok)return Response.json({error:api.error?.message||'OpenAI generation unavailable'},{status:502});
      try{parsed=JSON.parse(api.choices?.[0]?.message?.content||'{}')}catch{parsed=null}
      if(!parsed||!validParts(parsed.parts)) {failedIssues=[{reason:'Invalid schema, instructions, learning points or spoken text'}];parsed=null;lastError='Content did not pass structural checks';continue}
      let verdict;
      try{verdict=await review(parsed.parts)}catch(e){return Response.json({error:'Quality review unavailable: '+e.message+'. No exercises were published.'},{status:502})}
      if(verdict.pass)break;
      failedIssues=verdict.issues.length?verdict.issues:[{reason:'Reviewer rejected ambiguity or incorrect answers'}];
      lastError='Generated questions did not pass content quality review';parsed=null;
    }
    if (!parsed) return Response.json({error: lastError + '. Please generate again.'}, {status: 502});
    return Response.json({ parts: parsed.parts }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return Response.json({ error: e.message || 'Generation failed' }, { status: 500 }); }
};
