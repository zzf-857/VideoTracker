import React, { useState, useEffect } from 'react';
import { storageService, AppSettings, formatHotkeyForDisplay } from '../services/storage';
import { syncService } from '../services/sync';

interface SettingsProps {
  refreshSignal: number;
  onRefresh: () => void;
}export default function Settings({ refreshSignal, onRefresh }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>({
    idleTimeout: 15,
    autoSync: false,
    hotkeys: {
      fullscreen: 'f',
      speedUp: 'c',
      speedDown: 'x',
      speedReset: 'z',
      search: 'ctrl+f'
    },
    pauseOnBlur: true
  });
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'failed'>('idle');
  const [syncMsg, setSyncMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  // 表单状态
  const [webdavUrl, setWebdavUrl] = useState('');
  const [webdavUser, setWebdavUser] = useState('');
  const [webdavPassword, setWebdavPassword] = useState('');
  const [idleTimeout, setIdleTimeout] = useState(15);
  const [autoSync, setAutoSync] = useState(false);
  const [pauseOnBlur, setPauseOnBlur] = useState(true);
  const [autoPlayNext, setAutoPlayNext] = useState(false);

  // 当前正在录制的快捷键字段名
  const [activeHotkeyKey, setActiveHotkeyKey] = useState<string | null>(null);

  // 本地数据路径管理状态
  const [storagePath, setStoragePath] = useState('');
  const [storageSize, setStorageSize] = useState('0 B');
  const [newSelectedPath, setNewSelectedPath] = useState('');
  const [isMigrating, setIsMigrating] = useState(false);
  const [defaultAppPath, setDefaultAppPath] = useState('');

  // 自动更新状态
  const [updateStatus, setUpdateStatus] = useState<string>('idle');
  const [updateStatusText, setUpdateStatusText] = useState<string>('');
  const [downloadPercent, setDownloadPercent] = useState<number>(0);
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    storageService.loadData().then(data => {
      setSettings(data.settings);
      setIdleTimeout(data.settings.idleTimeout || 15);
      setAutoSync(data.settings.autoSync || false);
      setPauseOnBlur(data.settings.pauseOnBlur ?? true);
      setAutoPlayNext(data.settings.autoPlayNext ?? false);
      setWebdavUrl(data.settings.webdavSyncUrl || '');
      setWebdavUser(data.settings.webdavUser || '');
      setWebdavPassword(data.settings.webdavPassword || '');
    });

    if (window.electronAPI) {
      if (window.electronAPI.getStoragePath) {
        window.electronAPI.getStoragePath().then((path: string) => {
          setStoragePath(path);
        });
      }
      if (window.electronAPI.getStorageSize) {
        window.electronAPI.getStorageSize().then((size: string) => {
          setStorageSize(size);
        });
      }
      if (window.electronAPI.getDefaultAppPath) {
        window.electronAPI.getDefaultAppPath().then((path: string) => {
          setDefaultAppPath(path);
        });
      }
      if (window.electronAPI.getVersion) {
        window.electronAPI.getVersion().then((ver: string) => {
          setAppVersion(ver);
        });
      }
    }
  }, [refreshSignal]);

  const handleSaveSettings = async (updates: Partial<AppSettings>) => {
    const updatedSettings = await storageService.updateSettings(updates);
    setSettings(updatedSettings);
    onRefresh();
    showToast('设置已自动保存');
  };

  const handleResetToDefaults = async () => {
    const defaultSettings: AppSettings = {
      idleTimeout: 15,
      autoSync: false,
      hotkeys: {
        fullscreen: 'f',
        speedUp: 'c',
        speedDown: 'x',
        speedReset: 'z',
        search: 'ctrl+f'
      },
      pauseOnBlur: true,
      autoPlayNext: false,
      dailyHours: 1.5,
      dailyEpisodes: 3,
      playbackSpeed: 1.25,
      isSidebarCollapsed: false,
      viewMode: 'tree',
      sortBy: 'name',
      sortOrder: 'asc',
      expandedPaths: {}
    };
    setIdleTimeout(15);
    setAutoSync(false);
    setPauseOnBlur(true);
    setAutoPlayNext(false);
    setWebdavUrl('');
    setWebdavUser('');
    setWebdavPassword('');
    
    setSettings(defaultSettings);
    await storageService.updateSettings(defaultSettings);

    // 一键重置数据路径
    if (window.electronAPI && window.electronAPI.resetStoragePath) {
      try {
        const res = await window.electronAPI.resetStoragePath();
        if (res && res.success) {
          setStoragePath(res.defaultPath);
          setNewSelectedPath('');
          if (window.electronAPI.getStorageSize) {
            const size = await window.electronAPI.getStorageSize();
            setStorageSize(size);
          }
        }
      } catch (err) {
        console.error('Failed to reset storage path:', err);
      }
    }

    onRefresh();
    showToast('已重置为默认设置');
  };

  const handleChangeStoragePath = async () => {
    if (!window.electronAPI || !window.electronAPI.selectFolder) {
      alert('该功能仅在桌面端可用');
      return;
    }
    const chosenPath = await window.electronAPI.selectFolder();
    if (!chosenPath) return;

    if (chosenPath === storagePath) {
      showToast('所选路径与当前数据存储路径相同');
      return;
    }

    setNewSelectedPath(chosenPath);
  };

  const handleOpenFolder = async () => {
    if (window.electronAPI && window.electronAPI.openStorageFolder) {
      const opened = await window.electronAPI.openStorageFolder();
      if (!opened) {
        showToast('打开文件夹失败，请检查目录是否存在');
      }
    } else {
      alert('该功能仅在桌面端可用');
    }
  };

  const handleOpenDefaultFolder = async () => {
    if (window.electronAPI && window.electronAPI.openDefaultAppFolder) {
      const opened = await window.electronAPI.openDefaultAppFolder();
      if (!opened) {
        showToast('打开缓存文件夹失败');
      }
    } else {
      alert('该功能仅在桌面端可用');
    }
  };

  const handleMigrate = async () => {
    if (!newSelectedPath) return;
    if (!window.electronAPI || !window.electronAPI.migrateStorage) return;
    setIsMigrating(true);
    try {
      const res = await window.electronAPI.migrateStorage(newSelectedPath, true);
      if (res && res.success) {
        setStoragePath(res.newPath);
        setNewSelectedPath('');
        showToast('数据一键迁移成功并切换路径');
        
        // 重新读取新路径下的文件大小
        if (window.electronAPI.getStorageSize) {
          const size = await window.electronAPI.getStorageSize();
          setStorageSize(size);
        }
        
        // 重新加载配置
        onRefresh();
      } else {
        alert(res?.error || '迁移失败');
      }
    } catch (err: any) {
      console.error(err);
      alert('发生错误：' + (err.message || err));
    } finally {
      setIsMigrating(false);
    }
  };

  // 监听自动更新消息与手动检查更新
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onUpdateMessage) return;

    const unsubscribe = window.electronAPI.onUpdateMessage((data: any) => {
      const { status, isPortable, version, percent, error } = data;
      
      if (isPortable) {
        setUpdateStatus('portable');
        setUpdateStatusText('当前为便携版，请前往 GitHub 手动下载最新版');
        return;
      }

      setUpdateStatus(status);
      switch (status) {
        case 'checking':
          setUpdateStatusText('正在检查更新...');
          break;
        case 'available':
          setUpdateStatusText(`发现新版本 v${version}，正在后台下载...`);
          break;
        case 'latest':
          setUpdateStatusText('当前已是最新版本');
          break;
        case 'downloading':
          setUpdateStatusText(`正在下载更新包...`);
          setDownloadPercent(Math.round(percent || 0));
          break;
        case 'downloaded':
          setUpdateStatusText(`新版本 v${version} 已下载完成`);
          break;
        case 'error':
          setUpdateStatusText(`更新失败: ${error || '网络连接异常'}`);
          break;
        default:
          break;
      }
    });

    return () => unsubscribe();
  }, []);

  const handleManualCheckUpdate = async () => {
    if (!window.electronAPI || !window.electronAPI.checkUpdates) return;
    setUpdateStatus('checking');
    setUpdateStatusText('正在连接 GitHub 检查更新...');
    const res = await window.electronAPI.checkUpdates();
    if (!res.success) {
      setUpdateStatus('error');
      setUpdateStatusText(`检查更新失败: ${res.error || '无法连接到服务器'}`);
    }
  };

  const handleQuitAndInstall = () => {
    if (window.electronAPI && window.electronAPI.quitAndInstall) {
      window.electronAPI.quitAndInstall();
    }
  };

  // 全局捕获监听器以安全录制快捷键
  useEffect(() => {
    if (!activeHotkeyKey) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // 阻止所有系统和浏览器默认按键行为 (包括 F5 刷新、F11 全屏、Space/Enter 触发 click 等)
      e.preventDefault();
      e.stopPropagation();

      let key = e.key.toLowerCase();

      // 按下 Escape 键时取消录制
      if (e.key === 'Escape') {
        setActiveHotkeyKey(null);
        return;
      }

      if (e.key === ' ') {
        key = 'space';
      }

      // 忽略单纯的修饰键
      if (['control', 'shift', 'alt', 'meta'].includes(key)) {
        return;
      }

      // 组装修饰键组合
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('ctrl');
      if (e.altKey) parts.push('alt');
      if (e.shiftKey) parts.push('shift');
      parts.push(key);
      const hotkeyStr = parts.join('+');

      const updatedHotkeys = {
        ...settings.hotkeys,
        [activeHotkeyKey]: hotkeyStr
      };

      handleSaveSettings({ hotkeys: updatedHotkeys });
      setActiveHotkeyKey(null);
    };

    // 使用捕获模式确保在任何地方都能提前拦截按键
    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
    };
  }, [activeHotkeyKey, settings]);
  // 手动执行 WebDAV 同步
  const handleSync = async () => {
    // 先保存当前的 WebDAV 配置
    const currentSettings: Partial<AppSettings> = {
      idleTimeout,
      autoSync,
      pauseOnBlur,
      autoPlayNext,
      webdavSyncUrl: webdavUrl,
      webdavUser,
      webdavPassword,
      hotkeys: settings.hotkeys
    };
    
    await storageService.updateSettings(currentSettings);
    setSyncStatus('syncing');
    setSyncMsg('正在与 WebDAV 同步进度数据...');

    const result = await syncService.sync();
    
    if (result.success) {
      setSyncStatus('success');
      setSyncMsg(result.message);
      onRefresh(); // 刷新本地缓存与日历
    } else {
      setSyncStatus('failed');
      setSyncMsg(result.message);
    }
    showToast(result.message);
  };

  const showToast = (msg: string) => {
    setSyncMsg(msg);
    setToastVisible(true);
    setTimeout(() => {
      setToastVisible(false);
    }, 3000);
  };

  return (
    <div className="w-full py-8 px-8 h-full overflow-y-auto custom-scrollbar">
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-headline font-extrabold text-on-surface tracking-tight">系统设置</h2>
          <p className="text-sm text-on-surface-variant mt-1">
            个性化您的学习体验，配置 WebDAV 实现多端数据自动同步
          </p>
        </div>
        
        <button
          onClick={handleResetToDefaults}
          className="py-1.5 px-3 border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 active:scale-95 text-red-600 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
        >
          <span className="material-symbols-outlined text-[16px]">restart_alt</span>
          一键重置
        </button>
      </header>

      {/* 使用双列自适应布局，充分利用右侧显示空间 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* 左侧栏：云端同步配置 & 通用学习偏好 */}
        <div className="space-y-6">
          {/* 1. 云端同步配置 */}
          <section className="apple-card rounded-2xl p-6 bg-white/80 transition-all hover:shadow-md">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="font-bold text-base text-on-surface">WebDAV 云端同步</h3>
                <p className="text-xs text-on-surface-variant mt-0.5">将播放进度、学习时长与历史记录同步至个人云盘，实现多端同步</p>
              </div>
              <span className={`px-2.5 py-0.5 font-bold text-[10px] rounded-full border ${
                webdavUrl 
                  ? 'bg-green-50 text-green-600 border-green-100' 
                  : 'bg-orange-50 text-orange-600 border-orange-100'
              }`}>
                {webdavUrl ? '已配置' : '未连接'}
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">WebDAV 同步文件夹地址</label>
                <input
                  type="url"
                  placeholder="https://dav.jianguoyun.com/dav/VideoTracker"
                  value={webdavUrl}
                  onChange={(e) => setWebdavUrl(e.target.value)}
                  onBlur={() => handleSaveSettings({ webdavSyncUrl: webdavUrl })}
                  className="w-full bg-white border border-black/10 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder-on-surface-variant/30"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">同步用户名</label>
                  <input
                    type="text"
                    placeholder="用户名"
                    value={webdavUser}
                    onChange={(e) => setWebdavUser(e.target.value)}
                    onBlur={() => handleSaveSettings({ webdavUser: webdavUser })}
                    className="w-full bg-white border border-black/10 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder-on-surface-variant/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">应用密码 / Token</label>
                  <input
                    type="password"
                    placeholder="授权应用密码"
                    value={webdavPassword}
                    onChange={(e) => setWebdavPassword(e.target.value)}
                    onBlur={() => handleSaveSettings({ webdavPassword: webdavPassword })}
                    className="w-full bg-white border border-black/10 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder-on-surface-variant/30"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-black/5">
                <div>
                  <p className="font-semibold text-sm text-on-surface">退出时自动同步</p>
                  <p className="text-[11px] text-on-surface-variant">每次关闭软件时自动与云端合并备份</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoSync}
                    onChange={(e) => {
                      setAutoSync(e.target.checked);
                      handleSaveSettings({ autoSync: e.target.checked });
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-[#E9E9EA] rounded-full peer-checked:bg-green-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full shadow-sm" />
                </label>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleSync}
                  disabled={syncStatus === 'syncing'}
                  className="py-2 px-4 bg-primary text-white text-xs font-bold rounded-xl flex items-center gap-1.5 hover:opacity-90 active:scale-95 transition-all shadow-md shadow-primary/10"
                >
                  <span className="material-symbols-outlined text-[16px]">sync</span>
                  {syncStatus === 'syncing' ? '同步中...' : '立即与云端同步'}
                </button>
              </div>
            </div>
          </section>

          {/* 2. 通用学习偏好设置 */}
          <section className="apple-card rounded-2xl p-6 bg-white/80 transition-all hover:shadow-md">
            <h3 className="font-bold text-base text-on-surface mb-4">学习专注偏好</h3>
            
            <div className="space-y-5">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <div>
                    <p className="font-semibold text-sm text-on-surface">防挂机闲置超时：<span className="text-primary font-bold">{idleTimeout} 分钟</span></p>
                    <p className="text-[11px] text-on-surface-variant">无鼠标键盘操作超过该时长，视频和计时将自动暂停</p>
                  </div>
                </div>
                <input
                  type="range"
                  min="1"
                  max="60"
                  value={idleTimeout}
                  onChange={(e) => setIdleTimeout(parseInt(e.target.value, 10))}
                  onMouseUp={() => handleSaveSettings({ idleTimeout })}
                  onTouchEnd={() => handleSaveSettings({ idleTimeout })}
                  className="w-full cursor-pointer accent-primary"
                />
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-black/5">
                <div>
                  <p className="font-semibold text-sm text-on-surface">失去焦点自动暂停</p>
                  <p className="text-[11px] text-on-surface-variant">当播放器窗口失去焦点时，自动暂停视频播放</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pauseOnBlur}
                    onChange={(e) => {
                      setPauseOnBlur(e.target.checked);
                      handleSaveSettings({ pauseOnBlur: e.target.checked });
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-[#E9E9EA] rounded-full peer-checked:bg-green-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full shadow-sm" />
                </label>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-black/5">
                <div>
                  <p className="font-semibold text-sm text-on-surface">自动连播</p>
                  <p className="text-[11px] text-on-surface-variant">自动播放列表中的下一个视频，完美适配树状与平铺列表</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoPlayNext}
                    onChange={(e) => {
                      setAutoPlayNext(e.target.checked);
                      handleSaveSettings({ autoPlayNext: e.target.checked });
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-[#E9E9EA] rounded-full peer-checked:bg-green-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full shadow-sm" />
                </label>
              </div>
            </div>
          </section>

          {/* 3. 本地数据路径管理 */}
          <section className="apple-card rounded-2xl p-6 bg-white/80 transition-all hover:shadow-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-base text-on-surface">本地数据路径管理</h3>
              <span className="text-xs font-bold text-primary bg-primary/5 px-2.5 py-1 rounded-lg">
                数据大小: {storageSize}
              </span>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">当前数据存储路径</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={storagePath}
                    className="flex-1 bg-black/[0.02] border border-black/10 rounded-xl px-3 py-2 text-xs text-on-surface-variant focus:outline-none truncate"
                    title={storagePath}
                  />
                  <button
                    onClick={handleOpenFolder}
                    className="px-3 py-2 bg-black/[0.04] text-on-surface hover:bg-black/[0.08] active:scale-95 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1"
                    title="在文件管理器中打开该文件夹"
                  >
                    <span className="material-symbols-outlined text-[16px]">folder_open</span>
                    打开文件夹
                  </button>
                  <button
                    onClick={handleChangeStoragePath}
                    className="px-3 py-2 bg-primary text-white hover:opacity-90 active:scale-95 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md shadow-primary/10"
                  >
                    修改路径
                  </button>
                </div>
              </div>

              {newSelectedPath && (
                <div className="pt-3 border-t border-black/5 animate-fade-in">
                  <label className="block text-xs font-bold text-amber-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">warning</span>
                    已选择新目标路径（等待转移）
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={newSelectedPath}
                      className="flex-1 bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2 text-xs text-amber-700 focus:outline-none truncate"
                      title={newSelectedPath}
                    />
                    <button
                      onClick={handleMigrate}
                      disabled={isMigrating}
                      className="px-4 py-2 bg-amber-500 text-white hover:bg-amber-600 active:scale-95 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-md shadow-amber-500/10"
                    >
                      <span className="material-symbols-outlined text-[16px]">double_arrow</span>
                      {isMigrating ? '转移中...' : '转移'}
                    </button>
                  </div>
                  <p className="text-[10px] text-amber-600/80 mt-1.5 leading-relaxed">
                    点击“转移”按钮，将在后台无感直接移动所有学习数据到新目录下，完成后自动切换并更新状态，无弹窗打扰。
                  </p>
                </div>
              )}

              {/* 系统缓存与临时文件部分 */}
              <div className="pt-3 border-t border-black/5">
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider">系统缓存与临时目录</label>
                  <button
                    onClick={handleOpenDefaultFolder}
                    className="px-2.5 py-1 bg-black/[0.04] text-on-surface hover:bg-black/[0.08] active:scale-95 text-[11px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1"
                    title="在文件管理器中打开系统缓存目录"
                  >
                    <span className="material-symbols-outlined text-[13px]">folder_open</span>
                    打开缓存目录
                  </button>
                </div>
                <div className="p-3 bg-black/[0.01] border border-black/5 rounded-xl text-xs space-y-1.5">
                  <div className="text-[10px] font-mono break-all text-on-surface-variant/80 select-all" title="双击或拖拽可复制">
                    {defaultAppPath}
                  </div>
                  <p className="text-[10px] text-on-surface-variant leading-relaxed">
                    <strong>💡 缓存建议：</strong>该目录包含网页及 GPU 硬件加速缓存，会随着播放与页面访问逐渐增加，但 Chromium 内核会自动将总大小限制在 200MB - 500MB 以内并在达到上限后执行自动清理，不会无限变大。您可以随时手动清除该目录下除 <code className="bg-black/5 px-1 py-0.2 rounded text-primary">path_config.json</code> 以外的所有缓存文件夹。<strong>是否清理最终取决于您自己。</strong>
                  </p>
                </div>
              </div>

              <p className="text-[10px] text-on-surface-variant/80 leading-relaxed pt-1">
                提示：默认保存在系统 AppData 目录下。修改路径可以将学习进度、配置等存放到您的云同步同步盘或其它目录。在一键重置设置时，存储路径也会一并恢复为默认。
              </p>
            </div>
          </section>
        </div>

        {/* 右侧栏：系统自定义快捷键 */}
        <div className="space-y-6">
          {/* 3. 系统自定义快捷键设置 */}
          <section className="apple-card rounded-2xl p-6 bg-white/80 transition-all hover:shadow-md">
            <div className="mb-4">
              <h3 className="font-bold text-base text-on-surface">系统自定义快捷键</h3>
              <p className="text-xs text-on-surface-variant mt-0.5">点击右侧按键卡片即可进入录制状态，按下键盘上的任意按键进行重新绑定</p>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div className="flex items-center justify-between p-3 bg-black/[0.01] border border-black/5 rounded-xl">
                <div>
                  <p className="text-xs font-semibold text-on-surface">进入 / 退出全屏</p>
                  <p className="text-[10px] text-on-surface-variant">快速控制视频全屏状态</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveHotkeyKey('fullscreen')}
                  className={`min-w-20 h-8 px-3 rounded-lg flex items-center justify-center font-bold text-xs cursor-pointer select-none transition-all shadow-sm ${
                    activeHotkeyKey === 'fullscreen'
                      ? 'bg-primary text-white scale-95 border-primary shadow-inner animate-pulse'
                      : 'bg-white border border-black/10 text-primary hover:border-primary/40 hover:bg-black/[0.01] active:scale-95'
                  }`}
                  title="点击重新录制绑定按键"
                >
                  {activeHotkeyKey === 'fullscreen' ? '录制中... (Esc取消)' : formatHotkeyForDisplay(settings.hotkeys?.fullscreen || 'f')}
                </button>
              </div>

              <div className="flex items-center justify-between p-3 bg-black/[0.01] border border-black/5 rounded-xl">
                <div>
                  <p className="text-xs font-semibold text-on-surface">增加播放倍速 (+0.1)</p>
                  <p className="text-[10px] text-on-surface-variant">每次增加 0.1 倍播放速度</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveHotkeyKey('speedUp')}
                  className={`min-w-20 h-8 px-3 rounded-lg flex items-center justify-center font-bold text-xs cursor-pointer select-none transition-all shadow-sm ${
                    activeHotkeyKey === 'speedUp'
                      ? 'bg-primary text-white scale-95 border-primary shadow-inner animate-pulse'
                      : 'bg-white border border-black/10 text-primary hover:border-primary/40 hover:bg-black/[0.01] active:scale-95'
                  }`}
                  title="点击重新录制绑定按键"
                >
                  {activeHotkeyKey === 'speedUp' ? '录制中... (Esc取消)' : formatHotkeyForDisplay(settings.hotkeys?.speedUp || 'c')}
                </button>
              </div>

              <div className="flex items-center justify-between p-3 bg-black/[0.01] border border-black/5 rounded-xl">
                <div>
                  <p className="text-xs font-semibold text-on-surface">减少播放倍速 (-0.1)</p>
                  <p className="text-[10px] text-on-surface-variant">每次减少 0.1 倍播放速度</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveHotkeyKey('speedDown')}
                  className={`min-w-20 h-8 px-3 rounded-lg flex items-center justify-center font-bold text-xs cursor-pointer select-none transition-all shadow-sm ${
                    activeHotkeyKey === 'speedDown'
                      ? 'bg-primary text-white scale-95 border-primary shadow-inner animate-pulse'
                      : 'bg-white border border-black/10 text-primary hover:border-primary/40 hover:bg-black/[0.01] active:scale-95'
                  }`}
                  title="点击重新录制绑定按键"
                >
                  {activeHotkeyKey === 'speedDown' ? '录制中... (Esc取消)' : formatHotkeyForDisplay(settings.hotkeys?.speedDown || 'x')}
                </button>
              </div>

              <div className="flex items-center justify-between p-3 bg-black/[0.01] border border-black/5 rounded-xl">
                <div>
                  <p className="text-xs font-semibold text-on-surface">重置播放倍速 (1.0x)</p>
                  <p className="text-[10px] text-on-surface-variant">一键将播放速度恢复到原速</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveHotkeyKey('speedReset')}
                  className={`min-w-20 h-8 px-3 rounded-lg flex items-center justify-center font-bold text-xs cursor-pointer select-none transition-all shadow-sm ${
                    activeHotkeyKey === 'speedReset'
                      ? 'bg-primary text-white scale-95 border-primary shadow-inner animate-pulse'
                      : 'bg-white border border-black/10 text-primary hover:border-primary/40 hover:bg-black/[0.01] active:scale-95'
                  }`}
                  title="点击重新录制绑定按键"
                >
                  {activeHotkeyKey === 'speedReset' ? '录制中... (Esc取消)' : formatHotkeyForDisplay(settings.hotkeys?.speedReset || 'z')}
                </button>
              </div>

              <div className="flex items-center justify-between p-3 bg-black/[0.01] border border-black/5 rounded-xl">
                <div>
                  <p className="text-xs font-semibold text-on-surface">大纲搜索框聚焦</p>
                  <p className="text-[10px] text-on-surface-variant">快速将光标移入侧边栏视频搜索框</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveHotkeyKey('search')}
                  className={`min-w-20 h-8 px-3 rounded-lg flex items-center justify-center font-bold text-xs cursor-pointer select-none transition-all shadow-sm ${
                    activeHotkeyKey === 'search'
                      ? 'bg-primary text-white scale-95 border-primary shadow-inner animate-pulse'
                      : 'bg-white border border-black/10 text-primary hover:border-primary/40 hover:bg-black/[0.01] active:scale-95'
                  }`}
                  title="点击重新录制绑定按键"
                >
                  {activeHotkeyKey === 'search' ? '录制中... (Esc取消)' : formatHotkeyForDisplay(settings.hotkeys?.search || 'ctrl+f')}
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-black/5">
              <h4 className="font-bold text-xs text-on-surface-variant uppercase tracking-wider mb-3">播放器内置默认快捷键</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-center gap-4 p-3 bg-black/[0.01] border border-black/5 rounded-xl">
                  <div className="keycap min-w-16 h-8 px-2.5 rounded-lg flex items-center justify-center font-bold text-xs select-none">
                    空格键
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-on-surface">播放 / 暂停</p>
                    <p className="text-[10px] text-on-surface-variant">快速控制视频播放状态</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4 p-3 bg-black/[0.01] border border-black/5 rounded-xl">
                  <div className="keycap min-w-16 h-8 px-2.5 rounded-lg flex items-center justify-center font-bold text-xs select-none">
                    ← / →
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-on-surface">快退 5s / 快进 5s</p>
                    <p className="text-[10px] text-on-surface-variant">精准定位课程讲解点</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-3 bg-black/[0.01] border border-black/5 rounded-xl">
                  <div className="keycap min-w-16 h-8 px-2.5 rounded-lg flex items-center justify-center font-bold text-xs select-none">
                    ↑ / ↓
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-on-surface">音量调大 / 调小</p>
                    <p className="text-[10px] text-on-surface-variant">步长为 10%</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-3 bg-black/[0.01] border border-black/5 rounded-xl">
                  <div className="keycap min-w-16 h-8 px-2.5 rounded-lg flex items-center justify-center font-bold text-xs select-none">
                    双击视频
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-on-surface">进入 / 退出全屏</p>
                    <p className="text-[10px] text-on-surface-variant">沉浸式无干扰学习</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 4. 软件版本与自动更新 */}
          <section className="apple-card rounded-2xl p-6 bg-white/80 transition-all hover:shadow-md">
            <h3 className="font-bold text-base text-on-surface mb-4">版本与更新</h3>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-black/[0.01] border border-black/5 rounded-xl">
                <div>
                  <p className="text-xs font-semibold text-on-surface">当前软件版本</p>
                  <p className="text-[10px] text-on-surface-variant">当前运行的版本号</p>
                </div>
                <span className="text-xs font-bold bg-primary/10 text-primary px-3 py-1 rounded-full font-mono">
                  v{appVersion}
                </span>
              </div>

              <div className="p-3 bg-black/[0.01] border border-black/5 rounded-xl space-y-3">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-xs font-semibold text-on-surface">检查新版本</p>
                    <p className="text-[10px] text-on-surface-variant">连接 GitHub 获取最新版本</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleManualCheckUpdate}
                    disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                    className="py-1.5 px-4 bg-primary text-white text-xs font-bold rounded-xl flex items-center gap-1.5 hover:opacity-90 active:scale-95 transition-all shadow-md shadow-primary/10 disabled:opacity-50 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">sync</span>
                    {updateStatus === 'checking' ? '检查中...' : updateStatus === 'downloading' ? '正在下载...' : '立即检查'}
                  </button>
                </div>

                {/* 状态与进度条显示 */}
                {updateStatus !== 'idle' && (
                  <div className="pt-2 border-t border-black/[0.03] space-y-2 animate-fade-in">
                    <div className="flex justify-between items-center text-[10px] font-bold">
                      <span className="text-on-surface-variant">{updateStatusText}</span>
                      {updateStatus === 'downloading' && (
                        <span className="text-primary font-mono">{downloadPercent}%</span>
                      )}
                    </div>

                    {updateStatus === 'downloading' && (
                      <div className="w-full bg-black/[0.05] h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-primary h-full rounded-full transition-all duration-150"
                          style={{ width: `${downloadPercent}%` }}
                        />
                      </div>
                    )}

                    {updateStatus === 'downloaded' && (
                      <button
                        type="button"
                        onClick={handleQuitAndInstall}
                        className="w-full py-2 bg-green-500 hover:bg-green-600 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all shadow-md shadow-green-500/10 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                        下载完成，立即重启升级
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
      {/* 底部浮动通知 Toast */}
      <div className={`fixed bottom-10 right-10 flex items-center gap-3 bg-white/90 backdrop-blur-xl border border-black/5 px-5 py-3 rounded-xl shadow-xl transition-all duration-300 z-[100] ${
        toastVisible ? 'translate-y-0 opacity-100' : 'translate-y-16 opacity-0 pointer-events-none'
      }`}>
        <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
          <span className="material-symbols-outlined text-white text-[12px] font-bold">check</span>
        </div>
        <p className="text-xs font-semibold text-on-surface">{syncMsg}</p>
      </div>
    </div>
  );
}
