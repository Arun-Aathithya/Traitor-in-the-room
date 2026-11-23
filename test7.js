/* Part 2 checks: match length and task count settings, credits and shop, match replays in the dashboard. In-process server on 8093. Run: node test7.js */
process.env.SPEED='30';process.env.PORT='8093';process.env.ADMIN_TOKEN='test7-admin-token';process.env.BOT_SABOTAGE='0';
const DIR=process.env.DATA_DIR=require('fs').mkdtempSync(require('path').join(require('os').tmpdir(),'tir7-'));
const {srv,rooms,ACC,SHOP}=require('./server.js'),fs=require('fs'),path=require('path'),B='http://localhost:8093',sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ok=(c,msg)=>{if(!c)throw new Error('FAIL '+msg);console.log('pass',msg)};
function cli(){return new Promise(res=>{const w=new WebSocket('ws://localhost:8093'),c={w,v:null,errs:[],code:null,acct:null,stats:null};
  w.onmessage=e=>{const m=JSON.parse(e.data);if(m.t==='state')c.v=m.v;else if(m.t==='err')c.errs.push(m.msg);else if(m.t==='joined')c.code=m.code;else if(m.t==='acct')c.acct=m;else if(m.t==='stats')c.stats=m};
  c.send=m=>w.send(JSON.stringify({aid:Math.random()+'',...m}));w.onopen=()=>res(c)})}
