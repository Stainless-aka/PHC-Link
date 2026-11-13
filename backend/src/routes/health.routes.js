const express = require('express');
const { createHash } = require('crypto');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/require-auth');

const router=express.Router();
let lastNewsSyncAt=0;
const FINAL_LINE='This is guidance only. Follow PHC protocol. If serious, send RED alert and refer now.';
const IDENTITY_LINE='I am a Health Assistant, for guidance only.';
const RED_LINE='This is RED. Send RED alert now and refer.';

function decodeXml(value){
  return String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g,' ').trim();
}
function emergencyQuestion(question){
  return /gunshot|bullet|heavy bleeding|bleeding after birth|haemorrhage|hemorrhage|eclampsia|convulsion|seizure|unconscious|not breathing|snake ?bite|road traffic|rta|serious accident|cutlass wound/i.test(question);
}
function sanitizeAnswer(raw,question,language='en'){
  let text=String(raw||'').replace(/I am a Health Assistant, for guidance only\./gi,'').replace(/Ni Mataimakin Lafiya ne, don jagora kawai\./gi,'').replace(/This is guidance only\. Follow PHC protocol\. If serious, send RED alert and refer now\./gi,'').replace(/^This is RED\. Send RED alert now and refer\.?\s*/i,'').trim();
  const unsafeDosage=/\b\d+(?:\.\d+)?\s?(?:mg|mcg|ml|mL|g|tablets?|capsules?)\b/i.test(text);
  const unsafeDiagnosis=/\b(this patient has|the patient has|you have been diagnosed with|this is definitely)\b/i.test(text);
  const unsafeProcedure=/\b(?:perform|carry out|do)\s+(?:surgery|an injection|a surgical procedure)\b|\binject(?:ion)?\s+(?:the patient|them|him|her)\b/i.test(text);
  const falseIdentity=/\bi am (?:a )?(?:doctor|nurse)\b/i.test(text);
  if(unsafeDosage||unsafeDiagnosis||unsafeProcedure||falseIdentity)text=language==='ha'?'Ban tabbata ba. A aika gargadi ga Likita kuma a bi tsarin PHC.':'I am not sure. Send alert to Clinician and follow PHC protocol.';
  let lines=text.split(/\n+/).map(line=>line.trim()).filter(Boolean);
  lines=lines.filter(line=>!/^\s*(?:step\s*)?\d+[.)-]?\s*$/i.test(line));
  const numbered=lines.filter(line=>/^\s*(?:\d+[.)]|[-•])\s*/.test(line));
  if(numbered.length)lines=numbered.slice(0,5);
  else lines=lines.join(' ').split(/(?<=[.!?])\s+/).filter(Boolean).slice(0,5);
  if(!lines.length)lines=[language==='ha'?'Ban tabbata ba. A aika gargadi ga Likita kuma a bi tsarin PHC.':'I am not sure. Send alert to Clinician and follow PHC protocol.'];
  const isEmergency=emergencyQuestion(question)||/^This is RED/i.test(String(raw||''));
  const output=[];
  if(isEmergency)output.push(RED_LINE);
  output.push(IDENTITY_LINE);
  output.push(...lines);
  output.push(FINAL_LINE);
  return {answer:output.join('\n'),emergency:isEmergency};
}

async function syncOfficialUpdates(){
  const feeds=[
    {name:'WHO Africa',url:'https://www.afro.who.int/rss/emergencies.xml',type:'rss'},
    {name:'Nigeria CDC',url:'https://ncdc.gov.ng/',type:'html'},
    {name:'Federal Ministry of Health',url:'https://health.gov.ng/press/',type:'html'}
  ];
  const client=await pool.connect();
  try{
    for(const feed of feeds){
      try{
        const response=await fetch(feed.url,{headers:{'User-Agent':'PHC-Link Health Tips/1.0'},signal:AbortSignal.timeout(7000)});
        if(!response.ok)continue;
        const body=await response.text();
        let entries=[];
        if(feed.type==='rss'){
          const blocks=body.match(/<item\b[\s\S]*?<\/item>/gi)||[];
          entries=blocks.slice(0,6).map(block=>{
            const title=decodeXml(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
            const link=decodeXml(block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]);
            const description=decodeXml(block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1]).slice(0,360);
            return {title,link,description};
          });
        }else{
          const links=[...body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
          entries=links.map(match=>{
            const href=match[1].startsWith('http')?match[1]:new URL(match[1],feed.url).toString();
            return {title:decodeXml(match[2]),link:href,description:''};
          }).filter(item=>/health|vaccin|outbreak|malaria|disease|immuni|lassa|cholera|public health|press release/i.test(item.title)).slice(0,6);
        }
        for(const item of entries){
          if(!item.title||!item.link||item.title.length<12)continue;
          const externalId=createHash('sha256').update(feed.name+'|'+item.link).digest('hex');
          const english=(item.description?item.title+'. '+item.description:item.title).slice(0,700);
          await client.query(
            `INSERT INTO health_tips(english_text,hausa_text,source_name,source_url,external_id)
             VALUES($1,'',$2,$3,$4) ON CONFLICT(external_id) DO NOTHING`,
            [english,feed.name,item.link,externalId]
          );
        }
      }catch(error){/* Keep the last saved tips if an official source is unavailable. */}
    }
  }finally{client.release();}
}

