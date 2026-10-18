 'use strict';
const {app,BrowserWindow,session,shell,ipcMain,dialog,Menu}=require('electron');
const http=require('node:http');
const https=require('node:https');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {pipeline}=require('node:stream/promises');
let server,win,port,downloadBusy=false;
const supported={'.mp4':'video/mp4','.webm':'video/webm'};
function libraryDir(){let base;try{base=app.getPath('videos');}catch{base=app.getPath('documents');}return path.join(base,'VirtualWalking','Chicago');}
async function ensureDir(){await fsp.mkdir(libraryDir(),{recursive:true});}
async function list(){await ensureDir();let entries=[];try{entries=JSON.parse(await fsp.readFile(path.join(libraryDir(),'library.json'),'utf8'));}catch{}
 if(!Array.isArray(entries))return [];return entries.filter(x=>x&&typeof x.id==='string'&&/^[0-9a-f-]{36}$/.test(x.id)&&supported[x.ext]);}
async function save(entries){await ensureDir();const tmp=path.join(libraryDir(),'library.tmp');await fsp.writeFile(tmp,JSON.stringify(entries,null,2),'utf8');await fsp.rename(tmp,path.join(libraryDir(),'library.json'));}
function publicEntries(entries){return entries.map(({id,name,ext,added,source})=>({id,name,ext,added,source,url:`http://127.0.0.1:${port}/library/${id}`}));}
function failResponse(res,status){res.writeHead(status);res.end();}
async function serveVideo(req,res,id){const entries=await list(),entry=entries.find(e=>e.id===id);if(!entry)return failResponse(res,404);
 const file=path.join(libraryDir(),entry.id+entry.ext);let stat;try{stat=await fsp.stat(file);}catch{return failResponse(res,404);}
 const total=stat.size,range=req.headers.range;res.setHeader('Content-Type',supported[entry.ext]);res.setHeader('Accept-Ranges','bytes');res.setHeader('Cache-Control','private, max-age=3600');
 if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match)return failResponse(res,416);
  let start=match[1]?Number(match[1]):null,end=match[2]?Number(match[2]):null;
  if(start===null&&end!==null){start=Math.max(0,total-end);end=total-1;}else{start=start??0;end=end??total-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=total||start>end||end<0){res.setHeader('Content-Range',`bytes */${total}`);return failResponse(res,416);}
  end=Math.min(end,total-1);res.writeHead(206,{'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${total}`});
  if(req.method==='HEAD')return res.end();fs.createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
 }else{res.writeHead(200,{'Content-Length':total});if(req.method==='HEAD')return res.end();fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);}
}
function startServer(){return new Promise((resolve,reject)=>{
 server=http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://127.0.0.1');if(/^\/library\/[0-9a-f-]{36}$/.test(u.pathname))return await serveVideo(req,res,u.pathname.split('/')[2]);
  const name={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/video-manager.js':'video-manager.js','/styles.css':'styles.css','/chicago.js':'chicago.js'}[u.pathname];
  if(!name)return failResponse(res,404);
  fs.readFile(path.join(__dirname,'web',name),(err,data)=>{if(err)return failResponse(res,500);res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html','X-Content-Type-Options':'nosniff'});res.end(data);});
 }catch{return failResponse(res,500);}});server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));
 });}
async function importFiles(){const result=await dialog.showOpenDialog(win,{title:'Chicago-Videos importieren',properties:['openFile','multiSelections'],filters:[{name:'Laufvideos (MP4/WebM)',extensions:['mp4','webm']} ]});
 if(result.canceled)return publicEntries(await list());const entries=await list();
 for(const file of result.filePaths){const ext=path.extname(file).toLowerCase();if(!supported[ext])continue;
  const id=randomUUID();await fsp.copyFile(file,path.join(libraryDir(),id+ext));entries.push({id,name:path.basename(file),ext,added:new Date().toISOString(),source:'Import vom PC'});}
 await save(entries);return publicEntries(entries);}
async function removeFile(id){const entries=await list(),found=entries.find(e=>e.id===id);if(!found)return publicEntries(entries);
 await fsp.unlink(path.join(libraryDir(),found.id+found.ext)).catch(()=>{});await save(entries.filter(e=>e.id!==id));return publicEntries(await list());}
function getVideo(url,redirects=0){return new Promise((resolve,reject)=>{
 if(redirects>4)return reject(Error('Zu viele Weiterleitungen'));
 let parsed;try{parsed=new URL(url);}catch{return reject(Error('Ungültige URL'));}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password)return reject(Error('Nur HTTPS-Video-Adressen ohne Zugangsdaten sind erlaubt.'));
 const req=https.get(parsed,{headers:{'User-Agent':'VirtualWalking/2.4','Accept':'video/mp4,video/webm,application/octet-stream'}},res=>{
  if([301,302,303,307,308].includes(res.statusCode)){const next=new URL(res.headers.location||'',parsed).toString();res.resume();return resolve(getVideo(next,redirects+1));}
  if(res.statusCode!==200){res.resume();return reject(Error('Video-Server antwortet mit HTTP '+res.statusCode));}
  resolve({res,finalUrl:parsed.toString()});
 });req.setTimeout(30000,()=>req.destroy(Error('Zeitüberschreitung')));req.on('error',reject);
 });}
