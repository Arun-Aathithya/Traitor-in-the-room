/* Stage 4 checks: PWA files, icons, service worker, Android asset links, creator dashboard, moderation. Own in-process server on 8096. */
process.env.SPEED='30';process.env.PORT='8096';process.env.ADMIN_TOKEN='test-admin-token-123';process.env.ANDROID_PACKAGE='com.example.traitor';process.env.ANDROID_SHA256='AA:BB:CC';
process.env.DATA_DIR=require('fs').mkdtempSync(require('path').join(require('os').tmpdir(),'tir5-'));
const {srv}=require('./server.js'),fs=require('fs'),path=require('path'),B='http://localhost:8096',WSU='ws://localhost:8096',TOKEN=process.env.ADMIN_TOKEN;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ok=(c,msg)=>{if(!c)throw new Error('FAIL '+msg);console.log('pass',msg)};
function cli(){return new Promise(res=>{const w=new WebSocket(WSU),c={w,v:null,errs:[],fatal:false,code:null,acct:null};
  w.onmessage=e=>{const m=JSON.parse(e.data);if(m.t==='state')c.v=m.v;else if(m.t==='err'){c.errs.push(m.msg);if(m.fatal)c.fatal=true}else if(m.t==='joined')c.code=m.code;else if(m.t==='acct')c.acct=m};
  c.send=m=>w.send(JSON.stringify({aid:Math.random()+'',...m}));w.onopen=()=>res(c)})}
