import React, { useState, useEffect } from 'react';
import { storageService, AppSettings } from '../services/storage';
import { syncService } from '../services/sync';

interface SettingsProps {
  refreshSignal: number;
  onRefresh: () => void;
}

export default function Settings({ refreshSignal, onRefresh }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>({ idleTimeout: 15, autoSync: false });
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'failed'>('idle');
  const [syncMsg, setSyncMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  // 表单状态
  const [webdavUrl, setWebdavUrl] = useState('');
  const [webdavUser, setWebdavUser] = useState('');
  const [webdavPassword, setWebdavPassword] = useState('');
  const [idleTimeout, setIdleTimeout] = useState(15);
  const [autoSync, setAutoSync] = useState(false);

  useEffect(() => {
    storageService.loadData().then(data => {
      setSettings(data.settings);
      setIdleTimeout(data.settings.idleTimeout || 15);
      setAutoSync(data.settings.autoSync || false);
      setWebdavUrl(data.settings.webdavSyncUrl || '');
      setWebdavUser(data.settings.webdavUser || '');
      setWebdavPassword(data.settings.webdavPassword || '');
    });
  }, [refreshSignal]);

  const handleSaveSettings = async (updates: Partial<AppSettings>) => {
    const updatedSettings = { ...settings, ...updates };
    setSettings(updatedSettings);
    await storageService.saveData({ settings: updatedSettings });
    onRefresh();
    showToast('设置已自动保存');
  };

  // 手动执行 WebDAV 同步
  const handleSync = async () => {
    // 先保存当前的 WebDAV 配置
    const currentSettings: AppSettings = {
      idleTimeout,
      autoSync,
      webdavSyncUrl: webdavUrl,
      webdavUser,
      webdavPassword
    };
    
    await storageService.saveData({ settings: currentSettings });
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
    <div className="max-w-[800px] mx-auto py-8 px-4 h-full overflow-y-auto custom-scrollbar">
      <header className="mb-8">
        <h2 className="text-2xl font-headline font-extrabold text-on-surface tracking-tight">系统设置</h2>
        <p className="text-sm text-on-surface-variant mt-1">
          个性化您的学习体验，配置 WebDAV 实现多端数据自动同步
        </p>
      </header>

      <div className="space-y-6">
        {/* 1. 云端同步配置 */}
        <section className="apple-card rounded-2xl p-6 bg-white/80">
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

            <div className="grid grid-cols-2 gap-4">
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
        <section className="apple-card rounded-2xl p-6 bg-white/80">
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
          </div>
        </section>

        {/* 3. 核心快捷键说明 */}
        <section className="apple-card rounded-2xl p-6 bg-white/80">
          <h3 className="font-bold text-base text-on-surface mb-4">核心快捷键 (ArtPlayer 内置)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center gap-4 p-3 bg-black/[0.01] border border-black/5 rounded-xl">
              <div className="keycap min-w-16 h-8 px-2.5 rounded-lg flex items-center justify-center font-bold text-xs">
                空格键
              </div>
              <div>
                <p className="text-xs font-semibold text-on-surface">播放 / 暂停</p>
                <p className="text-[10px] text-on-surface-variant">快速控制视频播放状态</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4 p-3 bg-black/[0.01] border border-black/5 rounded-xl">
              <div className="keycap min-w-16 h-8 px-2.5 rounded-lg flex items-center justify-center font-bold text-xs">
                ← / →
              </div>
              <div>
                <p className="text-xs font-semibold text-on-surface">快退 5s / 快进 5s</p>
                <p className="text-[10px] text-on-surface-variant">精准定位课程讲解点</p>
              </div>
            </div>

            <div className="flex items-center gap-4 p-3 bg-black/[0.01] border border-black/5 rounded-xl">
              <div className="keycap min-w-16 h-8 px-2.5 rounded-lg flex items-center justify-center font-bold text-xs">
                ↑ / ↓
              </div>
              <div>
                <p className="text-xs font-semibold text-on-surface">音量调大 / 调小</p>
                <p className="text-[10px] text-on-surface-variant">步长为 10%</p>
              </div>
            </div>

            <div className="flex items-center gap-4 p-3 bg-black/[0.01] border border-black/5 rounded-xl">
              <div className="keycap min-w-16 h-8 px-2.5 rounded-lg flex items-center justify-center font-bold text-xs">
                双击视频
              </div>
              <div>
                <p className="text-xs font-semibold text-on-surface">进入 / 退出全屏</p>
                <p className="text-[10px] text-on-surface-variant">沉浸式无干扰学习</p>
              </div>
            </div>
          </div>
        </section>
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
