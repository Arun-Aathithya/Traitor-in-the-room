'use strict';
/* Copies the game (server, dashboard backend, web client) from the folder above into desktop/game so the installer can pack it.
   Run automatically by `npm run dist` and `npm start`. Keeps the version in step with the game's package.json. */
const fs=require('fs'),path=require('path'),root=path.join(__dirname,'..'),dest=path.join(__dirname,'game');
fs.rmSync(dest,{recursive:true,force:true});fs.mkdirSync(dest,{recursive:true});
for(const f of ['server.js','admin.js'])fs.copyFileSync(path.join(root,f),path.join(dest,f));
fs.cpSync(path.join(root,'public'),path.join(dest,'public'),{recursive:true});
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
fs.writeFileSync(path.join(dest,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,main:'server.js'},null,2));
fs.copyFileSync(path.join(root,'public','icons','icon-512.png'),path.join(__dirname,'build','icon.png'));
const mine=JSON.parse(fs.readFileSync(path.join(__dirname,'package.json'),'utf8'));
if(mine.version!==pkg.version){mine.version=pkg.version;fs.writeFileSync(path.join(__dirname,'package.json'),JSON.stringify(mine,null,2)+'\n');console.log('Installer version set to '+pkg.version)}
console.log('Game files copied to desktop/game (version '+pkg.version+')');
