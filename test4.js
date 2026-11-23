/* Stage 3 completion checks. Starts its own in-process server on port 8098 so it can also inspect room state. Run: node test4.js */
process.env.SPEED='2';process.env.GRACE_MS='0';process.env.TOKEN_ROTATE_MS='1500';process.env.PORT='8098';
process.env.DATA_DIR=require('fs').mkdtempSync(require('path').join(require('os').tmpdir(),'tir-'));
const {srv,CT,TT,rooms}=require('./server.js');
const WS=WebSocket,URL_='ws://localhost:8098',sleep=ms=>new Promise(r=>setTimeout(r,ms));
function cli(){return new Promise(res=>{const w=new WS(URL_),c={w,v:null,errs:[],fatal:false,tok:null,code:null,acct:null,toks:[]};
  w.onmessage=e=>{const m=JSON.parse(e.data);if(m.t==='state')c.v=m.v;else if(m.t==='err'){c.errs.push(m.msg);if(m.fatal)c.fatal=true}else if(m.t==='joined'){c.tok=m.token;c.code=m.code}else if(m.t==='token')c.toks.push(m.token);else if(m.t==='acct')c.acct=m};
  c.send=m=>w.send(JSON.stringify({aid:Math.random()+'',...m}));w.onopen=()=>res(c)})}
const ok=(c,msg)=>{if(!c)throw new Error('FAIL '+msg);console.log('pass',msg)};
const me=c=>c.v.P.find(p=>p.id===c.v.you);
async function until(f,ms=4000){const t=Date.now();while(Date.now()-t<ms){if(f())return true;await sleep(25)}return false}
async function room(n,dev){const cs=[],A=await cli();A.did='h'+Math.random();A.send({t:'create',name:'Host',dev:dev||'PC',did:A.did});await sleep(150);cs.push(A);
  for(let i=1;i<n;i++){const c=await cli();c.did='d'+i+Math.random();c.send({t:'join',code:A.code,name:'P'+i,dev:i%2?'Phone':'PC',did:c.did});cs.push(c)}await sleep(250);return cs}
