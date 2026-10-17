 'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('vwDesktop',{
 listChicago:()=>ipcRenderer.invoke('vw:list-chicago'),
 importChicago:()=>ipcRenderer.invoke('vw:import-chicago'),
 removeChicago:id=>ipcRenderer.invoke('vw:remove-chicago',id),
 downloadChicago:args=>ipcRenderer.invoke('vw:download-chicago',args),
 chicagoPath:()=>ipcRenderer.invoke('vw:chicago-path'),
 onDownloadProgress:callback=>{ipcRenderer.on('vw:download-progress',(_event,data)=>callback(data));}
});
