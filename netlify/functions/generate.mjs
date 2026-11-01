// Axcela Practice Engine Grammar V1 - constrained templates, on-demand 5-item minis.
// Axcela Practice Engine V0.4.4 - validated JSON and targeted repair, compatible with V0.4 index.html. One 20-item part per request; never expose secrets.
const NAMES=['Grammar comprehension','Listening comprehension','Vocabulary in context','Listen & Speak','Guided AI conversation'];
const tasks=[
 'Four mini exercises of 5 MCQs: (1) choose grammatical form for a specific context, (2) fill a blank, (3) correct a sentence / choose correct word order, (4) transform a sentence with an explicit transformation instruction. Each question must be solvable with one uniquely correct option. No bare statement for question.',
 'Four mini exercises of 5 listening comprehension MCQs. Every item includes a natural 15-45 word audio script providing the exact evidence to answer the clear question. Four answers; only one is supported. No filenames, URLs, placeholder text or answer revealed in question.',
 'Four mini exercises of 5 vocabulary/functional phrase MCQs. Focus on common transferable spoken workplace language. Context-specific prompts with one unambiguously best answer; avoid equivalent synonyms.',
 'Four mini exercises of 5 listen-and-repeat sentences. Each audio field contains natural 7-20 word spoken workplace English. q must instruct listen then repeat exactly. No answer options.',
 'Four mini exercises of 5 guided conversation turns. Audio is a spoken colleague/client question. q gives an explicit speaking goal, instructs choose a reply then say it. Four responses with exactly one fulfilling the explicit goal. No equally good alternatives.'
];
const clean=(s,n)=>String(s||'').trim().slice(0,n);
const audioValid=v=>typeof v==='string'&&v.trim().split(/\s+/).length>=7&&!/(?:\.mp3|\.wav|https?:\/\/|placeholder|audio file)/i.test(v);
const norm=s=>String(s||'').trim().toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ');
const normalizePoint=(v,points)=>{const n=norm(v);return points.find(x=>norm(x)===n)||null};
const qtext=s=>String(s||'').trim();
const fallbackInstruction=['Choose the only grammatically correct answer for the specific workplace situation below.','Listen to the message and choose the answer supported by what the speaker said.','Choose the phrase that best completes the stated workplace communication goal.','Listen to the sentence and record yourself repeating exactly the words you hear.','Listen to the colleague and choose the reply that fulfils the communication goal, then say it aloud.'];
function normalizeItem(q,p,points){if(!q||typeof q!=='object'||Array.isArray(q))return q;const o={...q};if(typeof o.q==='string')o.q=o.q.trim();if(typeof o.audio==='string')o.audio=o.audio.trim();if(typeof o.learning_point==='string'){const matched=points.find(x=>norm(x)===norm(o.learning_point));if(matched)o.learning_point=matched}if(typeof o.ok==='string'&&/^[0-3]$/.test(o.ok))o.ok=Number(o.ok);if(Array.isArray(o.a))o.a=o.a.map(x=>typeof x==='string'?x.trim():x);return o}

