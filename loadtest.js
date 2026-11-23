/* Bot load test. Many rooms of scripted players play real matches against a running server.
   Usage:  PORT=8080 SPEED=10 npm start   (one terminal)
           ROOMS=30 PLAYERS=6 SECONDS=60 node loadtest.js   (another; Node 22+)
   Options (env): URL (default ws://localhost:8080), ROOMS, PLAYERS (3-8), SECONDS. It fails if there are errors or no match finishes. */
const URL_=process.env.URL||'ws://localhost:8080',ROOMS=+process.env.ROOMS||10,PLAYERS=Math.min(8,Math.max(3,+process.env.PLAYERS||5)),SECONDS=+process.env.SECONDS||30;
const MIN={seq:900,hold:1800,tap:1200,slider:900,memory:3000,timing:1000,wires:1500,sort:1200,code:1200,drag:800,scan:1200};
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),stats={connect:[],chat:[],states:0,bytes:0,errs:{},matches:0,joined:0,failed:0,tasks:0,pairs:0,meetings:0};
const pct=(a,p)=>a.length?a.slice().sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))]:0;
let stop=false;
function bot(i){return new Promise((res,rej)=>{const t0=Date.now(),w=new WebSocket(URL_),b={w,v:null,i,busy:false,did:'lt'+Math.random(),talked:false,voted:-1,chatAt:0};
  w.onmessage=e=>{const m=JSON.parse(e.data);if(m.t==='state'){stats.states++;stats.bytes+=e.data.length;b.v=m.v;
      if(b.chatAt&&m.v.msgs.some(x=>x.mine&&x.txt===b.chatTxt)){stats.chat.push(Date.now()-b.chatAt);b.chatAt=0}}
    else if(m.t==='joined')b.code=m.code;else if(m.t==='err')stats.errs[m.msg]=(stats.errs[m.msg]||0)+1};
  b.send=m=>w.readyState===1&&w.send(JSON.stringify({aid:Math.random()+'',...m}));
  w.onopen=()=>{stats.connect.push(Date.now()-t0);res(b)};w.onerror=()=>rej(new Error('connect failed'));w.onclose=()=>{b.closed=true}})}
const me=b=>b.v.P.find(p=>p.id===b.v.you);
async function act(b){if(b.busy||!b.v)return;const v=b.v;b.busy=true;try{
  if(v.ph==='reveal'&&!v.ready)b.send({t:'seen'});
  else if(v.ph==='play'){const m=me(b);
    if(v.sab&&m.role==='crew'&&m.alive){b.send({t:'fix_start'});await sleep(1900);b.send({t:'fix'})}
    else{const i=v.mine.findIndex(t=>!t.done);
      if(i>=0&&(m.alive||m.role==='crew')){const t=v.mine[i];
        if(m.alive&&Math.random()<.3&&v.canPair){b.send({t:'pair_start',i});stats.pairs++;await sleep(1500)}
        else{b.send({t:'task_start',i});await sleep(MIN[t.type]+250);b.send({t:'task_done',i});stats.tasks++}}
      else if(v.pairs.length&&m.alive&&Math.random()<.5){const x=v.pairs[0];b.send({t:'pair_join',a:x.a});b.send({t:'pair_hold'});await sleep(3100);b.send({t:'pair_done'})}
      else if(b.i===0&&m.alive&&v.meet>0&&v.mcd<=0&&Math.random()<.04){b.send({t:'meet'});stats.meetings++}
      else if(m.role==='traitor'&&m.alive&&v.alone>=50&&!v.sab&&v.sabCd<=0&&Math.random()<.3)b.send({t:'sab'})}}
  else if(v.ph==='meeting'&&me(b).alive){if(v.phase.k==='talk'&&!b.talked){b.talked=true;b.send({t:'say',txt:'bot '+b.i+' was at '+me(b).st,ch:'meet'})}else if(v.phase.k==='vote'&&b.voted!==v.meet){b.voted=v.meet;b.send({t:'vote',v:'skip'})}}
  else if(v.ph==='eject')b.talked=false;
  else if(v.ph==='results'&&!b.counted){b.counted=true;if(b.i===0){stats.matches++;await sleep(300);b.send({t:'again'})}}
  else if(v.ph==='lobby'){b.counted=false;if(b.i===0&&v.P.length>=PLAYERS&&Date.now()>b.nextStart){b.nextStart=Date.now()+1500;b.send({t:'start'})}}
 }catch(e){}b.busy=false}
async function runRoom(r){let bots=[];try{const h=await bot(0);bots.push(h);h.send({t:'create',name:'Bot0',dev:'PC',did:h.did});
  for(let k=0;k<30&&!h.code;k++)await sleep(50);if(!h.code)throw new Error('no room code');
  for(let i=1;i<PLAYERS;i++){const b=await bot(i);bots.push(b);b.send({t:'join',code:h.code,name:'Bot'+i,dev:i%2?'Phone':'PC',did:b.did})}
  await sleep(300);stats.joined+=bots.filter(b=>b.v).length;
  bots.forEach(b=>{b.chatTxt='hello from '+b.i+' '+r;b.chatAt=Date.now();b.send({t:'say',txt:b.chatTxt,ch:'lobby'})});
  h.nextStart=Date.now()+1500;
  while(!stop){for(const b of bots)act(b);await sleep(250);if(bots.some(b=>b.closed))throw new Error('a bot was disconnected')}
 }catch(e){stats.failed++;stats.errs[e.message]=(stats.errs[e.message]||0)+1}bots.forEach(b=>{try{b.w.close()}catch(e){}})}
(async()=>{console.log(`Load test: ${ROOMS} rooms x ${PLAYERS} bots against ${URL_} for ${SECONDS}s`);
  const base=await fetch(URL_.replace(/^ws/,'http')+'/health').then(r=>r.json()).catch(()=>null);
  const rs=[];for(let r=0;r<ROOMS;r++){rs.push(runRoom(r));await sleep(40)}
  await sleep(SECONDS*1000);stop=true;await Promise.all(rs);
  const end=await fetch(URL_.replace(/^ws/,'http')+'/health').then(r=>r.json()).catch(()=>null);
  const E=Object.entries(stats.errs).filter(([k])=>!/at least|already started|current pair task/.test(k));
  console.log(`connect ms p50/p95: ${pct(stats.connect,.5)}/${pct(stats.connect,.95)}   lobby chat round trip ms p50/p95: ${pct(stats.chat,.5)}/${pct(stats.chat,.95)}`);
  console.log(`state messages: ${stats.states} (${(stats.states/SECONDS).toFixed(0)}/s), avg ${stats.states?Math.round(stats.bytes/stats.states):0} bytes`);
  console.log(`matches finished: ${stats.matches}, tasks sent: ${stats.tasks}, pair requests: ${stats.pairs}, meetings: ${stats.meetings}, rooms failed: ${stats.failed}`);
  if(base&&end)console.log(`server memory: ${base.rss} MB -> ${end.rss} MB, rooms ${end.rooms}`);
  if(E.length)console.log('errors:',JSON.stringify(Object.fromEntries(E)));
  const bad=stats.failed>0||E.length>0||stats.matches===0;console.log(bad?'LOAD TEST FAILED':'LOAD TEST PASSED');process.exit(bad?1:0)})();
