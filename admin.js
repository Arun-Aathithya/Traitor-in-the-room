'use strict';
/* Creator dashboard backend. Off unless ADMIN_TOKEN is set. Page: /admin   API: /admin/api/*  (Authorization: Bearer <token>)
   Reads matches.jsonl and reports.jsonl; moderation (reviewed reports, bans) lives in moderation.json via the server. */
const fs=require('fs'),path=require('path'),crypto=require('crypto');
module.exports=function(ctx){
  const {rooms,ACC,MOD,modSave,DATA,PKG,sha,ipOf,enforce}=ctx,TOKEN=process.env.ADMIN_TOKEN||'',fails=new Map();
  const eq=(a,b)=>crypto.timingSafeEqual(Buffer.from(sha(a)),Buffer.from(sha(b)));
  const json=(res,code,o)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(o))};
  const lines=(f,max)=>{try{return fs.readFileSync(path.join(DATA,f),'utf8').split('\n').filter(Boolean).slice(-max).map(x=>{try{return JSON.parse(x)}catch(e){return null}}).filter(Boolean)}catch(e){return[]}};
  const reports=()=>lines('reports.jsonl',5000).map(r=>({...r,id:r.id||sha((r.ts||'')+(r.room||'')+(r.txt||'')).slice(0,12)})).map(r=>({...r,status:MOD.reviewed[r.id]||'open'})).reverse();
  function authed(req,res){if(!TOKEN){json(res,503,{error:'The dashboard is off. Start the server with ADMIN_TOKEN set to turn it on.'});return false}
    const ip=ipOf(req),f=fails.get(ip)||{n:0,until:0};if(Date.now()<f.until){json(res,429,{error:'Too many tries. Wait a minute.'});return false}
    const h=String(req.headers.authorization||'').replace(/^Bearer /,'');
    if(!eq(h,TOKEN)){f.n++;if(f.n>=5){f.until=Date.now()+60000;f.n=0}fails.set(ip,f);json(res,401,{error:'Wrong token.'});return false}
    fails.delete(ip);return true}
  function body(req,cb){let d='';req.on('data',c=>{d+=c;if(d.length>4096)req.destroy()});req.on('end',()=>{try{cb(JSON.parse(d||'{}'))}catch(e){cb(null)}})}
  function setBan(kind,value,on,note){const m=MOD.bans[kind];if(!value)return false;if(on)m[value]={ts:new Date().toISOString(),note:String(note||'').slice(0,80)};else delete m[value];modSave();if(on)enforce();return true}
  function overview(){const M=lines('matches.jsonl',20000),day=t=>String(t).slice(0,10),days={};
    const now=Date.now();for(let i=13;i>=0;i--){const d=new Date(now-i*864e5).toISOString().slice(0,10);days[d]={date:d,matches:0,crew:0,traitor:0}}
    const why={},mode={classic:0,fast:0};let crew=0,dur=0,players=0,tasks=0,sab=0,meet=0,quick=0,atk=0,sav=0,elim=0,rl=0;
    M.forEach(m=>{if(m.w==='crew')crew++;dur+=m.secs;players+=m.humans;tasks+=m.total?m.done/m.total:0;sab+=m.sabs;meet+=m.meets;why[m.why]=(why[m.why]||0)+1;m.classic?mode.classic++:mode.fast++;if(m.quick)quick++;atk+=m.atks||0;sav+=m.saves||0;elim+=m.elims||0;if(m.roles)rl++;
      const d=days[day(m.ts)];if(d){d.matches++;m.w==='crew'?d.crew++:d.traitor++}});
    let live=0,inMatch=0;rooms.forEach(r=>{live+=r.P.filter(p=>p.online&&!p.bot).length;if(r.ph!=='lobby')inMatch++});
    const accts=Object.values(ACC.users),R=reports();
    return{version:PKG.version,up:Math.round(process.uptime()),rss:Math.round(process.memoryUsage().rss/1048576),
      live:{rooms:rooms.size,players:live,inMatch},
      totals:{matches:M.length,crewWinPct:M.length?Math.round(crew/M.length*100):0,avgMinutes:M.length?+(dur/M.length/60).toFixed(1):0,avgHumans:M.length?+(players/M.length).toFixed(1):0,
        tasksPct:M.length?Math.round(tasks/M.length*100):0,sabsPerMatch:M.length?+(sab/M.length).toFixed(1):0,meetingsPerMatch:M.length?+(meet/M.length).toFixed(1):0,quickPct:M.length?Math.round(quick/M.length*100):0,rolesPct:M.length?Math.round(rl/M.length*100):0,attacksPerMatch:M.length?+(atk/M.length).toFixed(1):0,savesPerMatch:M.length?+(sav/M.length).toFixed(1):0,elimsPerMatch:M.length?+(elim/M.length).toFixed(1):0},
      days:Object.values(days),why,mode,
      accounts:{total:accts.length,players:accts.filter(a=>a.games>0).length,banned:Object.keys(MOD.bans.acct).length},
      economy:{earned:(ACC.eco&&ACC.eco.earned)||0,spent:(ACC.eco&&ACC.eco.spent)||0,held:accts.reduce((n,a)=>n+(a.cr||0),0),owners:accts.filter(a=>(a.own||[]).length).length},
      reports:{open:R.filter(r=>r.status==='open').length,total:R.length},bannedDevices:Object.keys(MOD.bans.did).length}}
  return function(req,res,url){const p=url.pathname;if(!p.startsWith('/admin/api/'))return false;if(!authed(req,res))return true;
    const sub=p.slice(11);
    if(req.method==='GET'&&sub==='overview')return json(res,200,overview()),true;
    if(req.method==='GET'&&sub==='reports'){const st=url.searchParams.get('status');return json(res,200,{reports:reports().filter(r=>!st||st==='all'||r.status===st).slice(0,300)}),true}
    if(req.method==='GET'&&sub==='accounts')return json(res,200,{accounts:Object.entries(ACC.users).map(([k,u])=>({key:k,name:(u.nick?u.nick+' ('+u.name+')':u.name),games:u.games,wins:u.wins,tasks:u.tasks,credits:u.cr||0,items:(u.own||[]).length,created:u.created,banned:!!MOD.bans.acct[k]})).sort((a,b)=>b.games-a.games)}),true;
    if(req.method==='GET'&&sub==='replays'){const R=lines('replays.jsonl',150).map(o=>({id:o.id,ts:o.ts,w:o.w,why:o.why,secs:o.secs,n:o.n,humans:o.humans,classic:o.classic,len:o.R&&o.R.match,tasks:o.R&&o.R.tasks})).reverse();return json(res,200,{replays:R}),true}
    if(req.method==='GET'&&sub.startsWith('replays/')){const id=sub.slice(8);if(!/^[a-f0-9]{12}$/.test(id))return json(res,400,{error:'Bad replay id.'}),true;
      const o=lines('replays.jsonl',400).find(x=>x.id===id);return o?json(res,200,o):json(res,404,{error:'That replay is gone (only the latest matches are kept).'}),true}
    if(req.method==='GET'&&sub==='bans')return json(res,200,{accounts:MOD.bans.acct,devices:MOD.bans.did}),true;
    if(req.method==='GET'&&sub==='rooms'){const o=[];rooms.forEach(r=>o.push({code:r.code,phase:r.ph,humans:r.P.filter(x=>!x.bot).length,online:r.P.filter(x=>x.online&&!x.bot).length,bots:r.P.filter(x=>x.bot).length,left:r.G?Math.round(r.G.left):null}));return json(res,200,{rooms:o}),true}
    if(req.method==='GET'&&sub==='matches.csv'){const M=lines('matches.jsonl',20000),h='ts,room,players,humans,bots,winner,reason,seconds,tasks_done,tasks_total,sabotages,meetings,classic,quick,special_roles,attacks,saves,eliminations,match_seconds,tasks_per_player',q=s=>'"'+String(s).replace(/"/g,'""')+'"';
      res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="matches.csv"','cache-control':'no-store'});
      res.end([h,...M.map(m=>[m.ts,m.room,m.n,m.humans,m.n-m.humans,m.w,q(m.why),m.secs,m.done,m.total,m.sabs,m.meets,m.classic,m.quick,!!m.roles,m.atks||0,m.saves||0,m.elims||0,m.len||'',m.tpp||3].join(','))].join('\n'));return true}
    if(req.method==='POST'&&sub.startsWith('reports/')){const id=sub.slice(8);body(req,b=>{if(!b)return json(res,400,{error:'Bad request.'});
      const r=reports().find(x=>x.id===id);if(!r)return json(res,404,{error:'No such report.'});const a=b.action;
      if(a==='dismiss'||a==='reviewed'){MOD.reviewed[id]=a}
      else if(a==='ban_account'){if(!r.acct)return json(res,400,{error:'That player had no account.'});setBan('acct',r.acct,true,'report '+id);MOD.reviewed[id]=a}
      else if(a==='ban_device'){if(!r.did)return json(res,400,{error:'No device on record.'});setBan('did',r.did,true,'report '+id);MOD.reviewed[id]=a}
      else if(a==='reopen'){delete MOD.reviewed[id]}else return json(res,400,{error:'Unknown action.'});
      modSave();json(res,200,{ok:true})});return true}
    if(req.method==='POST'&&sub==='ban'){body(req,b=>{if(!b||!['acct','did'].includes(b.kind))return json(res,400,{error:'Bad request.'});
      const v=b.kind==='acct'?String(b.value||'').toLowerCase().slice(0,16):String(b.value||'').slice(0,40);
      if(b.kind==='acct'&&!ACC.users[v])return json(res,404,{error:'No such account.'});setBan(b.kind,v,!!b.on,b.note);json(res,200,{ok:true})});return true}
    json(res,404,{error:'Not found.'});return true}};
