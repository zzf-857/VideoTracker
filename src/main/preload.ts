import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 选择本地文件夹
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  
  // 扫描本地视频目录
  scanFolder: (folderPath: string) => ipcRenderer.invoke('fs:scanFolder', folderPath),
  
  // 读写本地 JSON 配置文件
  saveData: (key: string, data: any) => ipcRenderer.invoke('db:save', key, data),
  getData: (key: string) => ipcRenderer.invoke('db:get', key),
  
  // 获取本地视频转接 HTTP 流的播放 URL
  getVideoStreamUrl: (absolutePath: string) => ipcRenderer.invoke('stream:getUrl', absolutePath),
  
  // 选择本地文件路径（用于更改同步目录等）
  selectFile: () => ipcRenderer.invoke('dialog:selectFile'),
  
  // 悬浮小窗画中画控制
  openPipWindow: (params: { url: string, path: string, name: string, currentTime: number }) => 
    ipcRenderer.invoke('pip:open', params),
  setPipAlwaysOnTop: (alwaysOnTop: boolean) => 
    ipcRenderer.invoke('pip:setAlwaysOnTop', alwaysOnTop),
  closePipWindow: () => 
    ipcRenderer.invoke('pip:close'),
  onPipClosed: (callback: (event: any, data: { videoPath: string }) => void) => {
    const handler = (event: any, data: { videoPath: string }) => callback(event, data);
    ipcRenderer.on('pip:closed', handler);
    return () => {
      ipcRenderer.off('pip:closed', handler);
    };
  }
});
