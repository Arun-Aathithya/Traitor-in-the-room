/* npm test: starts its own server (port 8099, fast clock, no token grace) and runs every test file. Needs Node 22+. */
const {spawn,spawnSync}=require('child_process'),fs=require('fs'),os=require('os'),path=require('path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tir-run-'));
const srv=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'8099',SPEED:'10',GRACE_MS:'0',BOT_SABOTAGE:'0',DATA_DIR:dir},stdio:['ignore','inherit','inherit']});
let code=0;
setTimeout(()=>{for(const f of ['test.js','test3.js','test4.js','test5.js','test6.js','test7.js']){console.log('\n== '+f);const r=spawnSync(process.execPath,[f],{stdio:'inherit'});if(r.status!==0){code=1;break}}
  if(!code){console.log('\n== loadtest.js (small)');const r=spawnSync(process.execPath,['loadtest.js'],{stdio:'inherit',env:{...process.env,URL:'ws://localhost:8099',ROOMS:'6',PLAYERS:'5',SECONDS:'40'}});if(r.status!==0)code=1}
  srv.kill();console.log(code?'\nTESTS FAILED':'\nALL TESTS PASSED');process.exit(code)},800);
