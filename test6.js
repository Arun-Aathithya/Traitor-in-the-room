/* Crew roles + attacks. In-process server on 8094 so abilities can be checked deterministically. Run: node test6.js */
process.env.SPEED='2';process.env.PORT='8094';process.env.DATA_DIR=require('fs').mkdtempSync(require('path').join(require('os').tmpdir(),'tir6-'));
const {srv,rooms,CLS}=require('./server.js');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ok=(c,msg)=>{if(!c)throw new Error('FAIL '+msg);console.log('pass',msg)};
function cli(){return new Promise(res=>{const w=new WebSocket('ws://localhost:8094'),c={w,v:null,code:null};
  w.onmessage=e=>{const m=JSON.parse(e.data);if(m.t==='state')c.v=m.v;else if(m.t==='joined')c.code=m.code};
  c.send=m=>w.send(JSON.stringify({aid:Math.random()+'',...m}));w.onopen=()=>res(c)})}
const until=async(f,ms=5000)=>{const t=Date.now();while(Date.now()-t<ms){if(f())return true;await sleep(25)}return false};
async function room(n,set){const A=await cli();A.send({t:'create',name:'P0',dev:'PC',did:'a'+Math.random()});await sleep(150);const cs=[A];
  for(let i=1;i<n;i++){const c=await cli();c.send({t:'join',code:A.code,name:'P'+i,dev:'PC',did:'d'+i+Math.random()});cs.push(c)}await sleep(250);
  if(set)A.send({t:'settings',...set});await sleep(100);A.send({t:'start'});await sleep(200);cs.forEach(c=>c.send({t:'seen'}));
  ok(await until(()=>A.v.ph==='play',8000),'match reaches play');return cs}
