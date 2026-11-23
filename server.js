'use strict';
/* Traitor in the Room - server (stage 3, complete). The server decides everything; each player only
   receives their own role. Run: npm install && npm start  (then open http://localhost:8080) */
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),https=require('https');
const {WebSocketServer}=require('ws');
const PKG=(()=>{try{return require('./package.json')}catch(e){return{version:'0'}}})();
const PORT=+process.env.PORT||8080,SPEED=+process.env.SPEED||1,DATA=process.env.DATA_DIR||__dirname;
const GRACE=process.env.GRACE_MS!=null?+process.env.GRACE_MS:30000,ROT=+process.env.TOKEN_ROTATE_MS||600000,MAXROOMS=+process.env.MAX_ROOMS||1000;
const BOTSAB=process.env.BOT_SABOTAGE!=='0'; /* tests turn bot sabotage off so a random reactor failure cannot end a match mid-test */
const TALK=20,VOTE=15,TASKS=3,OFFLINE=90,PAIRMS=25000,PAIRHOLD=3000,CHATMAX=100;
/* Classic on = standard rules. Classic off = "fast and loud": shorter match, more meetings, more sabotage. */
/* host-adjustable in the lobby: len = match seconds (120-420 in steps of 30, null = follow the mode), tasks = tasks per player (1-5) */
const lenOk=v=>v!=null&&Number.isFinite(+v)?Math.min(420,Math.max(120,Math.round(+v/30)*30)):0,tasksOk=v=>{const n=Math.floor(+v);return Number.isFinite(n)?Math.min(5,Math.max(1,n)):3};
const rulesFor=s=>{const o={...(s.classic?{match:240,meet:2,sabMax:3,sabT:25,sabCd0:20,sabCd:45,atkMax:2,atkCd0:40,atkCd:60}:{match:180,meet:3,sabMax:4,sabT:20,sabCd0:15,sabCd:30,atkMax:3,atkCd0:30,atkCd:40}),roles:!!s.roles,medicWin:15};if(lenOk(s.len))o.match=lenOk(s.len);o.tasks=tasksOk(s.tasks);return o};
/* crew roles (only with the Special roles setting): uses -1 = unlimited, cd = seconds between uses. Traitor attacks exist only in this mode. */
const CLS={detective:{name:'Detective',uses:3,cd:25,desc:'Investigate a player for a limited suspicious-activity read.'},
  engineer:{name:'Engineer',uses:-1,cd:30,desc:'Repairs the reactor faster and opens maintenance panels to see how busy each station is.'},
  guardian:{name:'Guardian',uses:1,cd:0,desc:'Shield one player from one attack, once per match.'},
  scientist:{name:'Scientist',uses:3,cd:0,desc:'Analyze a sabotage to learn where it came from (two possible stations).'},
  scout:{name:'Scout',uses:4,cd:20,desc:'Track where a player has recently been.'},
  medic:{name:'Medic',uses:2,cd:0,desc:'Save an attacked player during a short window.'}};
const STN=['Reactor','Engine','Lab','Bridge','Cargo','Medbay'];
/* credits shop: cosmetic only (avatar rings and name titles). Nothing here changes how a match plays. */
const SHOP=[{id:'fr_gold',kind:'frame',name:'Gold ring',price:120},{id:'fr_neon',kind:'frame',name:'Neon ring',price:120},{id:'fr_rose',kind:'frame',name:'Rose ring',price:150},{id:'fr_ice',kind:'frame',name:'Ice ring',price:150},{id:'fr_dash',kind:'frame',name:'Dashed ring',price:200},
  {id:'ti_sleuth',kind:'title',name:'Sleuth',price:80},{id:'ti_owl',kind:'title',name:'Night Owl',price:80},{id:'ti_talker',kind:'title',name:'Smooth Talker',price:150},{id:'ti_hero',kind:'title',name:'Reactor Hero',price:150}],SHOPBY=Object.fromEntries(SHOP.map(i=>[i.id,i]));
const COL=['#FF7A8A','#FFB36B','#FFD84D','#A3E86B','#4DE8B0','#5CC8FF','#8E9CFF','#C49BFF'];
const BOTN=['Ravi','Meera','Dev','Isha','Kabir','Nila','Om','Zara'];
/* task catalog: [id, name, station, type, pcOnly]. Minimum solo time per type is enforced here. */
const CT=[['c1','Echo the pulse','Reactor','echo'],['c2','Spot the lie','Bridge','lie'],['c3','Afterimage','Lab','after'],['c4','Trace the signal','Engine','trace'],
  ['c5','Alibi check','Medbay','alibi'],['c6','Unscramble the alibi','Bridge','cipher'],['c7','Headcount','Cargo','count'],['c8','Mind trap','Lab','ink'],
  ['c9','Echo the heartbeat','Medbay','echo'],['c10','Catch the liar','Cargo','lie'],['c11','Flash memory','Reactor','after'],['c12','Follow the route','Cargo','trace'],
  ['c13','Who was where','Engine','alibi'],['c14','Crack the passphrase','Reactor','cipher'],['c15','Count the shadows','Engine','count'],['c16','Ink test','Medbay','ink']];
/* traitor tasks look like normal tasks but do not count for the crew; each one finished trims the sabotage cooldown by 8 s */
const TT=[['x1','Check the logs','Bridge','alibi'],['x2','Wipe the console','Bridge','ink'],['x3','Test the lamps','Lab','echo'],['x4','Count the vials','Medbay','count'],
  ['x5','Tune the radio','Lab','trace'],['x6','Read the gauges','Reactor','lie'],['x7','Oil the hinges','Engine','after'],['x8','Park the cart','Cargo','cipher']];