const until=async(f,ms=4000)=>{const t=Date.now();while(Date.now()-t<ms){if(f())return true;await sleep(25)}return false};
const adm=(p,o)=>fetch(B+'/admin/api/'+p,{...(o||{}),headers:{authorization:'Bearer '+TOKEN,'content-type':'application/json'}});
const post=(p,b)=>adm(p,{method:'POST',body:JSON.stringify(b)});
(async()=>{
 await new Promise(r=>srv.listen(8096,r));
 /* --- PWA */
 const mr=await fetch(B+'/manifest.webmanifest');const man=await mr.json();
 ok(mr.headers.get('content-type').includes('application/manifest+json'),'manifest is served with the right type');
 ok(man.display==='standalone'&&man.start_url&&man.name&&man.short_name&&man.scope==='/','manifest has name, start_url, scope and standalone display');
 ok(man.icons.some(i=>i.sizes==='192x192')&&man.icons.some(i=>i.sizes==='512x512'&&i.purpose==='any')&&man.icons.some(i=>i.purpose==='maskable'),'manifest lists 192, 512 and maskable icons');
 for(const i of [...man.icons,{src:'/icons/apple-touch-icon.png',sizes:'180x180'},{src:'/icons/favicon-32.png',sizes:'32x32'}]){const r=await fetch(B+i.src),b=Buffer.from(await r.arrayBuffer());const [w,h]=i.sizes.split('x').map(Number);
   ok(r.status===200&&r.headers.get('content-type')==='image/png'&&b.readUInt32BE(16)===w&&b.readUInt32BE(20)===h,'icon '+i.src+' is a real '+i.sizes+' PNG')}
 const sw=await fetch(B+'/sw.js'),swt=await sw.text();
 ok(sw.headers.get('content-type').includes('javascript')&&!swt.includes('__VERSION__')&&swt.includes('tir-'+require('./package.json').version),'service worker is served with the release version in its cache name');
 ok(sw.headers.get('cache-control')==='no-cache','service worker is never cached by the browser');
 const html=await (await fetch(B+'/')).text();
 ok(html.includes('rel="manifest"')&&html.includes('apple-touch-icon')&&html.includes("serviceWorker"),'index links the manifest, touch icon and registers the service worker');
 ok((await fetch(B+'/icons/../server.js')).headers.get('content-type').includes('text/html'),'path tricks cannot read server files');
 ok((await fetch(B+'/icons/nothing.png')).status===404,'unknown icon is 404');
 const al=await (await fetch(B+'/.well-known/assetlinks.json')).json();
 ok(al[0].target.package_name==='com.example.traitor'&&al[0].target.sha256_cert_fingerprints[0]==='AA:BB:CC','Android asset links are served from the environment');
 const csp=(await fetch(B+'/')).headers.get('content-security-policy');ok(csp.includes("worker-src 'self'")&&csp.includes("manifest-src 'self'"),'CSP allows the worker and manifest');
 /* --- dashboard access */
 ok((await fetch(B+'/admin')).status===200,'dashboard page is served');
 ok((await fetch(B+'/admin/api/overview')).status===401,'dashboard API refuses requests without a token');
 ok((await fetch(B+'/admin/api/overview',{headers:{authorization:'Bearer nope'}})).status===401,'dashboard API refuses a wrong token');
 /* --- generate a match (quick mode, 3 players, time runs out) */
 const A=await cli();A.did='dA';A.send({t:'create',name:'Amy',dev:'PC',did:A.did});await sleep(150);
 const Bb=await cli(),C=await cli();Bb.did='dB';C.did='dC';Bb.send({t:'join',code:A.code,name:'Bo',dev:'Phone',did:Bb.did});C.send({t:'join',code:A.code,name:'Cy',dev:'Phone',did:C.did});await sleep(250);
 /* reports from lobby chat */
 Bb.send({t:'say',txt:'something rude: you are stupid',ch:'lobby'});await sleep(100);const bm=A.v.msgs.find(m=>m.name==='Bo');
 A.send({t:'report',mid:bm.id});C.send({t:'report',mid:bm.id});await sleep(300);
 A.send({t:'settings',quick:true});await sleep(100);A.send({t:'start'});await sleep(200);[A,Bb,C].forEach(c=>c.send({t:'seen'}));
 ok(await until(()=>A.v.ph==='results',20000),'a quick match finishes');await sleep(400);
 const ov=await (await adm('overview')).json();
 ok(ov.totals.matches===1&&ov.live.rooms>=1&&ov.days.length===14&&ov.version,'overview shows the finished match, live rooms and 14 days');
 ok(ov.totals.tasksPct>=0&&typeof ov.totals.crewWinPct==='number'&&ov.quickPct===undefined&&ov.totals.quickPct===100,'overview has win rate, task and quick-mode stats');
 ok(ov.reports.open===1,'overview counts the open report');
 const csv=await (await adm('matches.csv')).text();ok(csv.split('\n').length===2&&csv.startsWith('ts,room,players'),'matches.csv exports one row');
 ok(!JSON.stringify(ov).includes('Amy')&&!fs.readFileSync(path.join(process.env.DATA_DIR,'matches.jsonl'),'utf8').includes('Amy'),'match log holds no player names');
 const rooms=await (await adm('rooms')).json();ok(rooms.rooms.length>=1&&!JSON.stringify(rooms).includes('role'),'live rooms list shows counts only');
 /* --- reports and moderation */
 const rp=(await (await adm('reports?status=open')).json()).reports;
 ok(rp.length===1&&rp[0].from==='Bo'&&rp[0].id&&rp[0].did==='dB'&&rp[0].txt.includes('***'),'report appears with id, sender, device and filtered text');
 ok((await post('reports/'+rp[0].id,{action:'ban_account'})).status===400,'cannot suspend an account for a guest report');
 ok((await post('reports/'+rp[0].id,{action:'explode'})).status===400,'unknown report action is refused');
 ok((await post('reports/'+rp[0].id,{action:'ban_device'})).status===200,'device can be suspended from a report');
 ok((await (await adm('reports?status=open')).json()).reports.length===0,'handled report leaves the open list');
 await sleep(700);const mod=JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR,'moderation.json'),'utf8'));ok(mod.bans.did.dB&&Object.keys(mod.reviewed).length===1,'moderation decisions are saved to disk');
 const Bn=await cli();Bn.send({t:'create',name:'Bo',dev:'Phone',did:'dB'});await sleep(150);ok(Bn.errs.includes('This account or device is suspended.'),'a suspended device cannot create a room');
 const Bj=await cli();Bj.send({t:'join',code:A.code,name:'Bo',dev:'Phone',did:'dB'});await sleep(150);ok(Bj.errs.some(e=>/suspended|already started/.test(e))&&!Bj.v,'a suspended device cannot join a room');
 ok((await post('ban',{kind:'did',value:'dB',on:false})).status===200,'device can be restored');
 const Bk=await cli();Bk.send({t:'create',name:'Bo',dev:'Phone',did:'dB'});await sleep(150);ok(Bk.v&&Bk.v.ph==='lobby','a restored device can play again');
 /* accounts and suspension */
 const U=await cli();U.send({t:'register',user:'Trouble_1',pass:'correct horse'});ok(await until(()=>U.acct&&U.acct.user),'test account registered');
 const acs=(await (await adm('accounts')).json()).accounts;ok(acs.length===1&&acs[0].name==='Trouble_1'&&!JSON.stringify(acs).includes('hash')&&!JSON.stringify(acs).includes('salt')&&!JSON.stringify(acs).includes('sess'),'account list shows stats but no secrets');
 const R=await cli();R.send({t:'login',user:'Trouble_1',pass:'correct horse'});await until(()=>R.acct&&R.acct.user);
 R.send({t:'create',name:'',dev:'PC',did:'dR'});await sleep(150);ok(R.v&&R.v.ph==='lobby','signed-in player is in a lobby');
 ok((await post('ban',{kind:'acct',value:'trouble_1',on:true,note:'test'})).status===200,'account can be suspended');await sleep(200);
 ok(R.fatal&&R.errs.includes('This account or device has been suspended.'),'suspending an account removes it from its live room');
 const L2=await cli();L2.send({t:'login',user:'Trouble_1',pass:'correct horse'});await sleep(400);ok(L2.errs.includes('This account is suspended.'),'a suspended account cannot sign in');
 const L3=await cli();L3.send({t:'resume',user:'Trouble_1',sess:U.acct.sess});await sleep(150);ok(L3.acct&&L3.acct.user===null,'a suspended account cannot resume a session');
 ok((await post('ban',{kind:'acct',value:'ghost',on:true})).status===404,'suspending an unknown account is refused');
 const bans=await (await adm('bans')).json();ok(bans.accounts.trouble_1&&bans.accounts.trouble_1.note==='test','suspension list shows the account');
 await post('ban',{kind:'acct',value:'trouble_1',on:false});const L4=await cli();L4.send({t:'login',user:'Trouble_1',pass:'correct horse'});ok(await until(()=>L4.acct&&L4.acct.user==='Trouble_1'),'a restored account can sign in');
 /* dashboard page escapes player text */
 const page=await (await fetch(B+'/admin')).text();ok(page.includes('esc(x.txt)')&&page.includes('esc(x.from)'),'dashboard escapes player-supplied text');
 /* lockout last (it affects this IP) */
 for(let i=0;i<5;i++)await fetch(B+'/admin/api/overview',{headers:{authorization:'Bearer bad'+i}});
 ok((await adm('overview')).status===429,'repeated wrong tokens lock the dashboard for a minute');
 console.log('STAGE 4 PASSED');process.exit(0)
})().catch(e=>{console.error(e.message);process.exit(1)});
