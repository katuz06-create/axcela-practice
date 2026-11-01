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
    const norm = t => String(t || '').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    const isGoodInstruction = t => typeof t === 'string' && t.trim().length >= 18 && /(?:\?|choose|select|complete|which|what|why|how|listen|repeat|record|read|fill|transform|combine|respond|reply|meaning|correct|best|appropriate)/i.test(t);
    // Normalize common harmless model-output differences, never fabricate answers or correct keys.
    const normalizeParts = parts => {
      if (!Array.isArray(parts)) return parts;
      return parts.map((part,i) => !Array.isArray(part) ? part : part.map(x => {
        if (!x || typeof x !== 'object') return x;
        const y = {...x};
        if (typeof y.learning_point === 'string') {
          const found = profile.points.find(p => norm(p) === norm(y.learning_point));
          if (found) y.learning_point = found;
        }
        if (i===3 && Array.isArray(y.a) && y.a.length===0) delete y.a;
        if (typeof y.ok === 'string' && /^[0-3]$/.test(y.ok)) y.ok = Number(y.ok);
        return y;
      }));
    };
    const structuralIssues = parts => {
      const issues=[];
      if (!Array.isArray(parts) || parts.length!==5) return [{part:0,item:0,reason:'Must return five parts (Grammar, Listening, Vocabulary, Speaking, Conversation)'}];
      parts.forEach((part,i)=>{
        if(!Array.isArray(part)||part.length!==5){issues.push({part:i+1,item:0,reason:'Part must have five questions'});return;}
        part.forEach((x,j)=>{
          const problems=[];
          if(!x||typeof x!=='object'){issues.push({part:i+1,item:j+1,reason:'Question is not an object'});return;}
          if(!isGoodInstruction(x.q))problems.push('Missing actionable task instruction');
          if(typeof x.learning_point!=='string'||!profile.points.some(p=>norm(p)===norm(x.learning_point)))problems.push('learning_point must exactly match one selected point');
          if([1,3,4].includes(i)&&!validAudio(x.audio))problems.push('Audio must be real spoken English, not a filename or placeholder');
          if(i===3){if(x.a!==undefined)problems.push('Speaking repeat item must not contain answer choices');}
          else {
            if(!Array.isArray(x.a)||x.a.length!==4||x.a.some(v=>typeof v!=='string'||v.trim().length<3)||new Set((x.a||[]).map(norm)).size!==4)problems.push('Four different, complete answer options required');
            if(!Number.isInteger(x.ok)||x.ok<0||x.ok>3)problems.push('Correct-answer index must be 0–3');
            if(typeof x.why!=='string'||x.why.trim().length<12)problems.push('A specific answer explanation is required');
          }
          if(problems.length) issues.push({part:i+1,item:j+1,reason:problems.join('; ')});
        });
      });
      return issues;
    };
    const review = async parts => {
      const prompt = `Act as an adversarial English assessment reviewer. Audit ALL 25 items in five parts. Check every MCQ has one and only one correct answer; other options MUST be wrong according to precisely stated task, not merely less preferred. Grammar: reject ambiguous or missing directions, answers already leaked in prompt, two correct grammatical constructions (especially relative clauses or verb tenses), invalid grammar. Listening: reject if answers are unsupported by literal audio or filenames. Vocabulary: reject synonyms that both work. Speaking: clear instruction and realistic repeatable audio. Conversation: reject multiple equally professional responses. Reject if role/CEFR/learning points are inconsistent. Return strict JSON {"pass":boolean,"issues":[{"part":1,"item":1,"reason":"..."}]} (up to 12 most severe). Conservative: if uncertain FAIL.`;
      const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_REVIEW_MODEL||process.env.OPENAI_MODEL||'gpt-4o-mini',temperature:0,response_format:{type:'json_object'},messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify({profile,parts})}]})});
      const obj=await r.json().catch(()=>({}));
      if(!r.ok) throw Error(obj.error?.message || 'Quality review API failed');
      const verdict=JSON.parse(obj.choices?.[0]?.message?.content||'{}');
      return verdict.pass===true && Array.isArray(verdict.issues) && verdict.issues.length===0 ? {pass:true,issues:[]} : {pass:false,issues:Array.isArray(verdict.issues)?verdict.issues:[]};
    };
    const requestJson = async (system, user, model, temperature=0.2) => {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method:'POST', headers:{Authorization:`Bearer ${key}`, 'Content-Type':'application/json'},
        body:JSON.stringify({model, temperature, response_format:{type:'json_object'}, messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(user)}]})
      });
      const obj=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(obj.error?.message || 'OpenAI request failed');
      try { return JSON.parse(obj.choices?.[0]?.message?.content || '{}'); }
      catch { throw new Error('OpenAI returned invalid JSON'); }
    };
    const generationModel=process.env.OPENAI_MODEL||'gpt-4o-mini';
    // Initial response may be incomplete. Repair its SHAPE before the question-level Quality Gate.
    // A missing part/question cannot be reached by the old item-repair loop, so rebuild that part.
    const partNames=['Grammar','Listening','Vocabulary','Listen & Speak','Guided Conversation'];
    let parsed={};
    try { parsed=await requestJson(instructions,profile,generationModel); }
    catch(e) { parsed={parts:[]}; }
    const incoming=Array.isArray(parsed?.parts)?parsed.parts:[];
    const parts=Array.from({length:5},(_,i)=>Array.isArray(incoming[i])?incoming[i].slice(0,5):[]);
    const isComplete=part=>Array.isArray(part)&&part.length===5&&part.every(x=>x&&typeof x==='object'&&!Array.isArray(x));
    // Generate only missing/incomplete parts, never discard the whole journey prematurely.
    const buildPart=async i=>{
      const partNumber=i+1;
      const system=`${instructions}\nOVERRIDE OUTPUT SHAPE FOR THIS REQUEST: Return ONLY JSON object {"questions":[exactly five question objects]} for PART ${partNumber}: ${partNames[i]}. Do not output other parts, markdown or explanatory text. The five question objects must follow the Part${partNumber} schema in the above instructions. Each question is separate and independently answerable.`;
      for(let retry=0;retry<3;retry++) {
        try {
          const reply=await requestJson(system,{profile,part:partNumber,existing_questions:parts[i],requested_count:5},generationModel,retry?0.1:0.2);
          const candidates=Array.isArray(reply.questions)?reply.questions:(Array.isArray(reply.part)?reply.part:[]);
          if(isComplete(candidates))return candidates;
        }catch(e) { /* Try again; never publish partial content. */ }
      }
      // Last fallback: build five positions individually to avoid long/truncated arrays.
      const recovered=[];
      for(let j=0;j<5;j++) {
        const oneSystem=`${instructions}\nOVERRIDE OUTPUT SHAPE: Return ONLY {"question":{...}}. Write one complete, independent question for Part ${partNumber} (${partNames[i]}), item ${j+1} of 5. Include every required schema field for this part.`;
        let done=false;
        for(let attempt=0;attempt<2&&!done;attempt++) {
          try{
            const reply=await requestJson(oneSystem,{profile,part:partNumber,item:j+1,previous_questions:recovered},generationModel,0.1);
            if(reply.question&&typeof reply.question==='object'&&!Array.isArray(reply.question)){recovered.push(reply.question);done=true;}
          }catch(e) { /* Preserve failure for clear message below. */ }
        }
        if(!done)break;
      }
      return recovered;
    };
    // Independent parts can be retried without redoing valid ones.
    const deficient=parts.map((part,i)=>isComplete(part)?-1:i).filter(i=>i>=0);
    const rebuilt=await Promise.all(deficient.map(async i=>({i,part:await buildPart(i)})));
    for(const x of rebuilt)parts[x.i]=x.part;
    if(parts.some(p=>!isComplete(p))){
      const incomplete=parts.map((p,i)=>!isComplete(p)?`${partNames[i]} (${p?.length||0}/5)`:null).filter(Boolean);
      return Response.json({error:`Could not complete: ${incomplete.join(', ')}. AI retried incomplete parts and questions; existing journey was preserved.`,code:'INVALID_SET_SHAPE',details:incomplete},{status:422});
    }
    parsed={parts};
    parsed.parts=normalizeParts(parsed.parts);
    const issueKey = x => `${x.part}:${x.item}`;
    const normalizeIssue = x => ({part:Number(x.part),item:Number(x.item),reason:String(x.reason||'Question failed review').slice(0,360)});
    const collectIssues = async () => {
      const structural=structuralIssues(parsed.parts).map(normalizeIssue);
      // Inspect only structurally valid questions in semantic review; preserve the invalid positions for targeted repair.
      let semantic=[];
      if(!structural.length) {
        const verdict=await review(parsed.parts);
        semantic=verdict.pass ? [] : (verdict.issues||[]).map(normalizeIssue);
        // A review without actionable coordinates is not evidence of passing.
        if(!verdict.pass && !semantic.length) semantic=[{part:0,item:0,reason:'Review rejected content but did not identify an item'}];
      }
      return [...structural,...semantic];
    };
    let issues=await collectIssues();
    // Repair only the failed positions, while preserving all already-approved questions.
    // Two attempts plus one simpler fallback per item. Each replacement is validated again.
    for(let attempt=1;attempt<=3 && issues.length;attempt++) {
      const targets=new Map();
      for(const issue of issues){
        if(!Number.isInteger(issue.part)||!Number.isInteger(issue.item)||issue.part<1||issue.part>5||issue.item<1||issue.item>5) continue;
        const k=issueKey(issue);
        if(!targets.has(k)) targets.set(k,[]);
        targets.get(k).push(issue.reason);
      }
      if(!targets.size) break;
      for(const [where,reasons] of targets){
        const [part,item]=where.split(':').map(Number);
        const old=parsed.parts[part-1][item-1];
        const repairSystem=`You are an EFL assessment editor. Replace EXACTLY ONE invalid question. Return only JSON {"question":{...}}. The replacement must follow the schema of part ${part} in these full instructions:\n${instructions}\nDo not alter any other items. Use a precise explicit learner-facing instruction, authentic workplace speech, one unambiguously correct MCQ option, and ensure the answer is supported by the prompt/audio. ${attempt===3?'Use a SIMPLE, highly constrained question type with one objectively correct answer.':''}`;
        try{
          const out=await requestJson(repairSystem,{profile,part,item,previous_question:old,failed_checks:reasons,other_questions_in_part:parsed.parts[part-1].filter((_,idx)=>idx!==item-1)},generationModel,0.1);
          const candidate=normalizeParts(Array.from({length:5},(_,i)=>i===part-1?[out.question]:[]))?.[part-1]?.[0];
          if(!candidate || typeof candidate!=='object') continue;
          // Validate in the complete set; never publish partial repairs.
          const previous=parsed.parts[part-1][item-1];
          parsed.parts[part-1][item-1]=candidate;
          if(structuralIssues(parsed.parts).some(x=>x.part===part&&x.item===item)) parsed.parts[part-1][item-1]=previous;
        }catch(e){ /* Keep old question and retry on next pass. */ }
      }
      issues=await collectIssues();
    }
    if(issues.length) return Response.json({
      error:'Some questions could not pass the Exercise Quality Gate after automatic repair. No new journey was published.',
      details:issues.slice(0,8).map(x=>`Part ${x.part||'?'} / Question ${x.item||'?'}: ${x.reason}`),
      code:'EXERCISE_QUALITY_FAILED'
    },{status:422});
    return Response.json({ parts: parsed.parts }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return Response.json({ error: e.message || 'Generation failed' }, { status: 500 }); }
};
