import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as crypto from 'crypto';

let mainWindow: BrowserWindow | null = null;
let streamServer: http.Server | null = null;
let streamPort = 30005; // 本地流服务默认端口

// 数据文件路径
const getDataFilePath = (key: string) => {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, `${key}.json`);
};

// 1. 启动轻量级 HTTP Range 本地视频流转接服务器
function startStreamServer() {
  streamServer = http.createServer((req, res) => {
    // 跨域设置
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      const urlObj = new URL(req.url || '', `http://${req.headers.host}`);
      const filePathQuery = urlObj.searchParams.get('path');
      if (!filePathQuery) {
        res.writeHead(400);
        res.end('Missing file path');
        return;
      }

      const cleanBase64 = filePathQuery.replace(/ /g, '+');
      const decodedPath = Buffer.from(cleanBase64, 'base64').toString('utf-8');
      
      if (decodedPath.startsWith('http://') || decodedPath.startsWith('https://')) {
        const remoteUrl = new URL(decodedPath);
        const headers: Record<string, string> = {};
        
        if (req.headers.range) {
          headers['Range'] = req.headers.range;
        }
        
        if (remoteUrl.username || remoteUrl.password) {
          const username = decodeURIComponent(remoteUrl.username);
          const password = decodeURIComponent(remoteUrl.password);
          const creds = Buffer.from(`${username}:${password}`).toString('base64');
          headers['Authorization'] = `Basic ${creds}`;
          
          remoteUrl.username = '';
          remoteUrl.password = '';
        }

        const protocol = remoteUrl.protocol === 'https:' ? require('https') : require('http');
        const proxyReq = protocol.request(remoteUrl.toString(), {
          method: 'GET',
          headers: headers
        }, (proxyRes: any) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err: any) => {
          console.error('WebDAV stream proxy error:', err);
          res.writeHead(500);
          res.end(err.message || 'WebDAV proxy error');
        });

        req.on('close', () => {
          proxyReq.destroy();
        });

        req.pipe(proxyReq);
        return;
      }
      
      if (!fs.existsSync(decodedPath)) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }

      const stat = fs.statSync(decodedPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      // 提取文件后缀判断 Content-Type
      const ext = path.extname(decodedPath).toLowerCase();
      let contentType = 'video/mp4';
      if (ext === '.webm') contentType = 'video/webm';
      else if (ext === '.ogg') contentType = 'video/ogg';
      else if (ext === '.mkv') contentType = 'video/x-matroska';
      else if (ext === '.avi') contentType = 'video/x-msvideo';

      if (range) {
        // 处理 Range 请求 (Partial Content - 206)
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize) {
          res.writeHead(416, {
            'Content-Range': `bytes */${fileSize}`
          });
          res.end();
          return;
        }

        const chunksize = (end - start) + 1;
        const fileStream = fs.createReadStream(decodedPath, { start, end });
        
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
        });
        
        fileStream.pipe(res);
      } else {
        // 处理标准请求 (OK - 200)
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': contentType,
        });
        fs.createReadStream(decodedPath).pipe(res);
      }
    } catch (err: any) {
      res.writeHead(500);
      res.end(err.message || 'Internal Server Error');
    }
  });

  streamServer.listen(0, '127.0.0.1', () => {
    const address = streamServer?.address();
    if (address && typeof address !== 'string') {
      streamPort = address.port;
      console.log(`HTTP video stream server listening on http://127.0.0.1:${streamPort}`);
    }
  });
}

// 2. 递归扫描本地目录结构
interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  mtime?: number;
  children?: FileNode[];
}

function scanDirectory(dirPath: string): FileNode[] {
  const result: FileNode[] = [];
  const videoExtensions = ['.mp4', '.webm', '.mkv', '.ogg', '.avi', '.flv'];

  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // 若是目录，递归扫描其子文件
        if (file.startsWith('.') || file === 'node_modules') continue;
        const children = scanDirectory(fullPath);
        if (children.length > 0) {
          result.push({
            name: file,
            path: fullPath,
            isDir: true,
            mtime: stat.mtimeMs,
            children
          });
        }
      } else {
        // 若是视频文件，加入结果列表
        const ext = path.extname(file).toLowerCase();
        if (videoExtensions.includes(ext)) {
          result.push({
            name: file,
            path: fullPath,
            isDir: false,
            size: stat.size,
            mtime: stat.mtimeMs
          });
        }
      }
    }
  } catch (err) {
    console.error(`Error scanning directory ${dirPath}:`, err);
  }

  // 排序：目录在前，文件在后；名称字母排序
  return result.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

// 3. 创建应用窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    titleBarStyle: 'default', // 标准窗口控制栏，贴合原生质感
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false, // 禁用后台限频，确保窗口在失焦/后台时定时器依然精准无阻地走字
    },
  });

  // 开发环境加载 Vite dev server，生产环境加载 dist/index.html
  if (!app.isPackaged) {
    mainWindow.loadURL('http://127.0.0.1:5173');
    mainWindow.webContents.openDevTools();

    // 自动重试机制：防止 concurrently 并行启动时 Vite Dev Server 还没完全就绪而白屏
    mainWindow.webContents.on('did-fail-load', () => {
      console.log('Vite 服务尚未完全就绪，正在尝试重连...');
      setTimeout(() => {
        if (mainWindow) {
          mainWindow.loadURL('http://127.0.0.1:5173');
        }
      }, 1000);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 4. 初始化应用生命周期与 IPC 监听器
app.whenReady().then(() => {
  // 启动流服务器
  startStreamServer();

  // 注册 IPC Handler 供 preload 调用
  
  // 选择文件夹对话框
  ipcMain.handle('dialog:selectFolder', async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    if (canceled || filePaths.length === 0) {
      return null;
    }
    return filePaths[0];
  });

  // 选择文件对话框（用于指定备份等）
  ipcMain.handle('dialog:selectFile', async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile']
    });
    if (canceled || filePaths.length === 0) {
      return null;
    }
    return filePaths[0];
  });

  // 扫描文件夹下的视频文件
  ipcMain.handle('fs:scanFolder', async (_event, folderPath: string) => {
    if (!fs.existsSync(folderPath)) return [];
    return scanDirectory(folderPath);
  });

  // 保存持久化数据到 AppData
  ipcMain.handle('db:save', async (_event, key: string, data: any) => {
    try {
      const filePath = getDataFilePath(key);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error(`Error saving data for key ${key}:`, err);
      return false;
    }
  });

  // 读取持久化数据
  ipcMain.handle('db:get', async (_event, key: string) => {
    try {
      const filePath = getDataFilePath(key);
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      console.error(`Error reading data for key ${key}:`, err);
      return null;
    }
  });

  // 获取本地视频转接 HTTP 的播放 URL
  ipcMain.handle('stream:getUrl', (_event, absolutePath: string) => {
    // 对路径进行 base64 编码，防止中文或特殊字符在 URL 传参时解析出错
    const base64Path = Buffer.from(absolutePath).toString('base64');
    return `http://127.0.0.1:${streamPort}/video?path=${encodeURIComponent(base64Path)}`;
  });

  // 唤起并聚焦主窗口
  ipcMain.handle('window:focus', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      return true;
    }
    return false;
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
  if (streamServer) {
    streamServer.close();
  }
});