async function downloadVideo({url,name,permission}){
 if(!permission)throw Error('Bitte bestätige, dass du dieses Video speichern darfst.');
 if(downloadBusy)throw Error('Ein Video wird bereits gespeichert.');
 if(typeof url!=='string'||url.length>2048)throw Error('Ungültige Adresse');
 downloadBusy=true;let temp;
 try{
  const parsed=new URL(url);const ext=path.extname(parsed.pathname).toLowerCase();if(!supported[ext])throw Error('Direkter HTTPS-Link auf eine .mp4- oder .webm-Datei erforderlich.');
  if(/(?:youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com)$/i.test(parsed.hostname))throw Error('Plattform-Videos können nicht auf diesem Weg gespeichert werden.');
  const {res}=await getVideo(url),size=Number(res.headers['content-length']||0),limit=8*1024**3;
  if(size>limit){res.destroy();throw Error('Video überschreitet 8 GB.');}
  const contentType=String(res.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  if(contentType&&!['video/mp4','video/webm','application/octet-stream','binary/octet-stream'].includes(contentType)){res.destroy();throw Error('Der Server liefert keine unterstützte Videodatei.');}
  await ensureDir();const id=randomUUID();temp=path.join(libraryDir(),id+'.part');const target=path.join(libraryDir(),id+ext);
  let received=0,lastReport=0;res.on('data',chunk=>{received+=chunk.length;
   if(received>limit){res.destroy(Error('Download überschreitet 8 GB.'));return;}
   if(Date.now()-lastReport>600){lastReport=Date.now();win?.webContents.send('vw:download-progress',{received,total:size||null});}
  });
  await pipeline(res,fs.createWriteStream(temp,{flags:'wx'}));await fsp.rename(temp,target);temp=null;
  const entries=await list();entries.push({id,ext,name:String(name||parsed.pathname.split('/').pop()).slice(0,120),added:new Date().toISOString(),source:'Erlaubter Online-Download'});await save(entries);
  win?.webContents.send('vw:download-progress',{done:true,received,total:received});return publicEntries(entries);
 }finally{downloadBusy=false;if(temp)await fsp.unlink(temp).catch(()=>{});}
}
app.whenReady().then(async()=>{
 port=await startServer();
 session.defaultSession.setPermissionCheckHandler((_wc,p)=>p==='bluetooth'||p==='bluetoothScanning');
 session.defaultSession.setPermissionRequestHandler((_wc,p,cb)=>cb(p==='bluetooth'||p==='bluetoothScanning'));
 ipcMain.handle('vw:list-chicago',async()=>publicEntries(await list()));
 ipcMain.handle('vw:import-chicago',importFiles);
 ipcMain.handle('vw:remove-chicago',(_event,id)=>removeFile(id));
 ipcMain.handle('vw:download-chicago',(_event,args)=>downloadVideo(args));
 ipcMain.handle('vw:chicago-path',()=>libraryDir());
 win=new BrowserWindow({width:1460,height:960,minWidth:850,minHeight:620,autoHideMenuBar:true,
  webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'preload.cjs')}});
 // Windows-Kontextmenue fuer Eingabefelder, insbesondere Video-URL.
 win.webContents.on('context-menu',(_event,params)=>{
  if(!params.isEditable)return;
  const flags=params.editFlags||{};
  const template=[
   {label:'Rückgängig',role:'undo',enabled:!!flags.canUndo},
   {label:'Wiederholen',role:'redo',enabled:!!flags.canRedo},
   {type:'separator'},
   {label:'Ausschneiden',role:'cut',enabled:!!flags.canCut},
   {label:'Kopieren',role:'copy',enabled:!!flags.canCopy},
   {label:'Einfügen',role:'paste',enabled:!!flags.canPaste},
   {type:'separator'},
   {label:'Alles auswählen',role:'selectAll'}
  ];
  Menu.buildFromTemplate(template).popup({window:win});
 });
 // Electron liefert die Bluetooth-Geraeteliste asynchron und oft zunaechst leer.
// Eine leere erste Liste darf die Auswahl nicht mit callback('') abbrechen.
let bluetoothSelection=null;
win.webContents.on('select-bluetooth-device',(event,devices,callback)=>{
 event.preventDefault();
 if(!bluetoothSelection||bluetoothSelection.callback!==callback){
  if(bluetoothSelection?.timer)clearTimeout(bluetoothSelection.timer);
  bluetoothSelection={callback,devices:new Map(),timer:null};
 }
 const selection=bluetoothSelection;
 for(const d of devices||[])if(d.deviceId)selection.devices.set(d.deviceId,d);
 const available=[...selection.devices.values()];
 const preferred=available.find(d=>/WELLFIT TM Linker/i.test(d.deviceName||''))
   ||available.find(d=>/WELLFIT/i.test(d.deviceName||''));
 const choose=(d)=>{
  if(bluetoothSelection!==selection)return;
  if(selection.timer)clearTimeout(selection.timer);
  bluetoothSelection=null;
  callback(d?.deviceId||'');
 };
 if(preferred){choose(preferred);return;}
 // Andere FTMS-Geraete nur als Fallback, damit der WELLFIT Zeit zum Melden hat.
 if(available.length&&!selection.timer){
  selection.timer=setTimeout(()=>choose([...selection.devices.values()][0]),8000);
 }
});
 win.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))shell.openExternal(url);return {action:'deny'};});
 await win.loadURL(`http://127.0.0.1:${port}`);
}).catch(e=>{dialog.showErrorBox('VirtualWalking konnte nicht starten',String(e));app.quit();});
app.on('window-all-closed',()=>{server?.close();app.quit();});
