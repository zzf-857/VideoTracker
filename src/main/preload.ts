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

  // 唤起并聚焦主窗口
  focusMainWindow: () => ipcRenderer.invoke('window:focus'),

  // 代理 WebDAV 网络请求，避免跨域限制
  webdavRequest: (url: string, options: any) => ipcRenderer.invoke('webdav:request', url, options),

  // 本地数据路径管理与迁移
  getStoragePath: () => ipcRenderer.invoke('db:getStoragePath'),
  migrateStorage: (newPath: string, moveData: boolean) => ipcRenderer.invoke('db:migrateStorage', newPath, moveData),
  openStorageFolder: () => ipcRenderer.invoke('db:openStorageFolder'),
  getStorageSize: () => ipcRenderer.invoke('db:getStorageSize'),
  resetStoragePath: () => ipcRenderer.invoke('db:resetStoragePath'),
  openDefaultAppFolder: () => ipcRenderer.invoke('db:openDefaultAppFolder'),
  getDefaultAppPath: () => ipcRenderer.invoke('db:getDefaultAppPath'),
});
