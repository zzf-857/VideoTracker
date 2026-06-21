import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as crypto from 'crypto';

let mainWindow: BrowserWindow | null = null;
let streamServer: http.Server | null = null;
let streamPort = 30005; // 本地流服务默认端口

// 获取实际数据存储目录绝对路径
const getStorageDirectory = () => {
  const defaultPath = app.getPath('userData');
  const configPathFile = path.join(defaultPath, 'path_config.json');
  try {
    if (fs.existsSync(configPathFile)) {
      const configContent = fs.readFileSync(configPathFile, 'utf-8');
      const config = JSON.parse(configContent);
      if (config && config.storagePath && fs.existsSync(config.storagePath)) {
        return config.storagePath;
      }
    }
  } catch (err) {
    console.error('Error reading path_config.json:', err);
  }
  return defaultPath;
};

// 数据文件路径
const getDataFilePath = (key: string) => {
  const baseDir = getStorageDirectory();
  return path.join(baseDir, `${key}.json`);
};

// 辅助函数：代理流式 HTTP 请求并自动跟踪 301/302 重定向（避开 Referer 和 CORS 限制）
function makeProxyRequest(
  targetUrlStr: string,
  clientReqHeaders: http.IncomingHttpHeaders,
  res: http.ServerResponse,
  activeRequestRef: { current: any },
  redirectCount = 0
) {
  if (redirectCount > 5) {
    res.writeHead(502);
    res.end('Too many redirects');
    return;
  }

  try {
    const targetUrl = new URL(targetUrlStr);
    const headers: Record<string, string> = {};

    if (clientReqHeaders.range) {
      headers['Range'] = clientReqHeaders.range;
    }

    if (targetUrl.username || targetUrl.password) {
      const username = decodeURIComponent(targetUrl.username);
      const password = decodeURIComponent(targetUrl.password);
      const creds = Buffer.from(`${username}:${password}`).toString('base64');
      headers['Authorization'] = `Basic ${creds}`;
      targetUrl.username = '';
      targetUrl.password = '';
    }

    const protocol = targetUrl.protocol === 'https:' ? require('https') : require('http');
    
    const proxyReq = protocol.request(targetUrl.toString(), {
      method: 'GET',
      headers: headers
    }, (proxyRes: any) => {
      const statusCode = proxyRes.statusCode;
      
      // 检测到重定向 (301, 302, 307, 308) 则在主进程中递归追踪，并自动剥离 Referer
      if ([301, 302, 307, 308].includes(statusCode) && proxyRes.headers.location) {
        const nextUrl = new URL(proxyRes.headers.location, targetUrl.toString()).toString();
        makeProxyRequest(nextUrl, clientReqHeaders, res, activeRequestRef, redirectCount + 1);
        return;
      }

      // 强加 CORS 头部以避开渲染进程的 Canvas 截图跨域限制
      proxyRes.headers['access-control-allow-origin'] = '*';
      proxyRes.headers['access-control-allow-methods'] = 'GET, OPTIONS';
      proxyRes.headers['access-control-allow-headers'] = 'Range';

      // 将最终响应的状态码及头部透传给渲染进程，并建立数据通道管道
      res.writeHead(statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err: any) => {
      console.error('Proxy stream request error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end(err.message || 'Proxy error');
      }
    });

    activeRequestRef.current = proxyReq;
    proxyReq.end();
  } catch (err: any) {
    console.error('Failed to parse target URL:', err);
    if (!res.headersSent) {
      res.writeHead(400);
      res.end('Invalid target URL');
    }
  }
}

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
      
      // 拦截缩略图请求
      if (urlObj.pathname === '/thumbnail') {
        const videoPath = urlObj.searchParams.get('videoPath');
        const time = urlObj.searchParams.get('time');
        if (!videoPath || !time) {
          res.writeHead(400);
          res.end('Missing parameters');
          return;
        }
        
        const hash = crypto.createHash('md5').update(videoPath).digest('hex');
        const baseDir = getStorageDirectory();
        const thumbPath = path.join(baseDir, 'thumbnails', hash, `${time}.jpg`);
        
        if (fs.existsSync(thumbPath)) {
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000'
          });
          fs.createReadStream(thumbPath).pipe(res);
        } else {
          res.writeHead(404);
          res.end('Thumbnail not found');
        }
        return;
      }

      const filePathQuery = urlObj.searchParams.get('path');
      if (!filePathQuery) {
        res.writeHead(400);
        res.end('Missing file path');
        return;
      }

      const cleanBase64 = filePathQuery.replace(/ /g, '+');
      const decodedPath = Buffer.from(cleanBase64, 'base64').toString('utf-8');
      console.log(`[Stream Server] Request URL: ${req.url}`);
      console.log(`[Stream Server] Decoded path: ${decodedPath}`);
      console.log(`[Stream Server] File exists: ${fs.existsSync(decodedPath)}`);
      
      if (decodedPath.startsWith('http://') || decodedPath.startsWith('https://')) {
        const activeRequestRef = { current: null as any };
        
        req.on('close', () => {
          if (activeRequestRef.current) {
            activeRequestRef.current.destroy();
          }
        });

        makeProxyRequest(decodedPath, req.headers, res, activeRequestRef);
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
  const preloadPath = path.join(__dirname, 'preload.js');
  const iconPath = path.join(__dirname, '../Assets/app.ico');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    titleBarStyle: 'default', // 标准窗口控制栏，贴合原生质感
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // 关闭跨域安全限制，允许隐藏 video 和 canvas 完美截图
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

    // 转发渲染进程的控制台日志
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[Renderer Console] ${message} (at ${sourceId}:${line})`);
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

  // 打开数据文件夹
  ipcMain.handle('db:openStorageFolder', async () => {
    try {
      const currentPath = getStorageDirectory();
      if (fs.existsSync(currentPath)) {
        const { shell } = require('electron');
        await shell.openPath(currentPath);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Error opening storage folder:', err);
      return false;
    }
  });

  // 获取当前数据占用大小
  ipcMain.handle('db:getStorageSize', async () => {
    try {
      const currentPath = getStorageDirectory();
      if (!fs.existsSync(currentPath)) return '0 B';
      const files = fs.readdirSync(currentPath);
      const jsonFiles = files.filter(f => f.endsWith('.json') && f !== 'path_config.json');
      let totalSize = 0;
      for (const file of jsonFiles) {
        const filePath = path.join(currentPath, file);
        const stat = fs.statSync(filePath);
        totalSize += stat.size;
      }
      
      if (totalSize === 0) return '0 B';
      if (totalSize < 1024) return `${totalSize} B`;
      if (totalSize < 1024 * 1024) return `${(totalSize / 1024).toFixed(1)} KB`;
      return `${(totalSize / (1024 * 1024)).toFixed(1)} MB`;
    } catch (err) {
      console.error('Error getting storage size:', err);
      return '未知';
    }
  });

  // 重置数据存储路径
  ipcMain.handle('db:resetStoragePath', async () => {
    try {
      const defaultPath = app.getPath('userData');
      const configPathFile = path.join(defaultPath, 'path_config.json');
      if (fs.existsSync(configPathFile)) {
        fs.unlinkSync(configPathFile);
      }
      return { success: true, defaultPath };
    } catch (err: any) {
      console.error('Reset storage path error:', err);
      return { success: false, error: err.message || '重置失败' };
    }
  });

  // 打开默认应用文件夹 (缓存目录)
  ipcMain.handle('db:openDefaultAppFolder', async () => {
    try {
      const defaultPath = app.getPath('userData');
      if (fs.existsSync(defaultPath)) {
        const { shell } = require('electron');
        await shell.openPath(defaultPath);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Error opening default AppData folder:', err);
      return false;
    }
  });

  // 获取默认应用路径
  ipcMain.handle('db:getDefaultAppPath', async () => {
    return app.getPath('userData');
  });

  // 获取当前数据存储路径
  ipcMain.handle('db:getStoragePath', async () => {
    return getStorageDirectory();
  });

  // 迁移数据存储路径
  ipcMain.handle('db:migrateStorage', async (_event, newPath: string, moveData: boolean) => {
    try {
      if (!fs.existsSync(newPath)) {
        return { success: false, error: '目标路径不存在' };
      }
      const stat = fs.statSync(newPath);
      if (!stat.isDirectory()) {
        return { success: false, error: '目标路径不是一个文件夹' };
      }

      const defaultPath = app.getPath('userData');
      const currentPath = getStorageDirectory();

      // 如果目标路径与当前路径相同，则直接返回成功
      if (path.resolve(currentPath) === path.resolve(newPath)) {
        return { success: true, message: '目标路径与当前路径相同' };
      }

      if (moveData) {
        // 读取当前路径下的所有 .json 文件（除 path_config.json 外）
        const files = fs.readdirSync(currentPath);
        const jsonFiles = files.filter(f => f.endsWith('.json') && f !== 'path_config.json');

        for (const file of jsonFiles) {
          const srcFile = path.join(currentPath, file);
          const destFile = path.join(newPath, file);
          fs.copyFileSync(srcFile, destFile);
        }

        // 删除旧路径下的 .json 文件（避免多份数据造成混乱，仅在删除成功时记录日志）
        for (const file of jsonFiles) {
          const srcFile = path.join(currentPath, file);
          try {
            fs.unlinkSync(srcFile);
          } catch (e) {
            console.error(`Failed to delete old file: ${srcFile}`, e);
          }
        }
      }

      // 更新 path_config.json 指向新位置
      const configPathFile = path.join(defaultPath, 'path_config.json');
      fs.writeFileSync(configPathFile, JSON.stringify({ storagePath: newPath }, null, 2), 'utf-8');

      return { success: true, newPath };
    } catch (err: any) {
      console.error('Migration error:', err);
      return { success: false, error: err.message || '迁移失败，请检查文件夹读写权限' };
    }
  });

  // 获取本地视频转接 HTTP 的播放 URL
  ipcMain.handle('stream:getUrl', (_event, absolutePath: string) => {
    // 对路径进行 base64 编码，防止中文或特殊字符在 URL 传参时解析出错
    const base64Path = Buffer.from(absolutePath).toString('base64');
    return `http://127.0.0.1:${streamPort}/video?path=${encodeURIComponent(base64Path)}`;
  });

  // 代理 WebDAV 网络请求，以避开渲染进程的 CORS 限制
  ipcMain.handle('webdav:request', async (_event, url: string, options: any) => {
    try {
      const response = await fetch(url, options);
      const status = response.status;
      const statusText = response.statusText;
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const text = await response.text();
      return { status, statusText, headers, text };
    } catch (err: any) {
      return { error: err.message };
    }
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

  // 检查缩略图存在性
  ipcMain.handle('thumbnails:check', async (_event, videoPath: string, times: number[]) => {
    try {
      const hash = crypto.createHash('md5').update(videoPath).digest('hex');
      const baseDir = getStorageDirectory();
      const folderPath = path.join(baseDir, 'thumbnails', hash);
      if (!fs.existsSync(folderPath)) {
        return [];
      }
      return times.filter(time => {
        return fs.existsSync(path.join(folderPath, `${time}.jpg`));
      });
    } catch (err) {
      console.error('Error checking thumbnails:', err);
      return [];
    }
  });

  // 保存缩略图
  ipcMain.handle('thumbnails:save', async (_event, videoPath: string, time: number, base64Data: string) => {
    try {
      const hash = crypto.createHash('md5').update(videoPath).digest('hex');
      const baseDir = getStorageDirectory();
      const folderPath = path.join(baseDir, 'thumbnails', hash);
      
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }
      
      const filePath = path.join(folderPath, `${time}.jpg`);
      const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, '');
      const dataBuffer = Buffer.from(base64Image, 'base64');
      
      fs.writeFileSync(filePath, dataBuffer);
      return true;
    } catch (err) {
      console.error('Error saving thumbnail:', err);
      return false;
    }
  });

  // 清除缩略图缓存
  ipcMain.handle('thumbnails:clear', async (_event, videoPath: string) => {
    try {
      const hash = crypto.createHash('md5').update(videoPath).digest('hex');
      const baseDir = getStorageDirectory();
      const folderPath = path.join(baseDir, 'thumbnails', hash);
      
      if (fs.existsSync(folderPath)) {
        fs.rmSync(folderPath, { recursive: true, force: true });
      }
      return true;
    } catch (err) {
      console.error('Error clearing thumbnails:', err);
      return false;
    }
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