router.get('/health-tips',requireAuth,async(req,res,next)=>{
  try{
    if(Date.now()-lastNewsSyncAt>6*60*60*1000){lastNewsSyncAt=Date.now();syncOfficialUpdates().catch(()=>{});}
    const result=await pool.query(
      'SELECT id,english_text,hausa_text,source_name,source_url,created_at FROM health_tips WHERE is_active=TRUE ORDER BY created_at DESC LIMIT 40'
    );
    res.json({tips:result.rows});
  }catch(error){next(error);}
});

router.get('/health-assistant/knowledge',requireAuth,requireRole('health_worker'),async(req,res,next)=>{
  try{
    const result=await pool.query(
      'SELECT topic_key,keywords,english_answer,hausa_answer FROM health_assistant_knowledge WHERE is_active=TRUE ORDER BY priority,topic_key'
    );
    res.json({knowledge:result.rows});
  }catch(error){next(error);}
});

router.post('/health-assistant',requireAuth,requireRole('health_worker'),async(req,res,next)=>{
  const question=String(req.body.question||'').trim().slice(0,600);
  const language=req.body.language==='ha'?'ha':'en';
  if(question.length<2)return res.status(400).json({error:'Enter a short health question.'});
  try{
    const result=await pool.query(
      'SELECT topic_key,keywords,english_answer,hausa_answer FROM health_assistant_knowledge WHERE is_active=TRUE ORDER BY priority'
    );
    const normalized=question.toLowerCase();
    const match=result.rows.find(row=>(row.keywords||[]).some(keyword=>normalized.includes(String(keyword).toLowerCase())));
    let raw=match?(language==='ha'?match.hausa_answer:match.english_answer):'';
    let source=match?'offline_knowledge':'safe_fallback';

    if(!match&&process.env.HEALTH_AI_API_KEY){
      try{
        const base=(process.env.HEALTH_AI_BASE_URL||'https://openrouter.ai/api/v1/chat/completions').replace(/\/$/,'');
        const response=await fetch(base,{method:'POST',headers:{'Authorization':'Bearer '+process.env.HEALTH_AI_API_KEY,'Content-Type':'application/json','HTTP-Referer':process.env.FRONTEND_ORIGIN||'https://phc-link.vercel.app','X-Title':'PHC Link Health Assistant'},body:JSON.stringify({
          model:process.env.HEALTH_AI_MODEL||'deepseek/deepseek-chat',
          temperature:0.1,
          max_tokens:450,
          messages:[
            {role:'system',content:'You are a Health Assistant, for guidance only. You are not a doctor or nurse. Give short simple steps for a Nigerian PHC worker. Never diagnose. Never prescribe exact drug doses. Never instruct surgery, injections or procedures beyond training. Tell the worker to follow PHC standing orders and ask a Clinician. If an emergency is described, your first line must be exactly: This is RED. Send RED alert now and refer. Maximum 5 short numbered steps. Respond in '+(language==='ha'?'simple Hausa':'simple English')+'. Always end exactly with: '+FINAL_LINE},
            {role:'user',content:question}
          ]
        }),signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new Error('AI service unavailable');
        const payload=await response.json();
        raw=payload.choices?.[0]?.message?.content||'';
        if(raw)source='ai';
      }catch(error){raw='';}
    }
    if(!raw)raw=language==='ha'?'Ban tabbata ba. A aika gargadi ga Likita kuma a bi tsarin PHC.':'I am not sure. Send alert to Clinician and follow PHC protocol.';
    const safe=sanitizeAnswer(raw,question,language);
    res.json({answer:safe.answer,emergency:safe.emergency,source});
  }catch(error){next(error);}
});

module.exports=router;
