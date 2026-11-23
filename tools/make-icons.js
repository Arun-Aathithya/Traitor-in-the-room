/* Optional dev tool: regenerates the PNG icons from public/icons/icon.svg. Needs puppeteer and a Chrome (set CHROME=/path/to/chrome).
   The PNGs are already in the zip, so you only need this if you change the logo. */
const puppeteer=require('puppeteer'),fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'..','public','icons'),svg=fs.readFileSync(path.join(dir,'icon.svg'),'utf8');
const logo=svg.match(/<g[\s\S]*<\/g>/)[0];
const any=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${svg.match(/<rect[^>]*>/)[0]}${logo}</svg>`;
/* maskable: full-bleed background, logo scaled into the central 60% safe zone */
const inner=logo.replace(/^<g[^>]*>/,'<g transform="translate(96 96) scale(5)">');
const mask=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0B0F17"/>${inner}</svg>`;
const OUT=[['icon-192.png',192,any],['icon-512.png',512,any],['icon-maskable-512.png',512,mask],['apple-touch-icon.png',180,mask],['favicon-32.png',32,any]];
(async()=>{const b=await puppeteer.launch({headless:true,executablePath:process.env.CHROME,args:['--no-sandbox']}),p=await b.newPage();
  for(const [f,s,x] of OUT){await p.setViewport({width:s,height:s});await p.setContent(`<body style="margin:0;background:transparent">${x.replace('<svg ',`<svg width="${s}" height="${s}" `)}</body>`);
    await p.screenshot({path:path.join(dir,f),omitBackground:true,clip:{x:0,y:0,width:s,height:s}});console.log('wrote',f)}await b.close()})();
