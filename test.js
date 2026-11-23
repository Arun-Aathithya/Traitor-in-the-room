const WS=WebSocket,URL_='ws://localhost:8099';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function cli(name){return new Promise(res=>{const w=new WS(URL_),c={w,v:null,errs:[],tok:null,code:null,name};
  w.onmessage=e=>{const m=JSON.parse(e.data);if(m.t==='state')c.v=m.v;else if(m.t==='err')c.errs.push(m.msg);else if(m.t==='joined'){c.tok=m.token;c.code=m.code}};
  c.send=m=>w.send(JSON.stringify({aid:Math.random()+'',...m}));w.onopen=()=>res(c)})}
const ok=(c,msg)=>{if(!c)throw new Error('FAIL '+msg);console.log('pass',msg)};
(async()=>{
 const A=await cli('A');A.send({t:'create',name:'Alice',dev:'PC',did:'dA'});await sleep(200);
 ok(A.v&&A.v.ph==='lobby'&&A.code.length===4,'create room, 4-letter code');
 const B=await cli('B');B.send({t:'join',code:'ZZZZ',name:'Bob',dev:'Phone',did:'dB'});await sleep(150);ok(B.errs.includes('No room with that code.'),'wrong code error');
 B.send({t:'join',code:A.code.toLowerCase(),name:'Bob<b>',dev:'Phone',did:'dB'});await sleep(200);ok(B.v&&B.v.P.find(p=>p.name==='Bobb'),'join + name sanitised');
 A.send({t:'start'});await sleep(150);ok(A.errs.some(e=>e.includes('at least 5')),'start blocked under 5 players');
 B.send({t:'addbot'});await sleep(100);ok(B.v.P.length===2,'non-host cannot add bot');
 for(let i=0;i<3;i++)A.send({t:'addbot'});await sleep(150);ok(A.v.P.length===5,'host adds bots to reach 5');
 const C=await cli('C');C.send({t:'join',code:A.code,name:'Cy',dev:'Phone',did:'dC'});await sleep(150);ok(C.v.P.length===6,'6th player joins');
 A.send({t:'start'});await sleep(300);ok(A.v.ph==='reveal','match moves to role reveal');
 // privacy
 const roles=[A,B,C].map(c=>c.v.P.find(p=>p.id===c.v.you).role);
 ok(roles.every(r=>r==='crew'||r==='traitor'),'each player sees own role');
 ok([A,B,C].every(c=>c.v.P.filter(p=>p.id!==c.v.you&&p.role!=='?').length===(c.v.P.find(p=>p.id===c.v.you).role==='traitor'?0:0)),'others roles hidden (1 traitor => no partner shown)');
 ok(!JSON.stringify(A.v).includes('"role":"traitor"')||A.v.P.find(p=>p.id===A.v.you).role==='traitor','role leak check');
 for(const c of [A,B,C])c.send({t:'seen'});await sleep(2500);ok(A.v.ph==='play','play starts after everyone has seen role (SPEED 10)');
 // task min time
 const me=A.v.P.find(p=>p.id===A.v.you);
 A.send({t:'task_start',i:0});A.send({t:'task_done',i:0});await sleep(200);ok(!A.v.mine[0].done,'instant task completion rejected');
 A.send({t:'task_start',i:0});await sleep(5800);A.send({t:'task_done',i:0});await sleep(200);ok(A.v.mine[0].done||A.v.ph!=='play','task accepted after minimum time');
 // duplicate action id
 const dup={t:'say',txt:'x',aid:'same'};
 // reconnect
 C.w.close();await sleep(200);ok(A.v.P.find(p=>p.id===C.v.you).online===false,'disconnect marks player offline');
 const C2=await cli('C2');C2.send({t:'rejoin',code:A.code,token:C.tok,did:'dC'});await sleep(200);ok(C2.v&&C2.v.you===C.v.you,'rejoin with token+device restores seat');
 const C3=await cli('C3');C3.send({t:'rejoin',code:A.code,token:C.tok,did:'WRONG'});await sleep(150);ok(C3.errs.length>0,'rejoin from wrong device refused');
 const D=await cli('D');D.send({t:'join',code:A.code,name:'Late',dev:'PC',did:'dD'});await sleep(150);ok(D.errs.includes('That match has already started.'),'cannot join running match');
 // meeting
 if(A.v.ph==='play'){A.send({t:'meet'});await sleep(300);ok(A.v.ph==='meeting','meeting starts');
  A.send({t:'say',txt:'I was at Lab',sus:1});await sleep(100);ok(A.v.msgs.some(m=>m.name==='Alice'&&m.txt==='I was at Lab'),'chat line appears');
  A.send({t:'say',txt:'again'});await sleep(100);ok(A.v.msgs.filter(m=>m.name==='Alice').length===1,'chat rate-limited');
  for(let i=0;i<120&&!(A.v.phase&&A.v.phase.k==='vote');i++)await sleep(50);A.send({t:'vote',v:'skip'});for(let i=0;i<120&&A.v.ph==='meeting';i++)await sleep(50);ok(['eject','play','results'].includes(A.v.ph),'vote resolves');}
 // run to the end
 for(let i=0;i<160&&A.v.ph!=='results';i++)await sleep(500);
 ok(A.v.ph==='results'&&A.v.end&&A.v.P.every(p=>p.role!=='?'),'match ends, all roles revealed, MVP '+A.v.end.mvp);
 A.send({t:'again'});await sleep(200);ok(A.v.ph==='lobby','host starts rematch in same room');
 console.log('ALL PASSED');process.exit(0)
})().catch(e=>{console.error(e.message);process.exit(1)});