function errors(q,p,points){let a=[];if(!q||typeof q!=='object')return ['missing object'];if(typeof q.q!=='string'||q.q.trim().length<24||!/(choose|select|which|what|how|complete|correct|fill|listen|repeat|record|reply|respond|transform|rearrange)/i.test(q.q))a.push('unclear task');if(!points.some(s=>norm(s)===norm(q.learning_point)))a.push('incorrect learning_point');if(p===1||p===3||p===4){if(!audioValid(q.audio))a.push('invalid spoken audio script')};if(p!==3){if(!Array.isArray(q.a)||q.a.length!==4||q.a.some(v=>typeof v!=='string'||v.trim().length<2)||new Set((q.a||[]).map(norm)).size!==4)a.push('four unique answers required');if(!Number.isInteger(q.ok)||q.ok<0||q.ok>3)a.push('invalid correct index');if(!q.why||String(q.why).length<15)a.push('answer explanation missing')}else if(q.a?.length)a.push('repeat exercise must not have choices');return a}
async function call(key,model,sys,user,signal){let response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',signal,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,response_format:{type:'json_object'},temperature:0.25,messages:[{role:'system',content:'Return a valid JSON object only. JSON is required. '+sys},{role:'user',content:'Return JSON only for this input: '+JSON.stringify(user)}]})});let obj=await response.json().catch(()=>({}));if(!response.ok)throw Error(obj.error?.message||`OpenAI HTTP ${response.status}`);let v;try{v=JSON.parse(obj.choices?.[0]?.message?.content||'{}')}catch{throw Error('OpenAI returned invalid JSON')}return v}
// Grammar Engine V1: controlled question types; five individually generated items per mini.
const GRAMMAR_FORMATS = [
  { name:'Choose the correct verb form', instruction:'Choose the correct grammatical form to complete the workplace sentence.' },
  { name:'Complete the sentence', instruction:'Choose the option that correctly completes the gap in the workplace sentence.' },
  { name:'Rearrange the words', instruction:'Choose the option that puts the given words in the correct order to form a natural English sentence.' },
  { name:'Transform the sentence', instruction:'Choose the correct sentence transformation using the stated grammar rule without changing the intended meaning.' }
];
function grammarCheck(item, chosenPoint, group) {
  const problems=[];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return ['missing question object'];
  const equal = s => String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
  if (equal(item.learning_point)!==equal(chosenPoint)) problems.push('learning_point mismatch');
  if (!Array.isArray(item.a)||item.a.length!==4||item.a.some(x=>typeof x!=='string'||x.trim().length<2)||new Set((item.a||[]).map(equal)).size!==4) problems.push('four distinct nonempty answers required');
  if (!Number.isInteger(item.ok)||item.ok<0||item.ok>3)problems.push('ok must be integer 0-3');
  if (typeof item.stem!=='string'||item.stem.trim().length<12)problems.push('stem must contain workplace context and task data');
  if (typeof item.why!=='string'||item.why.trim().length<18)problems.push('specific explanation missing');
  if (group===2 && (typeof item.words!=='string'||item.words.trim().split(/\s+/).length<5)) problems.push('word bank required for rearrange');
  if (group===3 && (typeof item.rule!=='string'||item.rule.trim().length<5)) problems.push('transformation rule required');
  return problems;
}
async function generateGrammarMini({key,model,profile,mini,attempt,weak,previous,signal}) {
  const fmt=GRAMMAR_FORMATS[mini];
  const chosen=profile.points;
  const questions=[];
  for (let j=0;j<5;j++) {
    const point=chosen[(mini*5+j)%chosen.length];
    let generated=null, last='';
    for (let trial=0;trial<3;trial++) {
      const system=`Return valid JSON only, as {"question":{"stem":"...","a":["...","...","...","..."],"ok":0,"why":"...","learning_point":"..."${mini===2?',"words":"..."':''}${mini===3?',"rule":"..."':''}}. You are a Vietnamese adult EFL workplace assessment author. Produce ONE ${fmt.name} item at ${profile.level} level. TASK IS FIXED BY APPLICATION: ${fmt.instruction}. In stem give only the needed work situation and task data; do NOT add another vague question or reveal the answer. Copy learning_point exactly as the REQUIRED_POINT in the user input; do not choose another point. Four different options, only ONE objectively correct for the stated purpose. ok is the integer index (0-3). why explains the grammar rule and the contrast with a tempting wrong answer. Realistic spoken workplace context for ${profile.job}. Avoid shipping/delivery scenarios unless supplied. ${mini===0||mini===1?'Use a short sentence with a gap marked ____. Options are short forms/phrases, only one satisfies all grammatical cues.':''} ${mini===2?'words must show the shuffled word bank; each a option is a full sentence using those same words exactly once. Ensure only one word order is correct; include a clear grammar cue in stem.':''} ${mini===3?'stem contains an original sentence. rule names the requested transformation, e.g. convert to reported speech or conditional; options are rewritten full sentences. Keep original meaning, make three alternatives clearly violate the stated rule.':''} Use precise noncontroversial grammar. No two acceptable answers.`;
      try {
        const r=await call(key,model,system,{REQUIRED_POINT:point,profile,mini,item:j+1,attempt,weak_points:weak,previous_stems:[...previous,...questions.map(q=>q.stem)],previous_failure:last},AbortSignal.timeout(17000));
        const candidate=r.question;
        const issues=grammarCheck(candidate,point,mini);
        if (!issues.length){generated={q:`${fmt.instruction} ${candidate.stem.trim()}${mini===2?' Words: '+candidate.words.trim():''}${mini===3?' Rule: '+candidate.rule.trim():''}`,a:candidate.a,ok:candidate.ok,why:candidate.why,learning_point:point,exercise_type:['correct_form','fill_gap','rearrange','transformation'][mini]};break}
        last=issues.join('; ');
      } catch(e){last=String(e.message||e)}
    }
    if (!generated)throw Error(`Grammar Mini ${mini+1} Question ${j+1} could not be validated: ${last}`);
    questions.push(generated);
  }
  return questions;
}

// V0.4.3: strictly ONE mini-exercise (5 questions) per request.
// Never preload. The browser explicitly requests each mini in sequence.
export default async request=>{
 if(request.method!=='POST')return Response.json({error:'POST required'},{status:405});
 const key=process.env.OPENAI_API_KEY;if(!key)return Response.json({error:'OPENAI_API_KEY missing'},{status:503});
 const started=Date.now();let step='input';
 try{
  const body=await request.json();const part=Number(body.part),group=Number(body.mini);
  const p=body.profile||{};
  if(!Number.isInteger(part)||part<0||part>4||!Number.isInteger(group)||group<0||group>3||typeof p.job!=='string'||!p.job.trim()||typeof p.context!=='string'||!p.context.trim()||!Array.isArray(p.points)||p.points.length<1||p.points.length>5||!['A1','A2','B1','B2','C1'].includes(p.level))return Response.json({error:'Invalid profile, part or mini-exercise'},{status:400});
  const profile={job:clean(p.job,130),context:clean(p.context,500),level:p.level,website:clean(p.website,180),points:p.points.map(x=>clean(x,75))};
  const model=process.env.OPENAI_MODEL||'gpt-4o-mini';const weak=Array.isArray(body.weak_points)?body.weak_points.slice(0,5).map(x=>clean(x,75)):[];
  const attempt=Math.max(1,Math.min(100,Number(body.attempt)||1));

  if(part===0){
    step='grammar controlled generation';
    const questions=await generateGrammarMini({key,model,profile,mini:group,attempt,weak,previous:Array.isArray(body.previous_questions)?body.previous_questions.slice(0,10):[]});
    console.log(JSON.stringify({event:'grammar_mini_ready',mini:group,attempt,count:questions.length,ms:Date.now()-started}));
    return Response.json({part,mini:group,questions,attempt},{headers:{'Cache-Control':'no-store'}});
  }

  const typeName=part===0?['choose correct grammatical form','complete a gap','correct an error / choose correct word order','transform with explicit task'][group]:part===1?['identify stated detail','identify explicit reason','understand next step','identify stated intention'][group]:part===2?['meaning in context','collocation','professional tone','functional phrase'][group]:part===3?['making requests','giving status updates','explaining problems','proposing solutions'][group]:['asking for clarification','responding to an issue','disagreeing politely','agreeing next steps'][group];
  const base=`You are an expert English-for-work exercise author for Vietnamese adults. This is Part ${part+1} (${NAMES[part]}) mini-exercise ${group+1} of 4. Create EXACTLY FIVE DISTINCT items of the following kind: ${typeName}. Keep situations realistic for the given job and speaking context, CEFR ${profile.level}, and selected points. Website is a domain hint only, not verified research. Every question has q (an EXPLICIT actionable learner instruction that clearly states the task) and learning_point (COPY VERBATIM one of the learner's selected points; never paraphrase it). Output JSON only. For multiple-choice questions add a (exactly four nonempty, distinct string options), ok (INTEGER 0,1,2,3 indexing the correct answer), why (specific explanation of at least 15 characters). Output all required keys on EVERY item.  ONE answer must be objectively right; alternative correct phrasings are NOT valid distractors. Audio sections use audio as actual spoken English of >=7 words, NEVER a file name. Part 4 is repetition: q says listen and record; audio is spoken sentence; no answer choices. Do not leak answers in q. ${tasks[part]} Return ONLY JSON {"questions":[five item objects]}. Do not include markdown or commentary.`;
  const check=(questions)=>questions.map((q,i)=>({i,reasons:errors(q,part,profile.points)})).filter(x=>x.reasons.length);
  const input={profile,part,mini:group,attempt,weak_points:weak,previous_questions:Array.isArray(body.previous_questions)?body.previous_questions.slice(0,10).map(x=>clean(x,240)):[]};
  let questions=[];let last='No valid response';
  // One five-question generation; a bounded retry only for malformed structure.
  step='generate mini';
  for(let n=0;n<2;n++){
   try{const obj=await call(key,model,base,{...input,previous_failure:last},AbortSignal.timeout(22000));
    const arr=Array.isArray(obj.questions)?obj.questions:[];
    if(arr.length===5){questions=arr.map(q=>normalizeItem(q,part,profile.points));break}
    last=`Expected 5 questions, received ${arr.length}`;
   }catch(e){last=String(e.message||e)}
  }
  if(questions.length!==5)throw Error(`Incomplete mini-exercise: ${last}`);
  step='repair';
  // Repair invalid items individually. Use one strict schema for the actual part;
  // never accept partial objects or a guessed answer key.
  const schema = part===3
   ? '{"question":{"q":"Listen to the sentence and record yourself repeating exactly what you hear.","audio":"Seven or more natural spoken English words.","learning_point":"EXACT ONE SELECTED POINT"}}'
   : [1,4].includes(part)
   ? '{"question":{"q":"Clear actionable instruction with workplace situation and question?","audio":"At least seven actual spoken English words.","a":["Full answer A","Full answer B","Full answer C","Full answer D"],"ok":0,"why":"Clear specific reason for the unique correct answer.","learning_point":"EXACT ONE SELECTED POINT"}}'
   : '{"question":{"q":"Clear actionable instruction with workplace situation and question?","a":["Full answer A","Full answer B","Full answer C","Full answer D"],"ok":0,"why":"Clear specific reason for the unique correct answer.","learning_point":"EXACT ONE SELECTED POINT"}}';
  for(let round=0;round<3;round++){
   const failed=check(questions);if(!failed.length)break;
   for(const item of failed){
    const targetPoint=profile.points[(group*5+item.i)%profile.points.length];
    const prompt=`JSON ONLY. Produce a single complete replacement item. Required exact output schema: ${schema}. Part ${part+1}, mini ${group+1}, type ${typeName}, level ${profile.level}. Copy learning_point VERBATIM as "${targetPoint}" (do not rename). The q must contain the explicit command to learner plus enough specific context; no bare statements. ${part===3?'The audio field must be a speakable 7-20 word sentence; no MCQ choices, ok or why.':'Exactly FOUR distinct, meaningful answers as strings in array a; correct-answer index ok is integer 0..3; why is at least fifteen characters. Exactly ONE answer must fulfill the stated task.'} ${[1,3,4].includes(part)?'Audio must be the words the person says (at least seven words), never an mp3 filename.':''} ${tasks[part]}`;
    try{
      const obj=await call(key,model,prompt,{...input,required_learning_point:targetPoint,invalid:questions[item.i],errors:item.reasons,other_questions:questions.filter((_,i)=>i!==item.i).map(x=>x.q)},AbortSignal.timeout(16000));
      const candidate=normalizeItem(obj.question,part,profile.points);
      if(!errors(candidate,part,profile.points).length)questions[item.i]=candidate;
    }catch(e){last=String(e.message||e)}
   }
  }
  const issues=check(questions);if(issues.length)throw Error(`Mini ${group+1} structural checks failed: ${issues.map(x=>`Q${x.i+1} ${x.reasons.join('/')}`).join('; ')}`);
  step='quality review';
  const auditPrompt='You are a careful EFL test reviewer. Audit only FIVE items. Flag ambiguity, multiple defensible correct answers, incorrect answer key, unclear instructions, unsupported listening question, irrelevant context or mismatched learning point. Return only a valid JSON object {"issues":[{"index":0,"reason":"specific problem"}]}, with zero-based index, empty array if all pass.';
  const audit=await call(key,process.env.OPENAI_REVIEW_MODEL||model,auditPrompt,{profile,part,mini:group,questions},AbortSignal.timeout(20000));
  const semantic=(Array.isArray(audit.issues)?audit.issues:[]).filter(x=>Number.isInteger(x.index)&&x.index>=0&&x.index<5).slice(0,5);
  if(semantic.length){
   step='semantic repair';
   for(const issue of semantic){
    const i=issue.index;
    const sys=`Replace exactly ONE invalid ${NAMES[part]} question for mini-exercise ${group+1} (${typeName}). Return a JSON object with the key question, containing the complete replacement item with explicit task and learning_point copied VERBATIM from required_learning_point. ${part===3?'Natural audio, no MCQ answers.':'Four objectively distinct answers, correct integer index ok and detailed why.'} ${[1,3,4].includes(part)?'Natural spoken audio in audio field.':''} ${tasks[part]}`;
    const obj=await call(key,model,sys+' Exact JSON schema: '+schema,{...input,required_learning_point:profile.points[(group*5+i)%profile.points.length],old:questions[i],review_problem:issue.reason},AbortSignal.timeout(16000));
    const candidate=normalizeItem(obj.question,part,profile.points);
    if(errors(candidate,part,profile.points).length)throw Error(`Question ${i+1} replacement invalid`);
    questions[i]=candidate;
   }
   const recheck=await call(key,process.env.OPENAI_REVIEW_MODEL||model,auditPrompt,{profile,part,mini:group,questions},AbortSignal.timeout(20000));
   if(!Array.isArray(recheck.issues)||recheck.issues.length)throw Error('Repaired mini-exercise failed final quality review');
  }
  console.log(JSON.stringify({event:'mini_ready',part,mini:group,attempt,ms:Date.now()-started}));
  return Response.json({part,mini:group,questions,attempt},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error(JSON.stringify({event:'mini_failed',step,ms:Date.now()-started,message:String(e.message||e).slice(0,250)}));return Response.json({error:`${step}: ${e.message||'Generation failed'}`},{status:502})}
};
