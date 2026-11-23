'use strict';
/* Windows app for Traitor in the Room. It runs the game server inside the app and opens the game in a window, so one install is enough
   to play alone or to host friends on the same Wi-Fi. Save data, the dashboard password and logs live in the user's app-data folder. */
const {app,BrowserWindow,Menu,shell,dialog,clipboard}=require('electron');
const path=require('path'),fs=require('fs'),os=require('os'),crypto=require('crypto');
const WANT=+process.env.PORT||8080;let win=null,port=0,token='',data='';

function lanUrls(){const o=[];const n=os.networkInterfaces();Object.keys(n).forEach(k=>(n[k]||[]).forEach(a=>{if(a.family==='IPv4'&&!a.internal)o.push('http://'+a.address+':'+port)}));return o}
function startServer(){return new Promise((resolve,reject)=>{
  data=app.getPath('userData');fs.mkdirSync(data,{recursive:true});
  const tf=path.join(data,'admin-token.txt');try{token=fs.readFileSync(tf,'utf8').trim()}catch(e){}
  if(!token){token=crypto.randomBytes(18).toString('base64url');fs.writeFileSync(tf,token+'\n')}
  process.env.DATA_DIR=data;process.env.ADMIN_TOKEN=token;
  try{const g=fs.readFileSync(path.join(data,'google-client-id.txt'),'utf8').trim();if(g&&!process.env.GOOGLE_CLIENT_ID)process.env.GOOGLE_CLIENT_ID=g}catch(e){}
  const {srv}=require('./game/server.js');
  const tryListen=p=>{srv.once('error',e=>{if(e.code==='EADDRINUSE'&&p!==0)tryListen(0);else reject(e)});srv.listen(p,()=>{port=srv.address().port;resolve()})};
  tryListen(WANT)})}

function showAddress(){const u=lanUrls(),txt=u.length?u.join('\n'):'No Wi-Fi or network address found. Connect this PC to the same network as your friends first.';
  const r=dialog.showMessageBoxSync(win,{type:'info',title:'Play with friends',message:'Friends on the same Wi-Fi open one of these addresses in their browser:',detail:txt+'\n\nThey type the 4-letter room code after you create a room. The first time, Windows may ask to allow the game through the firewall: choose Private networks.',buttons:['Copy','Close'],defaultId:0,cancelId:1});
  if(r===0&&u.length)clipboard.writeText(u[0])}
function showDashboard(){const r=dialog.showMessageBoxSync(win,{type:'info',title:'Creator dashboard',message:'The dashboard opens in your browser.',detail:'There is no username. The password is:\n\n'+token+'\n\nKeep it private.',buttons:['Open and copy password','Close'],defaultId:0,cancelId:1});
  if(r===0){clipboard.writeText(token);shell.openExternal('http://127.0.0.1:'+port+'/admin')}}
function menu(){Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:'Game',submenu:[{label:'Play with friends (show address)',click:showAddress},{label:'Creator dashboard',click:showDashboard},{label:'Open data folder',click:()=>shell.openPath(data)},{type:'separator'},{role:'quit',label:'Quit'}]},
  {label:'View',submenu:[{role:'reload'},{role:'togglefullscreen'},{type:'separator'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]},
  {label:'Help',submenu:[{label:'About',click:()=>dialog.showMessageBox(win,{type:'info',title:'About',message:'Traitor in the Room',detail:'Version '+app.getVersion()+'\nYour data is kept in:\n'+data})}]}]))}
function open(){win=new BrowserWindow({width:1180,height:820,minWidth:400,minHeight:600,backgroundColor:'#0B0F17',title:'Traitor in the Room',icon:path.join(__dirname,'build','icon.png'),autoHideMenuBar:true,
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false}});
  const origin='http://127.0.0.1:'+port;
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url))shell.openExternal(url);return{action:'deny'}});
  win.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith(origin)){e.preventDefault();if(/^https?:\/\//.test(url))shell.openExternal(url)}});
  win.on('closed',()=>{win=null});win.loadURL(origin+'/')}

if(!app.requestSingleInstanceLock()){app.quit()}
else{
  app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus()}});
  app.whenReady().then(async()=>{try{await startServer()}catch(e){dialog.showErrorBox('Traitor in the Room','The game server could not start: '+(e&&e.message||e));app.quit();return}
    menu();open();app.on('activate',()=>{if(!win)open()})});
  app.on('window-all-closed',()=>app.quit());
}