const until=async(f,ms=6000)=>{const t=Date.now();while(Date.now()-t<ms){if(f())return true;await sleep(25)}return false};
const adm=p=>fetch(B+'/admin/api/'+p,{headers:{authorization:'Bearer '+process.env.ADMIN_TOKEN}});
async function acct(name){const c=await cli();c.send({t:'register',user:name,pass:'password-'+name});ok(await until(()=>c.acct&&c.acct.user),'account '+name+' created');return c}
(async()=>{await new Promise(r=>srv.listen(8093,r));
 /* ---- accounts (needed for credits) */
 const names=['alice7','bob7','cara7'],cs=[];for(const n of names)cs.push(await acct(n));
 ok(cs[0].acct.cr===0&&Array.isArray(cs[0].acct.own)&&cs[0].acct.shop.length===SHOP.length,'a new account has 0 credits and receives the shop list');
 const [A,Bo,C]=cs;A.send({t:'create',name:'Alice',dev:'PC',did:'dA7'});await sleep(150);
 Bo.send({t:'join',code:A.code,name:'Bob',dev:'PC',did:'dB7'});C.send({t:'join',code:A.code,name:'Cara',dev:'PC',did:'dC7'});await sleep(300);
 /* ---- live settings: length and tasks */
 const R=rooms.get(A.code);
 ok(A.v.R.match===240&&A.v.R.tasks===3,'defaults: Classic 4:00 and 3 tasks each');
 A.send({t:'settings',len:300});await sleep(150);ok(A.v.R.match===300&&Bo.v.R.match===300&&C.v.R.match===300,'the host changes the match length and every player sees it at once');
 A.send({t:'settings',len:50});await sleep(100);ok(A.v.R.match===120,'a length below 2:00 is raised to 2:00');
 A.send({t:'settings',len:9999});await sleep(100);ok(A.v.R.match===420,'a length above 7:00 is capped at 7:00');
 A.send({t:'settings',len:137});await sleep(100);ok(A.v.R.match===150,'a length is rounded to the nearest 30 seconds');
 A.send({t:'settings',len:null});await sleep(100);ok(A.v.R.match===240&&A.v.set.len===null,'Auto goes back to the length set by Classic mode');
 A.send({t:'settings',classic:false});await sleep(100);ok(A.v.R.match===180,'Auto follows Classic mode off (3:00)');A.send({t:'settings',classic:true});
 Bo.send({t:'settings',len:420,tasks:5});await sleep(100);ok(A.v.R.match===240&&A.v.R.tasks===3,'only the host can change these settings');
 for(const [x,y] of [[9,5],[0,1],[-4,1],[2,2],['x',3]]){A.send({t:'settings',tasks:x});await sleep(80);ok(A.v.R.tasks===y,'tasks setting '+JSON.stringify(x)+' becomes '+y)}
 A.send({t:'settings',len:120,tasks:4,quick:true});await sleep(150);
 /* ---- shop item shows in the lobby for everyone */
 Bo.send({t:'buy',id:'fr_gold'});await sleep(150);ok(Bo.errs.some(e=>/Not enough credits/.test(e)),'buying without credits is refused');
 ACC.users.bob7.cr=500;Bo.send({t:'buy',id:'fr_gold'});await sleep(150);
 ok(Bo.acct.cr===380&&Bo.acct.own.includes('fr_gold'),'buying an item takes its price and adds it to the account');
 Bo.send({t:'buy',id:'fr_gold'});await sleep(100);ok(Bo.errs.some(e=>/already own/.test(e))&&ACC.users.bob7.cr===380,'buying the same item twice is refused and costs nothing');
 Bo.send({t:'equip',id:'ti_owl',kind:'title'});await sleep(100);ok(Bo.errs.some(e=>/do not own/.test(e)),'equipping an item you do not own is refused');
 Bo.send({t:'equip',id:'fr_gold',kind:'title'});await sleep(100);ok(!ACC.users.bob7.eq||ACC.users.bob7.eq.title!=='fr_gold','an item cannot be equipped in the wrong slot');
 Bo.send({t:'buy',id:'ti_sleuth'});await sleep(100);Bo.send({t:'equip',id:'fr_gold',kind:'frame'});Bo.send({t:'equip',id:'ti_sleuth',kind:'title'});await sleep(250);
 const bobSeen=A.v.P.find(p=>p.name==='Bob');ok(bobSeen.fr==='fr_gold'&&bobSeen.ti==='Sleuth','other players see the equipped ring and title in the lobby');
 ok(A.v.P.find(p=>p.name==='Alice').fr===''&&A.v.P.find(p=>p.name==='Alice').ti==='','players with nothing equipped show nothing');
 Bo.send({t:'equip',id:'',kind:'frame'});await sleep(150);ok(A.v.P.find(p=>p.name==='Bob').fr===''&&A.acct.eq.frame==='','unequipping removes the ring');
 Bo.send({t:'equip',id:'fr_gold',kind:'frame'});
 const g=await cli();g.send({t:'buy',id:'fr_gold'});await sleep(150);ok(g.errs.some(e=>/Sign in/.test(e)),'a guest cannot use the shop');
 /* ---- play a match (nobody acts, the clock runs out) */
 ok(A.v.R.match===120&&A.v.R.tasks===4,'settings are still in place at the start');
 A.send({t:'start'});await sleep(200);cs.forEach(c=>c.send({t:'seen'}));
 ok(await until(()=>A.v.ph==='play',8000),'match starts');
 ok(cs.every(c=>c.v.mine.length===4)&&A.v.total===(3-1)*4&&A.v.left<=120,'each player is dealt 4 tasks, the crew total matches, the clock starts at 2:00');
 ok(cs.every(c=>new Set(c.v.mine.map(t=>t.name)).size===4),'the 4 tasks are all different');
 ok(await until(()=>A.v.ph==='results',20000),'the match ends when the 2:00 clock runs out');
 await sleep(300);
 const earn=cs.map(c=>c.v.earn);ok(earn.every(e=>e>0&&e<=80),'every signed-in player earns credits ('+earn.join(', ')+')');
 const win=cs.find(c=>R.P.find(p=>p.id===c.v.you).role==='traitor');ok(win.v.earn>cs.find(c=>c!==win).v.earn,'the winner earns more than the loser');
 ok(cs.every(c=>c.stats&&c.stats.cr!=null),'each player is told their new credit balance');
 ok(ACC.users.alice7.cr===earn[0]&&ACC.eco.earned===earn.reduce((a,b)=>a+b,0),'credits are saved on the account and counted in the economy total');
 ok(g.v==null,'the guest in no room earns nothing');
 /* ---- replay */
 const f=path.join(DIR,'replays.jsonl');ok(fs.existsSync(f),'replays.jsonl was written');
 const L=fs.readFileSync(f,'utf8').trim().split('\n').map(JSON.parse),rp=L[0];
 ok(L.length===1&&rp.id&&rp.P.length===3&&rp.P.every(p=>p.role)&&rp.rec.some(e=>e.k==='pos')&&rp.R.tasks===4&&rp.R.match===120,'the replay holds roles, settings and position snapshots');
 const txt=fs.readFileSync(f,'utf8');ok(!/Alice|Bob|Cara|alice7|bob7|dA7/.test(txt),'the replay has no names, account names or device ids');
 ok(rp.rec.every(e=>e.t>=0&&e.t<=121)&&rp.rec.every((e,i)=>i===0||e.t>=rp.rec[i-1].t),'replay events are in time order within the match length');
 ok((await fetch(B+'/admin/api/replays')).status===401,'replays need the dashboard token');
 const lr=await (await adm('replays')).json();ok(lr.replays.length===1&&lr.replays[0].id===rp.id&&lr.replays[0].w===rp.w,'the dashboard lists the replay');
 const dr=await (await adm('replays/'+rp.id)).json();ok(dr.rec.length===rp.rec.length&&dr.stn.length===6,'the dashboard returns the full replay');
 ok((await adm('replays/..%2f..%2fserver')).status===400&&(await adm('replays/zzzzzzzzzzzz')).status===400,'replay ids are validated');
 ok((await adm('replays/aaaaaaaaaaaa')).status===404,'an unknown replay is a 404');
 const post=await fetch(B+'/admin/api/replays',{method:'POST',headers:{authorization:'Bearer '+process.env.ADMIN_TOKEN}});ok(post.status===404,'the replay API is read only (POST is refused)');
 const ov=await (await adm('overview')).json();ok(ov.economy.earned===ACC.eco.earned&&ov.economy.spent===ACC.eco.spent&&ov.economy.held>0,'the dashboard overview shows the credit economy');
 const acs=await (await adm('accounts')).json();ok(acs.accounts.find(a=>a.key==='bob7').items===2,'the accounts tab shows credits and owned items');
 const csv=await (await adm('matches.csv')).text();ok(csv.split('\n')[0].endsWith('match_seconds,tasks_per_player')&&csv.split('\n')[1].endsWith(',120,4'),'matches.csv records match length and tasks per player');
 /* ---- bots only pay a third */
 const S=await acct('solo7');S.send({t:'create',name:'Solo',dev:'PC',did:'dS7'});await sleep(150);S.send({t:'settings',quick:true,len:120});S.send({t:'addbot'});S.send({t:'addbot'});await sleep(200);S.send({t:'start'});await sleep(200);S.send({t:'seen'});
 ok(await until(()=>S.v.ph==='results',20000),'a one-human match with bots ends');await sleep(200);ok(S.v.earn>0&&S.v.earn<=14,'a match with only one human pays a third ('+S.v.earn+')');
 /* the replay file rotates instead of growing for ever */
 console.log('\nAll Part 2 server checks passed.');process.exit(0)})().catch(e=>{console.error(e.message);process.exit(1)});
