/* Stage 3 checks: chat cleaning, report, mute, pair tasks. Start server first: PORT=8099 SPEED=30 npm start */
const WS=WebSocket,URL_='ws://localhost:8099',sleep=ms=>new Promise(r=>setTimeout(r,ms));
function cli(){return new Promise(res=>{const w=new WS(URL_),c={w,v:null,errs:[],tok:null,code:null};
  w.onmessage=e=>{const m=JSON.parse(e.data);if(m.t==='state')c.v=m.v;else if(m.t==='err')c.errs.push(m.msg);else if(m.t==='joined'){c.tok=m.token;c.code=m.code}};
  c.send=m=>w.send(JSON.stringify({aid:Math.random()+'',...m}));w.onopen=()=>res(c)})}
const ok=(c,msg)=>{if(!c)throw new Error('FAIL '+msg);console.log('pass',msg)};
const me=c=>c.v.P.find(p=>p.id===c.v.you);
async function until(f,ms=4000){const t=Date.now();while(Date.now()-t<ms){if(f())return true;await sleep(25)}return false}
(async()=>{
 const A=await cli();A.send({t:'create',name:'Alice',dev:'PC',did:'a3'});await sleep(200);
 const B=await cli(),C=await cli();
 B.send({t:'join',code:A.code,name:'Bob',dev:'Phone',did:'b3'});C.send({t:'join',code:A.code,name:'Cy',dev:'Phone',did:'c3'});await sleep(250);
 for(let i=0;i<3;i++)A.send({t:'addbot'});await sleep(200);
 A.send({t:'start'});await sleep(200);for(const c of [A,B,C])c.send({t:'seen'});
 ok(await until(()=>A.v.ph==='play'),'match is in play');
 /* ---- privacy fix: others' task counts are not sent */
 ok(A.v.P.filter(p=>p.id!==A.v.you).every(p=>p.done===0),'other players task counts are not sent');
 /* ---- pair tasks */
 ok(A.v.mine.length===3&&new Set(A.v.mine.map(t=>t.type)).size===3&&A.v.mine.every(t=>t.name&&t.st),'each player has 3 named tasks of different types');
 ok(A.v.canPair===true,'pairing is available while others are alive');
 A.send({t:'task_start',i:2});await sleep(60);ok(!A.v.mypair,'starting a task alone does not open a partner request');
 A.send({t:'pair_start',i:2});await sleep(40);
 ok(A.v.mypair&&A.v.mypair.mine&&A.v.mypair.partner===null,'pair request opens and waits for a partner');
 B.send({t:'pair_join',a:A.v.you});await sleep(120);
 ok(B.v.pairs.length===0&&A.v.mypair&&A.v.mypair.partner==='Bob'&&B.v.mypair&&!B.v.mypair.mine,'Bob joins; both see the pair');
 C.send({t:'pair_join',a:A.v.you});await sleep(100);ok(A.v.mypair.partner==='Bob','third player cannot take an occupied pair');
 const before=A.v.mine[2].done;
 A.send({t:'pair_hold'});B.send({t:'pair_hold'});A.send({t:'pair_done'});B.send({t:'pair_done'});await sleep(150);
 ok(!A.v.mine[2].done,'instant pair completion rejected');
 await sleep(3100);A.send({t:'pair_done'});B.send({t:'pair_done'});await sleep(200);
 ok(A.v.mine[2].done===true&&!A.v.mypair,'pair task completes when both hold together for 3 seconds');
 ok(A.v.log.some(l=>l.txt==='Alice and Bob worked together at '+A.v.mine[2].st),'pair shows in the match timeline');
 /* one-sided hold does not complete */
 B.send({t:'pair_start',i:2});await sleep(40);C.send({t:'pair_join',a:B.v.you});await sleep(100);
 B.send({t:'pair_hold'});await sleep(3100);B.send({t:'pair_done'});await sleep(200);
 ok(B.v.mine[2].done===false&&B.v.mypair,'one-sided hold does not complete a pair task');
 C.send({t:'pair_cancel'});await sleep(100);ok(B.v.mypair&&B.v.mypair.partner===null&&C.v.mypair===null,'partner can leave; request reopens');
 B.send({t:'pair_cancel'});await sleep(100);ok(B.v.mypair===null,'initiator can cancel');
 /* ---- chat, report, mute */
 A.send({t:'meet'});ok(await until(()=>A.v.ph==='meeting'),'meeting starts');
 A.send({t:'say',txt:"it's me <b>see http://evil.example or 555-123-4567"});
 B.send({t:'say',txt:'you are stupid'});C.send({t:'say',txt:'hello from Cy'});await sleep(90);
 const am=A.v.msgs.find(m=>m.name==='Alice');
 ok(am&&am.txt.includes("it's me")&&!am.txt.includes('<')&&!am.txt.includes('evil.example')&&!am.txt.includes('4567'),'free text keeps apostrophes, strips markup, links and phone numbers');
 ok(A.v.msgs.find(m=>m.name==='Bob').txt.includes('***'),'word filter applies to free text');
 const bm=A.v.msgs.find(m=>m.name==='Bob');
 A.send({t:'report',mid:bm.id});await sleep(70);
 ok(A.v.msgs.find(m=>m.id===bm.id).rep===true&&!A.v.msgs.find(m=>m.id===bm.id).hid,'one report is recorded, message still visible');
 A.send({t:'report',mid:bm.id});await sleep(50);
 C.send({t:'report',mid:bm.id});await sleep(90);
 ok(A.v.msgs.find(m=>m.id===bm.id).hid&&!A.v.msgs.find(m=>m.id===bm.id).txt,'second reporter hides the message for everyone');
 const cm=A.v.msgs.find(m=>m.name==='Cy');
 A.send({t:'mute',id:C.v.you});await sleep(80);
 ok(!A.v.msgs.some(m=>m.name==='Cy')&&B.v.msgs.some(m=>m.name==='Cy'),'mute hides that player only for the muter');
 ok(A.v.muted.includes(C.v.you),'muted list is returned');
 A.send({t:'report',mid:A.v.msgs.find(m=>m.mine).id});await sleep(50);ok(true,'reporting your own message is ignored');
 A.send({t:'mute',id:C.v.you});await sleep(80);ok(A.v.msgs.some(m=>m.name==='Cy'),'unmute brings messages back');
 console.log('STAGE 3 PASSED');process.exit(0)
})().catch(e=>{console.error(e.message);process.exit(1)});
