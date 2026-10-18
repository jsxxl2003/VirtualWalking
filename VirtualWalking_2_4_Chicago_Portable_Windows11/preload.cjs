 'use strict';
const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('vwDesktop',{
 setDesktopFullscreen:enabled=>ipcRenderer.invoke('vw:desktop-fullscreen',enabled),
 onDesktopFullscreenState:callback=>ipcRenderer.on('vw:desktop-fullscreen-state',(_e,active)=>callback(active)),
 discoverTv:()=>ipcRenderer.invoke('vw:discover-tv'),
 checkPhilipsDial:()=>ipcRenderer.invoke('vw:check-philips-dial'),
 launchPhilipsYoutube:()=>ipcRenderer.invoke('vw:launch-philips-youtube'),
 sendYoutubeToPhilips:id=>ipcRenderer.invoke('vw:send-youtube-to-philips',id),
 openTv:()=>ipcRenderer.invoke('vw:tv-open'),
 closeTv:()=>ipcRenderer.invoke('vw:tv-close'),
 loadTv:data=>ipcRenderer.invoke('vw:tv-load',data),
 sendTvState:data=>ipcRenderer.send('vw:tv-state',data),
 onTvLoad:callback=>ipcRenderer.on('vw:tv-load',(_e,data)=>callback(data)),
 onTvState:callback=>ipcRenderer.on('vw:tv-state',(_e,data)=>callback(data)),
 onTvClosed:callback=>ipcRenderer.on('vw:tv-closed',()=>callback()),
 localFilePath:file=>webUtils.getPathForFile(file),
 listChicago:()=>ipcRenderer.invoke('vw:list-chicago'),
 importChicago:()=>ipcRenderer.invoke('vw:import-chicago'),
 removeChicago:id=>ipcRenderer.invoke('vw:remove-chicago',id),
 downloadChicago:args=>ipcRenderer.invoke('vw:download-chicago',args),
 chicagoPath:()=>ipcRenderer.invoke('vw:chicago-path'),
 onDownloadProgress:callback=>{ipcRenderer.on('vw:download-progress',(_event,data)=>callback(data));}
});
