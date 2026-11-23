'use strict';
/* One-command launcher: node tools/start.js   (or: npm start, or double-click start-windows.bat)
   - Creates admin-token.txt on first run (random) and uses it as ADMIN_TOKEN, so the creator dashboard works.
   - Reads google-client-id.txt (optional) as GOOGLE_CLIENT_ID to turn on Google sign-in. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),root=path.join(__dirname,'..');
const rd=f=>{try{return fs.readFileSync(path.join(root,f),'utf8').trim()}catch(e){return ''}};
let tok=process.env.ADMIN_TOKEN||rd('admin-token.txt');
if(!tok){tok=crypto.randomBytes(18).toString('base64url');fs.writeFileSync(path.join(root,'admin-token.txt'),tok+'\n')}
process.env.ADMIN_TOKEN=tok;
if(!process.env.GOOGLE_CLIENT_ID&&rd('google-client-id.txt'))process.env.GOOGLE_CLIENT_ID=rd('google-client-id.txt');
const port=process.env.PORT||8080;
console.log('\n=== Traitor in the Room ===\nGame:       http://localhost:'+port+'\nCreator dashboard: http://localhost:'+port+'/admin\n  Username: none (there is no username)\n  Password: '+tok+'   (saved in admin-token.txt)\nGoogle sign-in: '+(process.env.GOOGLE_CLIENT_ID?'ON':'OFF (put your client ID in google-client-id.txt)')+'\n');
const m=require('../server.js');if(m&&m.srv&&!m.srv.listening)m.srv.listen(+port);else if(!m||!m.srv)throw new Error('server.js does not export srv');