const id=c=>c.v.you,notes=c=>c.v.notes.map(n=>n.txt);
(async()=>{await new Promise(r=>srv.listen(8094,r));
 let cs=await room(5);const R=rooms.get(cs[0].code),G=R.G,P=x=>R.P.find(p=>p.id===(x.v?x.v.you:x));
 /* --- assignment */
 const crew=cs.filter(c=>P(c).role==='crew'),T=cs.find(c=>P(c).role==='traitor');
 ok(crew.length===4&&crew.every(c=>c.v.ab&&CLS[c.v.ab.cls])&&new Set(crew.map(c=>c.v.ab.cls)).size===4,'every crew member gets a different special role');
 ok(!T.v.ab&&T.v.atk&&T.v.atk.max===2,'the traitor has no crew role but has the attack ability');
 ok(cs.every(c=>c.v.P.filter(p=>p.id!==id(c)).every(p=>p.cls===null)),'nobody can see anyone else\'s role during the match');
 /* deterministic classes */
 const setCls=(c,k)=>{const p=P(c);p.cls=k;p.ab={uses:CLS[k].uses,cd:0,seen:new Set()}};
 const [det,med,gua,sci]=crew;setCls(det,'detective');setCls(med,'medic');setCls(gua,'guardian');setCls(sci,'scientist');await sleep(700);
 const place=m=>{for(const [c,st] of m){const p=P(c);p.st=st;p.trail.push({t:G.left,st})}};
 /* --- detective */
 det.send({t:'ab',id:id(crew[1])});await sleep(150);ok(notes(det).some(t=>/suspicious activity around P\d is (low|moderate|high)/.test(t)),'detective gets a limited suspicious-activity read');
 const n1=det.v.notes.length;det.send({t:'ab',id:id(crew[2])});await sleep(150);ok(det.v.notes.length===n1,'detective cooldown blocks an immediate second use');
 P(det).ab.cd=0;det.send({t:'ab',id:id(crew[1])});await sleep(150);ok(det.v.notes.length===n1,'detective cannot investigate the same player twice');
 G.sabs=[{t:G.left,by:id(T),st:'Lab',an:false}];G.pl=[{a:id(crew[2]),b:id(crew[3]),st:'Lab',l0:G.left+5,to:G.left-5}];
 P(det).ab.cd=0;det.send({t:'ab',id:id(crew[2])});await sleep(150);ok(/is low/.test(notes(det).slice(-1)[0]),'a player verified in a pair during a sabotage reads as low');
 P(det).ab.cd=0;ok(P(det).ab.uses===1,'detective has limited uses');det.send({t:'ab',id:id(T)});await sleep(150);P(det).ab.cd=0;
 det.send({t:'ab',id:id(crew[3])});await sleep(150);ok(P(det).ab.uses===0,'detective runs out of uses after three');
 /* --- scientist */
 G.sabs=[];sci.send({t:'ab'});await sleep(120);ok(sci.v.notes.length===0,'scientist cannot analyze when there has been no sabotage');
 G.sabs=[{t:G.left,by:id(T),st:'Lab',an:false}];G.sab={until:G.left-1000,fixIn:999};await sleep(600);ok(sci.v.ab.can===true,'scientist sees analysis is available');
 sci.send({t:'ab'});await sleep(150);ok(/triggered from the (Lab or \w+|\w+ or Lab) station/.test(notes(sci)[0]),'scientist learns two stations, one of them correct');
 const sn=sci.v.notes.length;sci.send({t:'ab'});await sleep(120);ok(sci.v.notes.length===sn,'each sabotage can only be analyzed once');
 /* --- engineer + scout (reassign) */
 setCls(det,'engineer');setCls(gua,'scout');await sleep(600);
 place(cs.map(c=>[c,'Lab']));det.send({t:'ab'});await sleep(150);ok(notes(det).slice(-1)[0].includes('Lab 5'),'engineer maintenance panel counts people per station');
 const eng=det,other=med;G.sab={until:G.left-1000,fixIn:999};
 eng.send({t:'fix_start'});await sleep(950);eng.send({t:'fix'});await sleep(150);ok(!eng.v.sab,'engineer repairs the reactor in under a second');
 G.sab={until:G.left-1000,fixIn:999};other.send({t:'fix_start'});await sleep(950);other.send({t:'fix'});await sleep(150);ok(!!other.v.sab,'other crew need longer');
 await sleep(1000);other.send({t:'fix'});await sleep(200);ok(!other.v.sab,'other crew can still fix it with the full hold');
 P(crew[1]).trail=[{t:G.left,st:'Cargo'}];P(gua).ab.cd=0;gua.send({t:'ab',id:id(crew[1])});await sleep(150);ok(/recently at Cargo/.test(notes(gua).slice(-1)[0]),'scout reports recent stations');
 /* --- attack rules */
 setCls(gua,'guardian');G.sabs=[];G.sab=null;const V=crew[3],W=crew[2],tp=P(T);
 place([[T,'Cargo'],[V,'Cargo'],[W,'Cargo'],[med,'Medbay'],[det,'Medbay']]);G.atkCd=0;await sleep(600);
 ok(T.v.atk.target===null,'attack shows no target when two people are at the station');
 T.send({t:'attack',id:id(V)});await sleep(150);ok(G.atkUsed===0&&!P(V).down,'attack is refused with a witness present');
 place([[W,'Medbay']]);await sleep(600);ok(T.v.atk.target&&T.v.atk.target.id===id(V),'attack offers the lone target');
 T.send({t:'attack',id:id(W)});await sleep(120);ok(G.atkUsed===0,'attack must be on the person who is actually there');
 /* --- guardian shield */
 gua.send({t:'ab',id:id(V)});await sleep(150);ok(P(V).shield&&P(gua).ab.uses===0,'guardian shields a player (one use per match)');
 T.send({t:'attack',id:id(V)});await sleep(200);
 ok(!P(V).down&&!P(V).shield&&G.atkUsed===1&&G.atkCd>0,'the shield absorbs the attack and the attack still goes on cooldown');
 ok(notes(T).some(t=>/attack failed/.test(t))&&notes(V).some(t=>/protected you/.test(t))&&notes(gua).some(t=>/shield held/.test(t)),'attacker, target and guardian are all told what happened');
 T.send({t:'attack',id:id(V)});await sleep(120);ok(G.atkUsed===1,'cooldown blocks a second attack');
 /* --- real attack, downed, medic */
 G.atkCd=0;T.send({t:'attack',id:id(V)});await sleep(250);
 ok(P(V).down&&V.v.down&&V.v.down.left>0&&notes(V).some(t=>/You were attacked/.test(t)),'an unshielded target is downed and told so');
 ok(med.v.downs.length===1&&med.v.downs[0].id===id(V)&&med.v.downs[0].st==='Cargo','the medic is alerted with the victim and station');
 ok(cs.filter(c=>c!==med&&c!==V).every(c=>c.v.downs.length===0),'nobody else sees the alert');
 V.send({t:'task_start',i:0});await sleep(120);ok(!P(V).cur,'a downed player cannot act');
 med.send({t:'medic_start',id:id(V)});med.send({t:'save',id:id(V)});await sleep(150);ok(P(V).down,'saving too quickly does nothing');
 await sleep(1100);med.send({t:'save',id:id(V)});await sleep(200);ok(!P(V).down&&P(med).ab.uses===1&&notes(V).some(t=>/medic saved you/.test(t)),'medic saves the player after a short hold');
 /* --- expiry */
 G.atkCd=0;G.atkUsed=0;place([[V,'Cargo'],[T,'Cargo'],[W,'Medbay'],[med,'Medbay']]);T.send({t:'attack',id:id(V)});await sleep(200);ok(P(V).down,'second attack downs the target');
 P(V).down.left=0.3;await sleep(900);ok(!P(V).alive&&G.log.some(l=>/was eliminated at Cargo/.test(l.txt)),'if no medic saves them in time they are eliminated and it is logged');
 med.send({t:'medic_start',id:id(V)});await sleep(1100);med.send({t:'save',id:id(V)});await sleep(150);ok(!P(V).alive,'a dead player cannot be saved');
 /* --- results reveal classes */
 G.left=0.1;await until(()=>cs[0].v.ph==='results',4000);await sleep(200);
 ok(cs[0].v.ph==='results'&&cs.every(c=>c.v.P.filter(p=>p.cls).length===4),'all special roles are revealed at the end');
 /* --- roles off */
 const cs2=await room(5,{roles:false});const R2=rooms.get(cs2[0].code);
 ok(cs2.every(c=>!c.v.ab)&&cs2.every(c=>!c.v.atk)&&!R2.G.R.roles,'with special roles off there are no classes and no attacks');
 const t2=cs2.find(c=>R2.P.find(p=>p.id===c.v.you).role==='traitor'),o2=cs2.find(c=>c!==t2);R2.P.forEach(p=>p.st='Lab');R2.G.atkCd=0;t2.send({t:'attack',id:o2.v.you});await sleep(200);ok(!R2.P.find(p=>p.id===o2.v.you).down,'attack is refused when special roles are off');
 console.log('ROLES PASSED');process.exit(0)})().catch(e=>{console.error(e.message);process.exit(1)});