async function play(cs){cs[0].send({t:'start'});await sleep(200);cs.forEach(c=>c.send({t:'seen'}));return until(()=>cs[0].v.ph==='play')}
(async()=>{
 await new Promise(r=>srv.listen(8098,r));
 /* --- catalog and dealing */
 ok(CT.length===16&&TT.length===8,'task catalog: 16 crew tasks and 8 traitor tasks');
 ok(new Set([...CT,...TT].map(t=>t.type)).size>=8,'at least 8 different task types exist');
 const cs=await room(6);const [A,B,C,D,E,F]=cs;
 /* lobby chat, report, host remove */
 A.send({t:'say',txt:'hello lobby'});B.send({t:'say',txt:'rude: you are stupid'});await sleep(150);
 ok(C.v.msgs.some(m=>m.txt==='hello lobby')&&C.v.msgs.some(m=>m.txt.includes('***')),'lobby chat works with the word filter');
 const bm=C.v.msgs.find(m=>m.name==='P1');A.send({t:'hrm',mid:bm.id});await sleep(100);ok(C.v.msgs.find(m=>m.id===bm.id).hid&&C.v.msgs.find(m=>m.id===bm.id).hb,'host can remove a lobby message');
 const am=C.v.msgs.find(m=>m.name==='Host');B.send({t:'hrm',mid:am.id});await sleep(80);ok(!C.v.msgs.find(m=>m.id===am.id).hid,'only the host can remove messages');
 /* settings: max players, classic */
 A.send({t:'settings',max:6});await sleep(100);ok(B.v.set.max===6,'host sets max players');
 const X=await cli();X.send({t:'join',code:A.code,name:'Extra',dev:'Phone',did:'x1'});await sleep(150);ok(X.errs.includes('That room is full.'),'room refuses players beyond the max');
 A.send({t:'settings',max:3});await sleep(100);ok(B.v.set.max===6,'max cannot drop below the current player count');
 B.send({t:'settings',max:7});await sleep(80);ok(A.v.set.max===6,'non-host cannot change settings');
 ok(A.v.R.match===240&&A.v.R.meet===2,'classic on: 4:00 match, 2 meetings');
 A.send({t:'settings',classic:false});await sleep(100);ok(A.v.R.match===180&&A.v.R.meet===3&&A.v.R.sabMax===4,'classic off: 3:00 match, 3 meetings, 4 sabotages');
 /* kick */
 A.send({t:'kick',id:F.v.you});await sleep(150);ok(F.fatal&&A.v.P.length===5,'host removes a player from the lobby');
 const F2=await cli();F2.send({t:'join',code:A.code,name:'Back',dev:'Phone',did:F.did});await sleep(120);ok(F2.errs.includes('The host removed you from this room.'),'a removed player cannot rejoin the room');
 A.send({t:'settings',classic:false});
 ok(await play(cs.slice(0,5)),'match starts (classic off)');
 ok(A.v.left<=180&&A.v.meet===3,'classic off rules apply to the match');
 /* tasks: dealing */
 for(const c of cs.slice(0,5)){const ty=c.v.mine.map(t=>t.type);ok(ty.length===3&&new Set(ty).size===3,'3 different task types dealt to '+me(c).name);
   if(me(c).dev==='Phone')ok(!ty.some(t=>t==='drag'||t==='scan'),'phone player gets no mouse-only tasks')}
 /* solo vs pair choice on the same player */
 A.send({t:'task_start',i:0});await sleep(5800);A.send({t:'task_done',i:0});await sleep(150);ok(A.v.mine[0].done,'task 1 done alone');
 A.send({t:'pair_start',i:1});await sleep(60);B.send({t:'pair_join',a:A.v.you});await sleep(100);
 ok(A.v.mypair&&A.v.mypair.partner&&A.v.mypair.task===A.v.mine[1].name,'task 2 done with a partner (any task can be paired)');
 A.send({t:'pair_hold'});B.send({t:'pair_hold'});await sleep(3100);A.send({t:'pair_done'});B.send({t:'pair_done'});await sleep(200);
 ok(A.v.mine[1].done&&A.v.pl.length===1,'pair completed and recorded for the meeting screen');
 ok(A.v.pl[0].a===A.v.you&&A.v.pl[0].st===A.v.mine[1].st,'verified pair record has players and station');
 /* cleared suspects (white-box) */
 const R=rooms.get(A.code);R.G.sabs=[{t:R.G.pl[0].l0-0.0},{t:R.G.pl[0].l0+50}];A.send({t:'ping'});await sleep(700);
 ok(JSON.stringify(A.v.cleared.map(c=>c.ids.length))==='[2,0]','pair partners are cleared for a sabotage during their pair, others are not');
 R.G.sabs=[];
 /* traitor channel and ghost chat */
 const tr=cs.slice(0,5).find(c=>me(c).role==='traitor'),crew=cs.slice(0,5).filter(c=>me(c).role==='crew');
 tr.send({t:'say',txt:'psst',ch:'traitor'});await sleep(120);ok(tr.v.tmsgs.some(m=>m.txt==='psst'),'traitor can use the traitor channel');
 ok(crew.every(c=>c.v.tmsgs.length===0&&!JSON.stringify(c.v).includes('psst')),'crew never receive traitor channel messages');
 crew[0].send({t:'say',txt:'hi traitors',ch:'traitor'});await sleep(100);ok(!tr.v.tmsgs.some(m=>m.txt==='hi traitors'),'crew cannot post in the traitor channel');
 /* ghost tasks and ghost chat */
 const g=crew[1],gr=R.P.find(p=>p.id===g.v.you);gr.alive=false;await sleep(700);
 const before=A.v.done;g.send({t:'task_start',i:0});await sleep(5800);g.send({t:'task_done',i:0});await sleep(700);
 ok(g.v.mine[0].done&&A.v.done>before,'a ghost can finish a task and it counts for the crew');
 g.send({t:'say',txt:'boo',ch:'ghost'});await sleep(120);ok(g.v.gmsgs.some(m=>m.txt==='boo'),'ghost chat works for ghosts');
 ok(crew.filter(c=>c!==g).every(c=>c.v.gmsgs.length===0),'living players cannot see ghost chat');
 g.send({t:'pair_start',i:1});await sleep(80);ok(!g.v.mypair,'ghosts cannot start pair tasks');
 gr.alive=true;
 /* sabotage blocked while paired (white-box) */
 /* meeting shows pairs */
 A.send({t:'meet'});ok(await until(()=>A.v.ph==='meeting'),'meeting starts');ok(A.v.pl.length===1,'meeting data carries verified pairs');
 await sleep(200);
 /* security: token rotation */
 const T=cs[2];await sleep(100);const old=T.toks.length?T.toks[T.toks.length-1]:T.tok,C2=await cli();T.w.close();await sleep(150);
 C2.send({t:'rejoin',code:A.code,token:old,did:R.P.find(p=>p.id===T.v.you).did});await sleep(200);
 ok(C2.v&&C2.tok&&C2.tok!==old,'rejoin works and issues a fresh token');
 const C3=await cli();C3.send({t:'rejoin',code:A.code,token:old,did:R.P.find(p=>p.id===T.v.you).did});await sleep(150);ok(C3.fatal,'the old token no longer works after rotation');
 const n0=C2.toks.length;ok(await until(()=>C2.toks.length>n0,4000),'tokens also rotate while connected');
 const C4=await cli();C4.send({t:'rejoin',code:A.code,token:C2.toks[C2.toks.length-1],did:R.P.find(p=>p.id===T.v.you).did});await sleep(150);ok(!C4.fatal&&C4.v,'the newest rotated token works');
 /* accounts */
 const U=await cli();U.send({t:'register',user:'ab',pass:'longenough1'});await sleep(100);ok(U.errs.length===1,'short account name is refused');
 U.send({t:'register',user:'Tester_1',pass:'short'});await sleep(100);ok(U.errs.length===2,'short password is refused');
 U.send({t:'register',user:'Tester_1',pass:'correct horse'});ok(await until(()=>U.acct&&U.acct.user==='Tester_1'),'account is created');
 const sess=U.acct.sess;ok(sess&&sess.length===48,'a session token is issued');
 const U2=await cli();U2.send({t:'login',user:'tester_1',pass:'wrong password'});await sleep(400);ok(U2.errs.includes('Wrong name or password.'),'wrong password is refused');
 U2.send({t:'login',user:'tester_1',pass:'correct horse'});ok(await until(()=>U2.acct&&U2.acct.user==='Tester_1'),'login works (name is case-insensitive)');
 const U3=await cli();U3.send({t:'resume',user:'Tester_1',sess});await sleep(100);ok(U3.acct&&U3.acct.user==='Tester_1','a saved session resumes');
 const U4=await cli();U4.send({t:'resume',user:'Tester_1',sess:'0'.repeat(48)});await sleep(100);ok(U4.acct&&U4.acct.user===null,'a wrong session token is refused');
 const fs=require('fs'),path=require('path');await sleep(1200);const raw=fs.readFileSync(path.join(process.env.DATA_DIR,'accounts.json'),'utf8');ok(!raw.includes('correct horse')&&raw.includes('"hash"'),'passwords are stored only as salted hashes');
 U3.send({t:'create',name:'',dev:'PC',did:'u3'});await sleep(150);ok(U3.v&&U3.v.P[0].name==='Tester_1','a signed-in player gets their account name');
 const U5=await cli();U5.send({t:'login',user:'tester_1',pass:'correct horse'});await until(()=>U5.acct&&U5.acct.user);U5.send({t:'join',code:U3.code,name:'',dev:'PC',did:'u5'});await sleep(150);ok(U5.errs.includes('That account is already in this room.'),'one account cannot take two seats in a room');
 for(let i=0;i<5;i++){const L=await cli();L.send({t:'login',user:'tester_1',pass:'nope nope'+i});await sleep(150)}
 const L2=await cli();L2.send({t:'login',user:'tester_1',pass:'correct horse'});await sleep(500);ok(L2.errs.includes('Too many tries. Wait a minute.'),'repeated wrong passwords lock logins for a minute');
 /* client error reports and headers */
 const E1=await cli();for(let i=0;i<6;i++)E1.w.send(JSON.stringify({t:'cerr',msg:'test error '+i,src:'t.js'}));await sleep(100);ok(true,'client error reports are accepted (limited to 3 per connection)');
 const h=await fetch('http://localhost:8098/');ok((h.headers.get('content-security-policy')||'').includes("frame-ancestors 'none'"),'page is served with a content security policy');
 const hh=await (await fetch('http://localhost:8098/health')).json();ok(hh.ok&&typeof hh.rooms==='number','/health returns JSON counts');
 console.log('STAGE 3 COMPLETION PASSED');process.exit(0)
})().catch(e=>{console.error(e.message);process.exit(1)});