const MIN={echo:4500,lie:1500,after:3500,trace:1800,alibi:5500,cipher:2500,count:4200,ink:2500};
const mk=a=>({id:a[0],name:a[1],st:a[2],type:a[3],pc:!!a[4]});
const CREW_T=CT.map(mk),TRAI_T=TT.map(mk);
const REPORTS=path.join(DATA,'reports.jsonl'),MATCHES=path.join(DATA,'matches.jsonl'),REPLAYS=path.join(DATA,'replays.jsonl');
const rooms=new Map(),rnd=n=>Math.floor(Math.random()*n),pick=a=>a[rnd(a.length)];
const clean=(s,n)=>String(s==null?'':s).replace(/[<>&"'`\x00-\x1f]/g,'').trim().slice(0,n);
const filt=s=>s.replace(/\b(idiot|stupid|dumb|ugly|hate|loser|shut up|kys|kill yourself)\b/gi,'***');
const cleanChat=s=>filt(String(s==null?'':s).replace(/[<>&"`\x00-\x1f]/g,' ')
  .replace(/(https?:\/\/|www\.)\S+/gi,'[link]').replace(/\S+@\S+\.\S+/g,'[email]')
  .replace(/\+?\d[\d\s().-]{6,}\d/g,'[number]').replace(/\s+/g,' ').trim().slice(0,CHATMAX));
const mmss=s=>{s=Math.max(0,Math.ceil(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const sha=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq=(a,b)=>{a=Buffer.from(String(a));b=Buffer.from(String(b));return a.length===b.length&&crypto.timingSafeEqual(a,b)};

/* ---------- error monitoring (Sentry is optional) ---------- */
let Sentry=null;
if(process.env.SENTRY_DSN){try{Sentry=require('@sentry/node');
  Sentry.init({dsn:process.env.SENTRY_DSN,environment:process.env.SENTRY_ENV||process.env.NODE_ENV||'production',release:'traitor-in-the-room@'+PKG.version,
    sendDefaultPii:false,tracesSampleRate:0,beforeSend(ev){delete ev.request;delete ev.user;return ev}});console.log('Sentry error reporting is on')}
  catch(e){Sentry=null;console.warn('SENTRY_DSN is set but @sentry/node is not installed. Run: npm i @sentry/node')}}
const fail=(e,ctx)=>{if(ctx&&ctx.k==='client')console.error('client error report:',e.message,'('+ctx.src+')');else console.error(e&&e.stack||e);if(Sentry)try{Sentry.withScope(s=>{s.setContext('game',ctx||{});Sentry.captureException(e instanceof Error?e:new Error(String(e)))})}catch(x){}};
if(!Sentry){process.on('unhandledRejection',e=>console.error('unhandledRejection',e));process.on('uncaughtException',e=>{console.error(e);process.exit(1)})}

/* ---------- accounts (optional, guests still work) ---------- */
const ACCF=path.join(DATA,'accounts.json');let ACC={users:{}};try{ACC=JSON.parse(fs.readFileSync(ACCF,'utf8'))}catch(e){}
if(!ACC.users)ACC.users={};if(!ACC.eco)ACC.eco={earned:0,spent:0};
let accT=null;const accSave=()=>{if(accT)return;accT=setTimeout(()=>{accT=null;try{fs.writeFileSync(ACCF+'.tmp',JSON.stringify(ACC));fs.renameSync(ACCF+'.tmp',ACCF)}catch(e){fail(e,{k:'accSave'})}},1000)};
/* moderation: reviewed reports and suspended accounts/devices, edited from the creator dashboard */
const MODF=path.join(DATA,'moderation.json');let MOD={reviewed:{},bans:{acct:{},did:{}}};try{const o=JSON.parse(fs.readFileSync(MODF,'utf8'));MOD={reviewed:o.reviewed||{},bans:{acct:(o.bans&&o.bans.acct)||{},did:(o.bans&&o.bans.did)||{}}}}catch(e){}
let modT=null;const modSave=()=>{if(modT)return;modT=setTimeout(()=>{modT=null;try{fs.writeFileSync(MODF+'.tmp',JSON.stringify(MOD));fs.renameSync(MODF+'.tmp',MODF)}catch(e){fail(e,{k:'modSave'})}},500)};
const banned=(did,acct)=>!!((did&&MOD.bans.did[did])||(acct&&MOD.bans.acct[acct]));
const ipOf=req=>(process.env.TRUST_PROXY&&String(req.headers['x-forwarded-for']||'').split(',')[0].trim())||req.socket.remoteAddress||'?';
function enforce(){rooms.forEach(r=>r.P.slice().forEach(p=>{if(p.bot||!banned(p.did,p.acct))return;const w=p.ws;
  if(r.ph==='lobby')removeP(r,p.id);else if(r.G&&p.alive){p.alive=false;r.G.log.push({t:r.G.left,txt:p.name+' left the match'});ev(r,'out',p.id);chk(r)}
  p.ws=null;p.online=false;p.token=null;if(w){w.p=null;err(w,'This account or device has been suspended.',true);w.close()}}))}
const SESSMS=30*864e5,fails=new Map();let scryptBusy=0;
const hashPw=(pw,salt)=>new Promise((res,rej)=>crypto.scrypt(pw,salt,32,{N:16384},(e,k)=>e?rej(e):res(k.toString('hex'))));
const stats=u=>({games:u.games,wins:u.wins,tasks:u.tasks});
function newSess(u){const t=crypto.randomBytes(24).toString('hex'),now=Date.now();u.sess=(u.sess||[]).filter(s=>s.exp>now).slice(-4);u.sess.push({h:sha(t),exp:now+SESSMS});return t}
const GID=process.env.GOOGLE_CLIENT_ID||'';
const cleanPic=x=>{x=String(x||'');return /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]{20,5500}$/.test(x)?x:''};
const acctOut=(ws,u,sess)=>out(ws,{t:'acct',user:u.name,nick:u.nick||'',pic:u.pic||'',sess,stats:stats(u),cr:u.cr||0,own:u.own||[],eq:{frame:(u.eq&&u.eq.frame)||'',title:(u.eq&&u.eq.title)||''},shop:SHOP});
const cosOf=p=>{const u=p.acct&&ACC.users[p.acct],e=(u&&u.eq)||{};return{fr:SHOPBY[e.frame]?e.frame:'',ti:SHOPBY[e.title]?SHOPBY[e.title].name:''}};
/* credits per match: 10 for playing, +20 for a win, +3 per task (max 15), +3 per correct vote (max 6), +10 for MVP; max 80.
   A match with fewer than two humans or under a minute pays one third, so bots cannot be farmed. */
const credit=(p,w,mvp,full)=>{const win=(w==='crew')===(p.role==='crew');const n=10+(win?20:0)+Math.min(15,p.done*3)+Math.min(6,p.correct*3)+(mvp.id===p.id?10:0);return Math.min(80,full?n:Math.ceil(n/3))};
function gauth(ws,m){if(!GID)return err(ws,'Google sign-in is not set up on this server.');
  const cred=String(m.cred||'');if(cred.length<100||cred.length>4000||!/^[\w.-]+$/.test(cred))return err(ws,'Google sign-in failed.');
  https.get('https://oauth2.googleapis.com/tokeninfo?id_token='+cred,r=>{let d='';r.on('data',c=>{d+=c;if(d.length>8000)r.destroy()});
    r.on('end',()=>{try{const o=JSON.parse(d);if(r.statusCode!==200||o.aud!==GID||!(o.email_verified==='true'||o.email_verified===true)||!o.sub)return err(ws,'Google sign-in failed.');
      const key='g'+sha('g:'+o.sub).slice(0,12);if(MOD.bans.acct[key])return err(ws,'This account is suspended.');
      let u=ACC.users[key];if(!u){if(Object.keys(ACC.users).length>=5000)return err(ws,'Registration is closed.');
        u=ACC.users[key]={name:key,google:true,sess:[],games:0,wins:0,tasks:0,created:Date.now(),nick:clean(o.given_name||o.name||'',12)}}
      ws.acct=key;acctOut(ws,u,newSess(u));accSave()}catch(e){err(ws,'Google sign-in failed.')}})}).on('error',()=>err(ws,'Google sign-in failed.'))}
function auth(ws,m){const name=clean(m.user,16),pw=String(m.pass==null?'':m.pass),key=name.toLowerCase(),fk=key+'|'+ws.ip;
  if(MOD.bans.acct[key])return err(ws,'This account is suspended.');
  if(m.t==='register'){if(!/^[A-Za-z0-9_]{3,16}$/.test(name))return err(ws,'Account name: 3-16 letters, numbers or _.');
    if(pw.length<8||pw.length>64)return err(ws,'Password must be 8-64 characters.');if(ACC.users[key])return err(ws,'That account name is taken.');
    if(Object.keys(ACC.users).length>=5000)return err(ws,'Registration is closed.')}
  const f=fails.get(fk)||{n:0,until:0};if(Date.now()<f.until)return err(ws,'Too many tries. Wait a minute.');
  if(scryptBusy>=6)return err(ws,'Server is busy. Try again.');scryptBusy++;
  if(m.t==='register'){const salt=crypto.randomBytes(16).toString('hex');
    hashPw(pw,salt).then(h=>{scryptBusy--;if(ACC.users[key])return err(ws,'That account name is taken.');
      const u=ACC.users[key]={name,salt,hash:h,sess:[],games:0,wins:0,tasks:0,created:Date.now()};ws.acct=key;acctOut(ws,u,newSess(u));accSave()}).catch(e=>{scryptBusy--;fail(e)})}
  else{const u=ACC.users[key];
    hashPw(pw,u&&u.salt?u.salt:'0'.repeat(32)).then(h=>{scryptBusy--;
      if(!u||!u.hash||!safeEq(h,u.hash)){f.n++;if(f.n>=5){f.until=Date.now()+60000;f.n=0}fails.set(fk,f);return err(ws,'Wrong name or password.')}
      fails.delete(fk);ws.acct=key;acctOut(ws,u,newSess(u));accSave()}).catch(e=>{scryptBusy--;fail(e)})}}

/* ---------- rooms and players ---------- */
function newRoom(){let c;do c=Array.from({length:4},()=>'ABCDEFGHJKMNPQRSTWXZ'[rnd(20)]).join('');while(rooms.has(c));
  const r={code:c,host:-1,P:[],ph:'lobby',set:{quick:false,classic:true,reveal:null,max:8,roles:true,len:null,tasks:3},G:null,cd:0,ej:0,idle:0,mid:0,ban:new Set(),chat:{lobby:[],meet:[],ghost:[],traitor:[]}};rooms.set(c,r);return r}
function addP(r,o){if(r.P.length>=r.set.max)return null;const used=new Set(r.P.map(p=>p.id));let id=0;while(used.has(id))id++;if(id>7)return null;
  const p={id,name:o.bot?BOTN[id]:(clean(o.name,12)||'Player'),col:COL[id],shp:id,dev:o.dev==='PC'?'PC':'Phone',bot:!!o.bot,ws:null,online:!!o.bot,off:0,acct:o.acct||null,pic:cleanPic(o.pic)||(o.acct&&ACC.users[o.acct]&&ACC.users[o.acct].pic)||'',
    token:o.bot?null:crypto.randomBytes(16).toString('hex'),prev:null,tokAt:Date.now(),did:clean(o.did,40),seen:!!o.bot,aids:new Set(),role:'crew',alive:true,done:0,mine:[],st:'',trail:[],sus:0,correct:0,cur:null,fixT:0,lastChat:0,help:0,hold:null,mu:new Set(),strikes:0,chatOff:false,cls:null,ab:null,notes:[],down:null,shield:false,shieldBy:-1,saveT:0,earn:null};
  r.P.push(p);r.P.sort((a,b)=>a.id-b.id);if(r.host<0&&!p.bot)r.host=p.id;return p}
function removeP(r,id){r.P=r.P.filter(p=>p.id!==id);if(r.host===id){const h=r.P.find(p=>!p.bot&&p.online);r.host=h?h.id:-1}}
function rotate(p){p.prev={t:p.token,until:Date.now()+GRACE};p.token=crypto.randomBytes(16).toString('hex');p.tokAt=Date.now()}
function dealTasks(p,k){k=k||TASKS;const pool=(p.role==='traitor'?TRAI_T:CREW_T).filter(t=>!t.pc||p.dev==='PC').sort(()=>Math.random()-.5),o=[];
  pool.forEach(t=>{if(o.length<k&&!o.some(x=>x.type===t.type||x.st===t.st))o.push(t)});
  pool.forEach(t=>{if(o.length<k&&!o.includes(t))o.push(t)});return o.map(t=>({id:t.id,name:t.name,st:t.st,type:t.type,done:false}))}

/* ---------- rules ---------- */
function start(r){const n=r.P.length,min=r.set.quick?3:5;if(n<min)return 'Need at least '+min+' players to start.';
  const tc=n>=8?2:1,idx=r.P.map((_,i)=>i).sort(()=>Math.random()-.5),T=new Set(idx.slice(0,tc)),R=rulesFor(r.set);
  r.chat.meet=[];r.chat.ghost=[];r.chat.traitor=[];
  r.P.forEach((p,i)=>{p.role=T.has(i)?'traitor':'crew';p.alive=true;p.done=0;p.sus=0;p.correct=0;p.cur=null;p.st=pick(STN);p.trail=[{t:R.match,st:p.st}];p.seen=p.bot;p.off=0;p.help=0;p.hold=null;p.strikes=0;p.chatOff=false;p.cls=null;p.ab=null;p.notes=[];p.down=null;p.shield=false;p.shieldBy=-1;p.earn=null;p.mine=dealTasks(p,R.tasks)});
  if(r.set.roles){const crew=r.P.filter(p=>p.role==='crew').sort(()=>Math.random()-.5),cl=Object.keys(CLS).sort(()=>Math.random()-.5);
    crew.forEach((p,i)=>{if(cl[i]){p.cls=cl[i];p.ab={uses:CLS[cl[i]].uses,cd:0,seen:new Set()}}})}
  r.G={R,left:R.match,total:(n-tc)*R.tasks,rec:[],recNx:0,tc,done:0,meet:R.meet,mcd:0,sab:null,sabCd:R.sabCd0,sabUsed:0,log:[],mt:null,eject:null,end:null,votes:{},pairs:[],pl:[],sabs:[],atkCd:R.atkCd0,atkUsed:0,saves:0,elims:0};
  r.ph='reveal';r.cd=0;return null}
/* ---------- match recorder (feeds the read-only replay in the creator dashboard; no chat, no names) ---------- */
const sti=s=>Math.max(0,STN.indexOf(s)),rsec=G=>Math.round((G.R.match-G.left)*10)/10;
function ev(r,k,a,b,x){const G=r.G;if(!G||!G.rec||G.rec.length>900)return;const e={t:rsec(G),k};if(a!=null)e.a=a;if(b!=null)e.b=b;if(x!=null)e.x=x;G.rec.push(e)}
function snap(r){const G=r.G;if(G&&G.rec&&G.rec.length<=900)G.rec.push({t:rsec(G),k:'pos',s:r.P.map(p=>p.alive?sti(p.st):-1)})}
function saveReplay(r,rid,w,why,mvp,secs){const G=r.G;try{const o={id:rid,ts:new Date().toISOString(),room:r.code,w,why,secs,mvp:mvp.id,n:r.P.length,humans:r.P.filter(p=>!p.bot).length,classic:!!r.set.classic,
    R:{match:G.R.match,meet:G.R.meet,tasks:G.R.tasks,sabMax:G.R.sabMax,roles:G.R.roles},total:G.total,stn:STN,
    P:r.P.map(p=>({i:p.id,role:p.role,cls:p.cls,col:p.col,bot:p.bot,dev:p.dev,done:p.done,correct:p.correct,help:p.help})),rec:G.rec};
  try{if(fs.statSync(REPLAYS).size>8e6)fs.renameSync(REPLAYS,REPLAYS+'.old')}catch(e){}
  fs.appendFile(REPLAYS,JSON.stringify(o)+'\n',()=>{})}catch(e){fail(e,{k:'replay'})}}
function chk(r){const G=r.G;if(G.end)return;const a=r.P.filter(p=>p.alive),t=a.filter(p=>p.role==='traitor').length,c=a.length-t;
  if(G.done>=G.total)end(r,'crew','All crew tasks are finished.');
  else if(!t)end(r,'crew','Every traitor was voted out.');
  else if(G.left<=0)end(r,'traitor','Time ran out with the traitor still hidden.');
  else if(t>=c)end(r,'traitor','Traitors now equal the crew.')}
function end(r,w,why){const G=r.G;if(G.end)return;const rid=crypto.randomBytes(6).toString('hex');const sc=p=>p.done*2+p.correct*3+p.help;let b=r.P[0];r.P.forEach(p=>{if(sc(p)>sc(b))b=p});
  G.end={w,why,mvp:b.id};G.sab=null;G.mt=null;G.pairs=[];r.ph='results';
  const humans=r.P.filter(p=>!p.bot).length,secs=Math.round(G.R.match-Math.max(0,G.left)),full=humans>=2&&secs>=60;saveReplay(r,rid,w,why,b,secs);
  fs.appendFile(MATCHES,JSON.stringify({ts:new Date().toISOString(),room:r.code,n:r.P.length,humans:r.P.filter(p=>!p.bot).length,w,why,secs:Math.round(G.R.match-Math.max(0,G.left)),done:G.done,total:G.total,sabs:G.sabUsed,meets:G.R.meet-G.meet,classic:!!r.set.classic,quick:!!r.set.quick,roles:!!r.set.roles,atks:G.atkUsed,saves:G.saves,elims:G.elims,rid,len:G.R.match,tpp:G.R.tasks})+'\n',()=>{});
  r.P.forEach(p=>{if(!p.acct||p.bot)return;const u=ACC.users[p.acct];if(!u)return;u.games++;if((w==='crew')===(p.role==='crew'))u.wins++;u.tasks+=p.done;const n=credit(p,w,b,full);p.earn=n;u.cr=(u.cr||0)+n;ACC.eco.earned+=n;if(p.ws)out(p.ws,{t:'stats',stats:stats(u),cr:u.cr})});accSave()}
const clearedIds=(G,s)=>new Set(G.pl.filter(x=>x.l0>=s.t&&s.t>=x.to).flatMap(x=>[x.a,x.b]));
function note(r,p,txt){if(!r.G)return;p.notes.push({t:r.G.R.match-r.G.left,txt});if(p.notes.length>14)p.notes.shift()}
function die(r,p){const G=r.G;ev(r,'elim',p.id,null,sti(p.st));p.down=null;p.alive=false;G.elims++;G.log.push({t:G.left,txt:p.name+' was eliminated at '+p.st});note(r,p,'You were eliminated. You can still finish your tasks as a ghost.');chk(r)}
function saveDown(r,med,v){const G=r.G;ev(r,'save',med.id,v.id);v.down=null;if(med.ab.uses>0)med.ab.uses--;G.saves++;med.help+=2;med.st=v.st;med.trail.push({t:G.left,st:v.st});note(r,v,'A medic saved you.');note(r,med,'You saved '+v.name+' at '+v.st+'.')}
function doAttack(r,p,t){const G=r.G;ev(r,t.shield?'block':'atk',p.id,t.id,sti(t.st));G.atkCd=G.R.atkCd;G.atkUsed++;
  if(t.shield){t.shield=false;const g=r.P.find(q=>q.id===t.shieldBy);note(r,p,'Your attack failed: the target was protected.');note(r,t,'Something protected you from an attack.');
    if(g){g.help+=2;if(g!==t)note(r,g,'Your shield held. '+t.name+' was attacked at '+t.st+'.')}return}
  t.down={left:G.R.medicWin};t.cur=null;t.hold=null;note(r,t,'You were attacked! A medic has '+G.R.medicWin+' seconds to save you.');
  note(r,p,'You attacked '+t.name+'. If no medic reaches them in time they are eliminated.')}
const alone=(r,p)=>!r.P.some(q=>q!==p&&q.alive&&q.st===p.st);
const canPair=(r,p)=>p.alive&&r.P.some(q=>q!==p&&q.alive);
const pairOf=(G,p)=>G.pairs.find(x=>x.a===p.id||x.b===p.id);
const dropPair=(G,x)=>{G.pairs=G.pairs.filter(y=>y!==x)};
const canSee=(r,p,ch)=>ch==='lobby'?r.ph==='lobby':!r.G?false:ch==='meet'?true:ch==='ghost'?!p.alive:ch==='traitor'?p.role==='traitor':false;
function addMsg(r,p,txt,ch){const a=r.chat[ch];a.push({id:++r.mid,pid:p.id,txt,ch,rep:new Set(),hid:false,hb:false});if(a.length>(ch==='lobby'?60:40))a.shift()}
function taskDone(r,p,t){const G=r.G;ev(r,'task',p.id,null,[sti(t.st),p.role==='crew'?1:0]);t.done=true;p.cur=null;if(p.role==='crew'){p.done++;G.done++}else G.sabCd=Math.max(0,G.sabCd-8);chk(r)}
function pairDone(r,x){const G=r.G,a=r.P.find(p=>p.id===x.a),b=r.P.find(p=>p.id===x.b),t=a.mine[x.i];
  ev(r,'pair',a.id,b.id,sti(x.st));a.hold=b.hold=null;b.help++;G.pl.push({a:a.id,b:b.id,st:x.st,l0:x.l0,to:G.left});
  G.log.push({t:G.left,txt:a.name+' and '+b.name+' worked together at '+x.st});dropPair(G,x);taskDone(r,a,t)}
function doSab(r,by){const G=r.G;ev(r,'sab',by?by.id:null,null,sti(by?by.st:''));G.sab={until:G.left-G.R.sabT,fixIn:6+rnd(8)};G.sabUsed++;G.sabCd=G.R.sabCd;G.sabs.push({t:G.left,by:by?by.id:-1,st:by?by.st:'',an:false});G.log.push({t:G.left,txt:'Reactor unsafe at '+mmss(G.R.match-G.left)})}
function fix(r){const G=r.G;ev(r,'fix');G.log.push({t:G.left,txt:'Reactor made safe at '+mmss(G.R.match-G.left)});G.sab=null}
function meeting(r,by){const G=r.G;ev(r,'meet',by?by.id:null);snap(r);G.meet--;G.mcd=30;G.mt={k:'talk',left:TALK};r.chat.meet=[];G.votes={};G.pairs=[];r.P.forEach(p=>{p.cur=null;p.hold=null});r.ph='meeting';
  r.P.filter(p=>p.bot&&p.alive).sort(()=>Math.random()-.5).slice(0,3).forEach((b,i)=>setTimeout(()=>{
    if(r.G!==G||r.ph!=='meeting'||!G.mt||G.mt.k!=='talk')return;const o=pick(r.P.filter(p=>p.alive&&p!==b)),st=b.role==='traitor'?pick(STN):b.st;
    addMsg(r,b,pick([`I was at ${st}.`,`I saw ${o.name} near ${st}.`,`Nothing odd at ${st}.`]),'meet')},(2500+i*4500)/SPEED))}
function tally(r){const G=r.G,al=r.P.filter(p=>p.alive),tv={};let skip=0;
  al.forEach(p=>{if(p.down)return;let v=null;if(!p.bot)v=G.votes[p.id];else{const o=al.filter(x=>x!==p);
    if(p.role==='traitor'){const c=o.filter(x=>x.role==='crew');v=Math.random()<.3?'skip':pick(c.length?c:o).id}
    else{const s=o.filter(x=>x.sus>0);v=Math.random()<.3?'skip':(s.length&&Math.random()<.6?pick(s).id:pick(o).id)}}
    p.v=v;if(v==null||v==='skip')skip++;else tv[v]=(tv[v]||0)+1});
  const e=Object.entries(tv).sort((a,b)=>b[1]-a[1]);let o=null;
  if(e.length&&e[0][1]>skip&&(!e[1]||e[1][1]<e[0][1]))o=r.P.find(p=>p.id===+e[0][0]);
  const rev=r.set.reveal==null?G.tc===1:r.set.reveal;
  if(o){o.alive=false;if(o.role==='traitor')al.forEach(p=>{if(p.v===o.id)p.correct++})}
  G.log.push({t:G.left,txt:o?o.name+' was voted out':'No one was voted out (tie or skip)'});
  ev(r,'vote',null,null,al.filter(p=>!p.down).map(p=>[p.id,p.v==null?'skip':p.v]));ev(r,'eject',o?o.id:null);
  G.eject={out:o?{id:o.id,name:o.name,col:o.col,shp:o.shp,role:rev?o.role:null}:null,reveal:rev,skip};
  G.mt=null;G.votes={};r.ph='eject';r.ej=3.6}

/* ---------- clock ---------- */
function tick(r,dt){const G=r.G,H=r.P.filter(p=>!p.bot);
  H.forEach(p=>{p.off=p.online?0:p.off+dt});
  if(!H.some(p=>p.online)){r.idle+=dt;if(r.idle>300)rooms.delete(r.code);return}r.idle=0;
  const hp=r.P.find(p=>p.id===r.host);if(!hp||!hp.online){const h=H.find(p=>p.online);if(h)r.host=h.id}
  if(!G)return;
  if(['play','meeting','eject'].includes(r.ph)){H.forEach(p=>{if(p.alive&&p.off>OFFLINE){p.alive=false;G.log.push({t:G.left,txt:p.name+' left the match'});ev(r,'out',p.id)}});chk(r)}
  if(r.ph==='reveal'){const on=H.filter(p=>p.online);
    if(r.cd>0){r.cd-=dt;if(r.cd<=0){r.cd=0;r.ph='play'}}else if(on.length&&on.every(p=>p.seen))r.cd=3}
  else if(r.ph==='play'){G.left-=dt;G.mcd=Math.max(0,G.mcd-dt);G.sabCd=Math.max(0,G.sabCd-dt);
    if(rsec(G)>=G.recNx){snap(r);G.recNx=Math.floor(rsec(G)/6)*6+6}
    r.P.forEach(p=>{if(!p.bot)return;
      if(p.role==='crew'&&p.done<G.R.tasks&&Math.random()<dt/22){p.done++;G.done++;ev(r,'task',p.id,null,[sti(p.st),1])}   /* ghost bots keep working too */
      if(!p.alive||p.down)return;const paired=G.pairs.some(x=>x.b===p.id);
      if(!paired&&Math.random()<dt/18){p.st=pick(STN);p.trail.push({t:G.left,st:p.st})}
      if(BOTSAB&&!paired&&p.role==='traitor'&&!G.sab&&G.sabCd<=0&&G.sabUsed<G.R.sabMax&&Math.random()<dt/60)doSab(r,p);
      if(BOTSAB&&G.R.roles&&p.role==='traitor'&&!p.down&&!paired&&G.atkCd<=0&&G.atkUsed<G.R.atkMax&&Math.random()<dt/25){const near=r.P.filter(q=>q!==p&&q.alive&&q.st===p.st);if(near.length===1&&near[0].role!=='traitor'&&!near[0].down)doAttack(r,p,near[0])}
      if(p.cls==='guardian'&&p.ab.uses>0&&Math.random()<dt/40){const o=pick(r.P.filter(q=>q.alive));o.shield=true;o.shieldBy=p.id;p.ab.uses=0}});
    G.atkCd=Math.max(0,G.atkCd-dt);r.P.forEach(p=>{if(p.ab&&p.ab.cd>0)p.ab.cd=Math.max(0,p.ab.cd-dt)});
    r.P.forEach(p=>{if(!p.down||!p.alive)return;p.down.left-=dt;const med=r.P.find(q=>q.bot&&q.cls==='medic'&&q.alive&&!q.down&&q.ab.uses>0);
      if(med){if(p.down.will==null){p.down.will=Math.random()<.7;p.down.reactAt=G.R.medicWin-(2+rnd(5))}if(p.down.will&&p.down.left<=p.down.reactAt){saveDown(r,med,p);return}}
      if(p.down.left<=0)die(r,p)});
    const now=Date.now();G.pairs=G.pairs.filter(x=>{const a=r.P.find(p=>p.id===x.a);if(!a||!a.alive||now-x.t0>PAIRMS){if(a)a.cur=null;return false}
      if(x.b!=null){const b=r.P.find(p=>p.id===x.b);if(!b||!b.alive||!b.online&&!b.bot){x.b=null;x.fin={};x.t0=now}}
      if(x.b==null&&now>=x.botAt){const bs=r.P.filter(q=>q.bot&&q.alive&&q.id!==x.a&&!G.pairs.some(y=>y.b===q.id));
        if(bs.length){const b=pick(bs);x.b=b.id;x.tj=now;x.t0=now;x.l0=G.left;b.st=x.st;b.trail.push({t:G.left,st:x.st})}}return true});
    if(G.sab){G.sab.fixIn-=dt;if(G.sab.fixIn<=0&&!H.some(p=>p.online&&p.alive&&p.role==='crew'))fix(r);
      if(G.sab&&G.left<G.sab.until)return end(r,'traitor','The reactor was not fixed in time.')}
    chk(r)}
  else if(r.ph==='meeting'){const m=G.mt;m.left-=dt;if(m.left<=0){if(m.k==='talk')G.mt={k:'vote',left:VOTE};else tally(r)}}
  else if(r.ph==='eject'){r.ej-=dt;if(r.ej<=0){chk(r);if(!G.end)r.ph='play'}}}

/* ---------- what each player may see ---------- */
function mapMsgs(r,me,ch){return r.chat[ch].filter(m=>!me.mu.has(m.pid)).map(m=>{if(m.hid)return{id:m.id,hid:true,hb:m.hb};const s=r.P.find(q=>q.id===m.pid);
  return{id:m.id,pid:m.pid,name:s?s.name:'?',col:s?s.col:'#888',txt:m.txt,bot:!!(s&&s.bot),mine:m.pid===me.id,rep:m.rep.has(me.id)}})}
function view(r,me){const G=r.G,rv=r.ph==='results';
  const P=r.P.map(p=>{const know=G&&(p===me||rv||(me.role==='traitor'&&p.role==='traitor'));
    const o={id:p.id,name:p.name,pic:p.pic||'',...cosOf(p),col:p.col,shp:p.shp,cls:G&&(p===me||rv)?p.cls:null,dev:p.dev,bot:p.bot,online:p.online,alive:p.alive,done:G&&(p===me||rv)?p.done:0,role:know?p.role:'?',
      trail:G&&r.ph==='meeting'&&p.alive?p.trail.slice(-3):[]};if(p===me)o.st=p.st;return o});
  const v={code:r.code,you:me.id,host:r.host,ph:r.ph,set:r.set,R:G?G.R:rulesFor(r.set),P,cd:Math.max(0,r.cd),ready:me.seen,log:[],mine:[],msgs:[],gmsgs:[],tmsgs:[],left:0,total:0,done:0,meet:0,mcd:0,
    sab:null,sabCd:0,sabUsed:0,alone:0,phase:null,eject:null,end:null,correct:0,canPair:false,pairs:[],mypair:null,pl:[],cleared:[],notes:[],down:null,downs:[],ab:null,atk:null,muted:[...me.mu],chatOff:me.chatOff,earn:me.earn};
  if(r.ph==='lobby')v.msgs=mapMsgs(r,me,'lobby');
  if(G)Object.assign(v,{left:G.left,total:G.total,done:G.done,meet:G.meet,mcd:G.mcd,sab:G.sab?{left:G.left-G.sab.until}:null,sabCd:G.sabCd,sabUsed:G.sabUsed,
    alone:me.role==='traitor'&&alone(r,me)?100:0,log:G.log,mine:me.mine.map(t=>({name:t.name,st:t.st,type:t.type,done:t.done})),phase:G.mt,eject:G.eject,end:G.end,correct:me.correct,canPair:canPair(r,me),
    msgs:mapMsgs(r,me,'meet'),gmsgs:me.alive?[]:mapMsgs(r,me,'ghost'),tmsgs:me.role==='traitor'?mapMsgs(r,me,'traitor'):[],
    pl:G.pl.map(x=>({a:x.a,b:x.b,st:x.st,t:G.R.match-x.l0})),
    cleared:G.sabs.map(s=>({t:G.R.match-s.t,ids:[...clearedIds(G,s)]}))});
  v.notes=me.notes.map(n=>({t:n.t,txt:n.txt}));v.down=me.down?{left:Math.ceil(me.down.left)}:null;
  if(G&&me.cls){const a=me.ab,ls=G.sabs[G.sabs.length-1];v.ab={cls:me.cls,name:CLS[me.cls].name,desc:CLS[me.cls].desc,uses:a.uses,cd:Math.ceil(a.cd),seen:[...a.seen],can:me.cls==='scientist'?!!(ls&&!ls.an&&(G.sab||ls.t-G.left<=45)):true}}
  if(G&&r.ph==='play'&&me.cls==='medic'&&me.alive&&!me.down)v.downs=r.P.filter(p=>p.down&&p.alive).map(p=>({id:p.id,name:p.name,st:p.st,left:Math.ceil(p.down.left)}));
  if(G&&G.R.roles&&me.role==='traitor'){const near=r.P.filter(q=>q!==me&&q.alive&&q.st===me.st),t=me.alive&&!me.down&&!pairOf(G,me)&&near.length===1&&near[0].role!=='traitor'&&!near[0].down?near[0]:null;
    v.atk={cd:Math.ceil(G.atkCd),used:G.atkUsed,max:G.R.atkMax,target:t?{id:t.id,name:t.name}:null}}
  if(G&&r.ph==='play'){const nm=id=>(r.P.find(q=>q.id===id)||{}).name,left=x=>Math.max(0,Math.ceil((PAIRMS-(Date.now()-x.t0))/1000));
    v.pairs=me.alive?G.pairs.filter(x=>x.b==null&&x.a!==me.id).map(x=>({a:x.a,name:nm(x.a),st:x.st,task:r.P.find(q=>q.id===x.a).mine[x.i].name,left:left(x)})):[];
    const x=pairOf(G,me);if(x)v.mypair={mine:x.a===me.id,i:x.i,st:x.st,task:r.P.find(q=>q.id===x.a).mine[x.i].name,a:nm(x.a),partner:x.b==null?null:nm(x.b),left:left(x)}}
  return v}
const out=(ws,o)=>{if(ws&&ws.readyState===1)ws.send(JSON.stringify(o))};
const err=(ws,msg,fatal)=>out(ws,{t:'err',msg,fatal});
const bc=r=>r.P.forEach(p=>{if(p.ws)out(p.ws,{t:'state',v:view(r,p)})});

/* ---------- messages ---------- */
function attach(ws,r,p){if(p.ws&&p.ws!==ws){const old=p.ws;old.p=null;err(old,'You signed in on another device.',true);old.close()}
  p.ws=ws;p.online=true;p.off=0;ws.p=p;ws.r=r;out(ws,{t:'joined',code:r.code,token:p.token});bc(r)}
function handle(ws,m){
  if(m.t==='ping')return;
  if(m.t==='cerr'){if((ws.cerr=(ws.cerr||0)+1)<=3)fail(new Error('client: '+clean(m.msg,160)),{k:'client',src:clean(m.src,60)});return}
  if(m.t==='register'||m.t==='login')return auth(ws,m);
  if(m.t==='google')return gauth(ws,m);
  if(m.t==='profile'){const u=ACC.users[ws.acct||''];if(!u)return;const nk=clean(m.nick,12);if(nk.length<2)return err(ws,'Nickname: 2-12 characters.');u.nick=nk;u.pic=cleanPic(m.pic);accSave();return acctOut(ws,u)}
  if(m.t==='resume'){const u=ACC.users[clean(m.user,16).toLowerCase()],h=sha(m.sess),now=Date.now();
    if(!u||MOD.bans.acct[u.name.toLowerCase()]||!(u.sess||[]).some(s=>s.exp>now&&safeEq(s.h,h))){ws.acct=null;return out(ws,{t:'acct',user:null})}ws.acct=u.name.toLowerCase();return acctOut(ws,u)}
  if(m.t==='logout'){const u=ACC.users[ws.acct||''];if(u){const h=sha(m.sess);u.sess=(u.sess||[]).filter(s=>!safeEq(s.h,h));accSave()}ws.acct=null;return out(ws,{t:'acct',user:null})}
  if(m.t==='buy'||m.t==='equip'){const u=ACC.users[ws.acct||''];if(!u)return err(ws,'Sign in with an account to use the shop.');const it=SHOPBY[clean(m.id,16)];
    if(m.t==='buy'){if(!it)return err(ws,'No such item.');u.own=u.own||[];if(u.own.includes(it.id))return err(ws,'You already own that.');if((u.cr||0)<it.price)return err(ws,'Not enough credits.');u.cr-=it.price;u.own.push(it.id);ACC.eco.spent+=it.price}
    else{u.eq=u.eq||{frame:'',title:''};const k=m.kind==='title'?'title':'frame';if(!m.id)u.eq[k]='';else if(it&&it.kind===k&&(u.own||[]).includes(it.id))u.eq[k]=it.id;else return err(ws,'You do not own that.')}
    accSave();acctOut(ws,u);if(ws.r)bc(ws.r);return}
  const acctName=()=>ws.acct&&ACC.users[ws.acct]?(ACC.users[ws.acct].nick||ACC.users[ws.acct].name):'';
  if(m.t==='create'){if(ws.p)return;if(banned(clean(m.did,40),ws.acct))return err(ws,'This account or device is suspended.');if(rooms.size>=MAXROOMS)return err(ws,'The server is full. Try again soon.');const r=newRoom();attach(ws,r,addP(r,{...m,name:clean(m.name,12)||acctName(),acct:ws.acct}));return}
  if(m.t==='join'){if(ws.p)return;const r=rooms.get(clean(m.code,4).toUpperCase());
    if(!r)return err(ws,'No room with that code.');if(r.ph!=='lobby')return err(ws,'That match has already started.');
    if(banned(clean(m.did,40),ws.acct))return err(ws,'This account or device is suspended.');
    if(r.ban.has(clean(m.did,40)))return err(ws,'The host removed you from this room.');
    if(ws.acct&&r.P.some(q=>q.acct===ws.acct))return err(ws,'That account is already in this room.');
    const p=addP(r,{...m,name:clean(m.name,12)||acctName(),acct:ws.acct});if(!p)return err(ws,'That room is full.');attach(ws,r,p);return}
  if(m.t==='rejoin'){const r=rooms.get(String(m.code)),dd=clean(m.did,40),tk=String(m.token||''),now=Date.now();
    const p=r&&r.P.find(q=>!q.bot&&q.token&&q.did===dd&&(safeEq(q.token,tk)||(q.prev&&now<q.prev.until&&safeEq(q.prev.t,tk))));
    if(!p)return err(ws,'That room has ended. Create or join a new one.',true);rotate(p);attach(ws,r,p);return}
  const p=ws.p,r=ws.r;if(!p||!r)return;
  if(m.aid!=null){if(typeof m.aid!=='string'||p.aids.has(m.aid))return;p.aids.add(m.aid);if(p.aids.size>300)p.aids.delete(p.aids.values().next().value)}
  const G=r.G,host=p.id===r.host,now=Date.now();
  if(p.down&&!['say','mute','report','leave','seen'].includes(m.t))return;
  switch(m.t){
    case 'settings':if(host&&r.ph==='lobby'){const q=m.quick==null?r.set.quick:!!m.quick,mx=m.max==null?r.set.max:Math.floor(+m.max)||8;
      r.set={quick:q,classic:m.classic==null?r.set.classic:!!m.classic,reveal:m.reveal===undefined?r.set.reveal:(m.reveal==null?null:!!m.reveal),max:Math.min(8,Math.max(r.P.length,q?3:5,mx)),roles:m.roles==null?r.set.roles:!!m.roles,len:m.len===undefined?r.set.len:(m.len==null?null:(lenOk(m.len)||null)),tasks:m.tasks==null?r.set.tasks:tasksOk(m.tasks)}}break;
    case 'addbot':if(host&&r.ph==='lobby'&&!addP(r,{bot:true}))return err(ws,'That room is full.');break;
    case 'rmbot':if(host&&r.ph==='lobby'){const b=r.P.find(q=>q.id===m.id&&q.bot);if(b)removeP(r,b.id)}break;
    case 'kick':if(host&&r.ph==='lobby'){const t=r.P.find(q=>q.id===m.id&&!q.bot&&q!==p);if(t){if(t.did)r.ban.add(t.did);const w=t.ws;removeP(r,t.id);if(w){w.p=null;err(w,'You were removed by the host.',true);w.close()}}}break;
    case 'start':if(host&&r.ph==='lobby'){const e=start(r);if(e)return err(ws,e)}break;
    case 'seen':if(r.ph==='reveal')p.seen=true;break;
    case 'task_start':{const t=p.mine[m.i];if(r.ph==='play'&&t&&!t.done&&(p.alive||p.role==='crew')&&!pairOf(G,p)){p.cur={i:m.i,t:now};if(p.alive){p.st=t.st;p.trail.push({t:G.left,st:t.st})}}break}
    case 'task_done':{const t=p.mine[m.i];if(r.ph==='play'&&t&&!t.done&&(p.alive||p.role==='crew')&&p.cur&&p.cur.i===m.i&&now-p.cur.t>=MIN[t.type])taskDone(r,p,t);break}
    case 'sab':if(r.ph==='play'&&p.alive&&p.role==='traitor'&&!G.sab&&G.sabCd<=0&&G.sabUsed<G.R.sabMax&&alone(r,p)&&!pairOf(G,p)&&!p.down)doSab(r,p);break;
    case 'attack':{if(r.ph!=='play'||!p.alive||p.down||p.role!=='traitor'||!G.R.roles||G.atkCd>0||G.atkUsed>=G.R.atkMax||pairOf(G,p))break;
      const near=r.P.filter(q=>q!==p&&q.alive&&q.st===p.st),t=r.P.find(q=>q.id===m.id);if(t&&near.length===1&&near[0]===t&&t.role!=='traitor'&&!t.down)doAttack(r,p,t);break}
    case 'ab':{if(r.ph!=='play'||!p.alive||!p.cls)break;const a=p.ab;if(a.cd>0||a.uses===0)break;const t=r.P.find(q=>q.id===m.id),use=()=>{if(a.uses>0)a.uses--;a.cd=CLS[p.cls].cd;ev(r,'ab',p.id,t&&t!==p?t.id:null,p.cls)},el=x=>mmss(G.R.match-x);
      if(p.cls==='detective'){if(!t||t===p||!t.alive||a.seen.has(t.id))break;a.seen.add(t.id);
        const clr=G.sabs.length>0&&G.sabs.every(s=>clearedIds(G,s).has(t.id)),w=clr?[100,0,0]:t.role==='traitor'?[0,40,60]:[60,30,10];let x=rnd(100),k=0;while(k<2&&x>=w[k]){x-=w[k];k++}
        note(r,p,'Detective: suspicious activity around '+t.name+' is '+['low','moderate','high'][k]+'. This is a limited read, not proof.');use()}
      else if(p.cls==='scout'){if(!t||t===p||!t.alive)break;note(r,p,'Scout: '+t.name+' was recently at '+t.trail.slice(-4).map(x=>x.st+' ('+el(x.t)+')').join(', then ')+'.');use()}
      else if(p.cls==='engineer'){const c={};STN.forEach(x=>c[x]=0);r.P.forEach(q=>{if(q.alive&&c[q.st]!=null)c[q.st]++});note(r,p,'Maintenance panel: '+STN.map(x=>x+' '+c[x]).join(', ')+'.');use()}
      else if(p.cls==='guardian'){if(!t||!t.alive)break;t.shield=true;t.shieldBy=p.id;note(r,p,'Guardian: '+(t===p?'you are':t.name+' is')+' shielded from the next attack.');use()}
      else if(p.cls==='scientist'){const ls=G.sabs[G.sabs.length-1];if(!ls||ls.an||!(G.sab||ls.t-G.left<=45))break;ls.an=true;
        const two=[ls.st,pick(STN.filter(x=>x!==ls.st))].sort(()=>Math.random()-.5);note(r,p,'Scientist: the sabotage at '+el(ls.t)+' was triggered from the '+two[0]+' or '+two[1]+' station.');use()}
      break}
    case 'medic_start':p.saveT=now;break;
    case 'save':{const v=r.P.find(q=>q.id===m.id);if(r.ph==='play'&&p.alive&&!p.down&&p.cls==='medic'&&p.ab.uses>0&&v&&v!==p&&v.down&&v.alive&&p.saveT&&now-p.saveT>=1000)saveDown(r,p,v);break}
    case 'fix_start':p.fixT=now;break;
    case 'fix':if(r.ph==='play'&&G.sab&&p.alive&&p.role==='crew'&&p.fixT&&now-p.fixT>=(p.cls==='engineer'?800:1800))fix(r);break;
    case 'meet':if(r.ph==='play'&&p.alive&&G.meet>0&&G.mcd<=0)meeting(r,p);break;
    case 'say':{let ch=m.ch;if(!ch)ch=r.ph==='lobby'?'lobby':(!p.alive?'ghost':'meet');
      const ok=ch==='lobby'?r.ph==='lobby':ch==='meet'?r.ph==='meeting'&&G.mt.k==='talk'&&p.alive:ch==='ghost'?!!G&&!p.alive&&['play','meeting','eject'].includes(r.ph):ch==='traitor'?!!G&&p.role==='traitor'&&r.ph==='play':false;
      if(!ok||p.chatOff||now-p.lastChat<=1500)break;const txt=cleanChat(m.txt);if(!txt)break;p.lastChat=now;addMsg(r,p,txt,ch);
      if(ch==='meet'){const t=r.P.find(q=>q.id===m.sus);if(t&&t.alive&&t!==p)t.sus++}break}
    case 'report':{let g=null,ch=null;for(const c of ['lobby','meet','ghost','traitor']){const f=r.chat[c].find(x=>x.id===m.mid);if(f){g=f;ch=c;break}}
      const s=g&&r.P.find(q=>q.id===g.pid);if(!g||g.hid||!s||s.bot||s===p||g.rep.has(p.id)||!canSee(r,p,ch))break;g.rep.add(p.id);
      const need=Math.min(2,Math.max(1,r.P.filter(q=>!q.bot&&q!==s&&canSee(r,q,ch)).length));
      if(g.rep.size>=need){g.hid=true;s.strikes++;if(ch==='meet')G.log.push({t:G.left,txt:'A chat message from '+s.name+' was hidden after reports'});
        if(s.strikes>=2&&!s.chatOff){s.chatOff=true;if(G&&ch==='meet')G.log.push({t:G.left,txt:s.name+' lost chat for this match'})}
        fs.appendFile(REPORTS,JSON.stringify({id:crypto.randomBytes(6).toString('hex'),ts:new Date().toISOString(),room:r.code,ch,from:s.name,acct:s.acct,did:s.did,txt:g.txt,by:[...g.rep]})+'\n',()=>{})}break}
    case 'hrm':{if(!host)break;let g=null,ch=null;for(const c of ['lobby','meet']){const f=r.chat[c].find(x=>x.id===m.mid);if(f){g=f;ch=c;break}}
      if(!g||g.hid||!canSee(r,p,ch))break;const s=r.P.find(q=>q.id===g.pid);g.hid=true;g.hb=true;if(s&&!s.bot)s.strikes++;
      if(ch==='meet')G.log.push({t:G.left,txt:'A chat message from '+(s?s.name:'someone')+' was removed by the host'});
      fs.appendFile(REPORTS,JSON.stringify({id:crypto.randomBytes(6).toString('hex'),ts:new Date().toISOString(),room:r.code,ch,from:s?s.name:'?',acct:s?s.acct:null,did:s?s.did:null,txt:g.txt,by:'host'})+'\n',()=>{});break}
    case 'mute':{const t=r.P.find(q=>q.id===m.id);if(!t||t===p)break;if(p.mu.has(t.id))p.mu.delete(t.id);else p.mu.add(t.id);break}
    case 'pair_start':{const t=p.mine[m.i];if(r.ph!=='play'||!t||t.done||!canPair(r,p))break;
      const old=pairOf(G,p);if(old){if(old.a===p.id)dropPair(G,old);else{old.b=null;old.fin={};old.t0=now}}
      G.pairs.push({a:p.id,b:null,i:m.i,st:t.st,t0:now,tj:0,l0:0,fin:{},botAt:now+(3000+rnd(4000))/SPEED});
      p.cur={i:m.i,t:now};p.st=t.st;p.trail.push({t:G.left,st:t.st});break}
    case 'pair_join':{if(r.ph!=='play'||!p.alive)break;const x=G.pairs.find(y=>y.a===m.a&&y.b==null);if(!x||x.a===p.id)break;
      const mine=pairOf(G,p);if(mine){if(mine.b!=null)return err(ws,'Finish or leave your current pair task first.');dropPair(G,mine);p.cur=null}
      x.b=p.id;x.tj=now;x.t0=now;x.l0=G.left;x.fin={};p.st=x.st;p.trail.push({t:G.left,st:x.st});break}
    case 'pair_hold':if(r.ph==='play'&&p.alive&&pairOf(G,p))p.hold=now;break;
    case 'pair_done':{const x=r.ph==='play'&&p.alive&&pairOf(G,p);if(!x||x.b==null||!p.hold||now-Math.max(p.hold,x.tj)<PAIRHOLD-200)break;
      x.fin[p.id]=now;const o=p.id===x.a?x.b:x.a,ob=r.P.find(q=>q.id===o);
      if(ob.bot||(x.fin[o]&&Math.abs(x.fin[o]-now)<=3000&&ob.hold&&now-Math.max(ob.hold,x.tj)>=PAIRHOLD-200))pairDone(r,x);break}
    case 'pair_cancel':{const x=G&&pairOf(G,p);if(!x)break;if(x.a===p.id){dropPair(G,x);p.cur=null}else{x.b=null;x.fin={};x.t0=now}p.hold=null;break}
    case 'vote':if(r.ph==='meeting'&&G.mt.k==='vote'&&p.alive){if(m.v==='skip')G.votes[p.id]='skip';else{const t=r.P.find(q=>q.id===m.v);if(t&&t.alive&&t!==p)G.votes[p.id]=t.id}}break;
    case 'again':if(host&&r.ph==='results'){r.P.filter(q=>!q.bot&&!q.online).forEach(q=>removeP(r,q.id));r.P.forEach(q=>{q.strikes=0;q.chatOff=false});r.G=null;r.ph='lobby';r.chat.meet=[];r.chat.ghost=[];r.chat.traitor=[]}break;
    case 'leave':if(r.ph==='lobby')removeP(r,p.id);else if(G&&p.alive){p.alive=false;G.log.push({t:G.left,txt:p.name+' left the match'});ev(r,'out',p.id);chk(r)}
      ws.p=null;p.ws=null;p.online=false;p.token=null;break;
  }
  bc(r)}

/* ---------- server ---------- */
const PUBDIR=path.join(__dirname,'public'),ANDROID_PACKAGE=process.env.ANDROID_PACKAGE||'',ANDROID_SHA256=process.env.ANDROID_SHA256||'';
const HDR={'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  'content-security-policy':"default-src 'self'; script-src 'unsafe-inline' https://accounts.google.com/gsi/client; style-src 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' ws: wss: https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; manifest-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'"};
const STATIC={'/':['index.html','text/html; charset=utf-8','no-cache'],'/manifest.webmanifest':['manifest.webmanifest','application/manifest+json','no-cache'],
  '/sw.js':['sw.js','application/javascript; charset=utf-8','no-cache'],'/admin':['admin.html','text/html; charset=utf-8','no-store'],'/admin/':['admin.html','text/html; charset=utf-8','no-store']};
const adminApi=require('./admin')({rooms,ACC,MOD,modSave,DATA,PKG,sha,ipOf,enforce});
const srv=http.createServer((q,s)=>{let url;try{url=new URL(q.url,'http://x')}catch(e){s.writeHead(400);s.end();return}const p=url.pathname;
  if(p==='/health'){let n=0;rooms.forEach(r=>n+=r.P.filter(x=>!x.bot).length);
    s.writeHead(200,{'content-type':'application/json'});s.end(JSON.stringify({ok:true,rooms:rooms.size,players:n,up:Math.round(process.uptime()),rss:Math.round(process.memoryUsage().rss/1048576)}));return}
  if(p==='/config.json'){s.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});s.end(JSON.stringify({google:GID}));return}
  if(adminApi(q,s,url))return;
  if(p==='/.well-known/assetlinks.json'){if(!ANDROID_PACKAGE||!ANDROID_SHA256){s.writeHead(404);s.end();return}
    s.writeHead(200,{'content-type':'application/json','cache-control':'no-cache'});s.end(JSON.stringify([{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:ANDROID_PACKAGE,sha256_cert_fingerprints:ANDROID_SHA256.split(',').map(x=>x.trim())}}]));return}
  let f=STATIC[p];if(!f)f=/^\/icons\/[a-z0-9-]+\.(png|svg)$/.test(p)?['icons/'+p.slice(7),p.endsWith('.svg')?'image/svg+xml':'image/png','public, max-age=604800']:STATIC['/'];
  fs.readFile(path.join(PUBDIR,f[0]),(e,d)=>{if(e){s.writeHead(404);s.end('not found');return}
    if(p==='/sw.js')d=Buffer.from(String(d).replace(/__VERSION__/g,PKG.version));s.writeHead(200,{...HDR,'content-type':f[1],'cache-control':f[2]});s.end(d)})});
const wss=new WebSocketServer({server:srv,maxPayload:8192});
wss.on('connection',(ws,req)=>{ws.alive=true;ws.tok=30;ws.ip=ipOf(req);
  ws.on('pong',()=>ws.alive=true);ws.on('error',()=>{});
  const rf=setInterval(()=>{ws.tok=Math.min(30,ws.tok+20)},1000);
  ws.on('message',raw=>{if(--ws.tok<0)return;let m;try{m=JSON.parse(raw)}catch(e){return}
    if(!m||typeof m.t!=='string')return;try{handle(ws,m)}catch(e){fail(e,{t:m.t,ph:ws.r&&ws.r.ph,room:ws.r&&ws.r.code})}});
  ws.on('close',()=>{clearInterval(rf);const p=ws.p;if(p&&p.ws===ws){p.ws=null;p.online=false;if(ws.r)bc(ws.r)}})});
setInterval(()=>wss.clients.forEach(ws=>{if(!ws.alive)return ws.terminate();ws.alive=false;ws.ping()}),15000);
setInterval(()=>rooms.forEach(r=>{try{tick(r,.5*SPEED);if(r.ph!=='lobby')bc(r)}catch(e){fail(e,{k:'tick',ph:r.ph,room:r.code})}}),500);
/* rejoin tokens also rotate while a player stays connected */
setInterval(()=>{const n=Date.now();rooms.forEach(r=>r.P.forEach(p=>{if(p.ws&&p.token&&n-p.tokAt>ROT){rotate(p);out(p.ws,{t:'token',token:p.token})}}))},Math.min(30000,Math.max(250,ROT/2)));
const SAVE=path.join(DATA,'rooms.json');
try{const o=JSON.parse(fs.readFileSync(SAVE,'utf8')).filter(x=>x.ph!=='lobby');if(o.length)console.log(o.length+' running match(es) voided by restart, no rewards given');fs.unlinkSync(SAVE)}catch(e){}
setInterval(()=>{try{fs.writeFileSync(SAVE,JSON.stringify([...rooms.values()].map(r=>({code:r.code,ph:r.ph,n:r.P.length}))))}catch(e){}},5000);
if(require.main===module)srv.listen(PORT,()=>console.log('Traitor in the Room server on http://localhost:'+PORT));
module.exports={srv,CT:CREW_T,TT:TRAI_T,rooms,MOD,CLS,ACC,SHOP};
