// Axcela Practice Engine V0.4.1 - compatible with V0.4 index.html. One 20-item part per request; never expose secrets.
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
function errors(q,p,points){let a=[];if(!q||typeof q!=='object')return ['missing object'];if(typeof q.q!=='string'||q.q.trim().length<24||!/(choose|select|which|what|how|complete|correct|fill|listen|repeat|record|reply|respond|transform|rearrange)/i.test(q.q))a.push('unclear task');if(!points.some(s=>norm(s)===norm(q.learning_point)))a.push('incorrect learning_point');if(p===1||p===3||p===4){if(!audioValid(q.audio))a.push('invalid spoken audio script')};if(p!==3){if(!Array.isArray(q.a)||q.a.length!==4||q.a.some(v=>typeof v!=='string'||v.trim().length<2)||new Set((q.a||[]).map(norm)).size!==4)a.push('four unique answers required');if(!Number.isInteger(q.ok)||q.ok<0||q.ok>3)a.push('invalid correct index');if(!q.why||String(q.why).length<15)a.push('answer explanation missing')}else if(q.a?.length)a.push('repeat exercise must not have choices');return a}
async function call(key,model,sys,user,signal){let response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',signal,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,response_format:{type:'json_object'},temperature:0.25,messages:[{role:'system',content:sys},{role:'user',content:JSON.stringify(user)}]})});let obj=await response.json().catch(()=>({}));if(!response.ok)throw Error(obj.error?.message||`OpenAI HTTP ${response.status}`);let v;try{v=JSON.parse(obj.choices?.[0]?.message?.content||'{}')}catch{throw Error('OpenAI returned invalid JSON')}return v}
export default async request=>{
 if(request.method!=='POST')return Response.json({error:'POST required'},{status:405});
 const key=process.env.OPENAI_API_KEY;if(!key)return Response.json({error:'OPENAI_API_KEY missing'},{status:503});
 const started=Date.now();let step='input';
 try{
 const body=await request.json();const part=Number(body.part);const p=body.profile||{};if(!Number.isInteger(part)||part<0||part>4||!p.job||!p.context||!Array.isArray(p.points)||p.points.length<1||p.points.length>5||!['A1','A2','B1','B2','C1'].includes(p.level))return Response.json({error:'Invalid profile or part'},{status:400});
 const profile={job:clean(p.job,130),context:clean(p.context,500),level:p.level,website:clean(p.website,180),points:p.points.map(x=>clean(x,75))};
 const model=process.env.OPENAI_MODEL||'gpt-4o-mini';const prior=Array.isArray(body.weak_points)?body.weak_points.slice(0,5).map(x=>clean(x,75)):[];
 const attempt=Math.max(1,Math.min(20,Number(body.attempt)||1));
 const base=`You are an expert English for work assessment writer for Vietnamese adults. Create questions aligned with the learner's role, speaking situations, CEFR and selected grammar points. Website domain is only a hint; do not invent company-specific facts. One session consists of EXACTLY 20 items organized into four mini exercises of five items. Keep tasks at suitable level and use varied realistic situations. Every item must show what learner needs to do. The q field must not leak the correct answer. For multiple choice, only ONE unambiguously correct option; distractors definitely wrong given explicit goal, not simply another acceptable English sentence. Return JSON ONLY. Each item has q, learning_point (exact spelling from profile.points), and if relevant a (four strings), ok (0-based int), why (specific rationale). Listening and speaking items also have audio field containing the ACTUAL WORDS to speak, never a filename. ${tasks[part]} Avoid duplicating prompts. On retries, create NEW sentences/contexts, not rewordings of previous questions. Answer keys must be consistent with questions. Stop at exactly specified count.`;
 // Smaller 5-item requests reduce truncated JSON/timeouts; concurrent generation within function.
 step='generate';const mini=await Promise.all(Array.from({length:4},async(_,group)=>{
  let last=[];for(let tryNo=0;tryNo<2;tryNo++){
   const sys=`${base}\nGenerate ONLY mini exercise ${group+1} for ${NAMES[part]}. Return {"questions":[exactly 5 items]}. The task type for this mini exercise: ${part===0?['choose correct form','fill in the gap','correct sentence / word order','sentence transformation'][group]:part===1?['understand specific detail','identify reason','identify next step','interpret explicit speaker intention'][group]:part===2?['meaning','collocation','professional tone','functional phrase'][group]:part===3?['clear requests','status updates','explaining problems','proposing solutions'][group]:['clarification','responding to issues','polite disagreement','agreeing next steps'][group]}.`;
   try{const out=await call(key,model,sys,{profile,part,attempt,weak_points:prior,mini_exercise:group+1},AbortSignal.timeout(35000));const arr=Array.isArray(out.questions)?out.questions:[];last=arr; if(arr.length===5)break}catch(e){if(tryNo===1)throw e}
  }return last;
 }));
 let questions=mini.flat();if(questions.length!==20)throw Error(`Generated ${questions.length}/20 items; retry creation later`);
 const bad=()=>questions.map((q,i)=>({i,reasons:errors(q,part,profile.points)})).filter(v=>v.reasons.length);
 // Fix only structurally invalid items, retaining all other content.
 step='repair';for(let round=0;round<2;round++){
  let failed=bad();if(!failed.length)break;
  const replacements=await Promise.all(failed.map(async item=>{
   const result=await call(key,model,`${base}\nReturn JSON {"question":{...}} with ONE valid replacement for part ${part+1}. Fix: ${item.reasons.join('; ')}. Keep mini exercise ${(Math.floor(item.i/5)+1)} type.`,{profile,previous:questions[item.i],attempt,weak_points:prior},AbortSignal.timeout(25000));return {i:item.i,q:result.question};
  }));for(const item of replacements)questions[item.i]=item.q;
 }
 const remaining=bad();if(remaining.length)throw Error(`Quality check failed: ${remaining.slice(0,3).map(x=>`Q${x.i+1} ${x.reasons.join(', ')}`).join(' | ')}`);
 // Independent semantic review for ambiguous answers / unsupported listening details.
 step='review';const audit=await call(key,process.env.OPENAI_REVIEW_MODEL||model,'Review these 20 workplace English learning tasks independently. Reject ambiguous directions, more than one correct MCQ option, answer revealed by question, listening answers not supported by audio, poor or non-transferable workplace English. Return JSON {"issues":[{"index":0,"reason":"..."}]} using zero-based indexes. Only flag demonstrable errors, no speculative flags.',{profile,part,questions},AbortSignal.timeout(26000));
 let issues=(Array.isArray(audit.issues)?audit.issues:[]).filter(x=>Number.isInteger(x.index)&&x.index>=0&&x.index<20).slice(0,8);
 if(issues.length){step='semantic repair';const corrected=await Promise.all(issues.map(async x=>{const r=await call(key,model,`${base}\nReturn JSON {"question":{...}}. Replace this one flawed item. Specific error: ${clean(x.reason,250)}.`,{profile,part,original:questions[x.index],mini_exercise:Math.floor(x.index/5)+1,attempt,weak_points:prior},AbortSignal.timeout(22000));return {i:x.index,q:r.question}}));for(const x of corrected)questions[x.i]=x.q;let badItems=bad();if(badItems.length)throw Error('Repaired questions did not pass structural checks');}
 console.log(JSON.stringify({event:'generated',part,attempt,ms:Date.now()-started,items:questions.length,reviewed_issues:issues.length}));
 return Response.json({part,questions,attempt,model,quality:'automated review; teacher review recommended'});
 }catch(e){console.error(JSON.stringify({event:'generation_failed',step,ms:Date.now()-started,message:String(e.message||e).slice(0,350)}));return Response.json({error:`${step}: ${e.message||'Generation failed'}`},{status:502})}
};
