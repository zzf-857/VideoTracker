import React, { useState, useEffect } from 'react';
import { storageService, MediaSourceConfig } from '../services/storage';
import { WebDAVClient, WebDAVFile } from '../services/webdav';

interface SourceManagerProps {
  refreshSignal: number;
  onRefresh: () => void;
}

export default function SourceManager({ refreshSignal, onRefresh }: SourceManagerProps) {
  const [sources, setSources] = useState<MediaSourceConfig[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');

  // 新增挂载源表单状态
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceType, setNewSourceType] = useState<'local' | 'webdav' | 'alist'>('local');
  const [localPath, setLocalPath] = useState('');
  const [webdavUrl, setWebdavUrl] = useState('');
  const [webdavUser, setWebdavUser] = useState('');
  const [webdavPassword, setWebdavPassword] = useState('');

  // 文件夹浏览器相关状态
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [currentBrowsePath, setCurrentBrowsePath] = useState('');
  const [breadcrumbs, setBreadcrumbs] = useState<{ name: string; path: string }[]>([]);
  const [browserItems, setBrowserItems] = useState<WebDAVFile[]>([]);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState('');

  // 编辑挂载源名称状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const startEditing = (id: string, name: string) => {
    setEditingId(id);
    setEditingName(name);
  };

  const handleSaveEditedName = async (id: string) => {
    if (!editingName.trim()) {
      alert('请输入数据源名称');
      return;
    }
    const data = await storageService.loadData();
    const updatedSources = data.sources.map(s => {
      if (s.id === id) {
        return { ...s, name: editingName.trim() };
      }
      return s;
    });
    await storageService.saveData({ sources: updatedSources });
    setEditingId(null);
    onRefresh();
  };

  useEffect(() => {
    storageService.loadData().then(data => {
      setSources(data.sources);
    });
  }, [refreshSignal]);

  // 加载 WebDAV 指定路径目录
  const loadWebDAVFolder = async (path: string) => {
    setBrowserLoading(true);
    const client = new WebDAVClient(webdavUrl, webdavUser, webdavPassword);
    try {
      const files = await client.readDir(path);
      setBrowserItems(files);
      setCurrentBrowsePath(path);

      // 计算面包屑
      let basePath = '';
      try {
        basePath = new URL(webdavUrl).pathname;
      } catch {}
      if (basePath.endsWith('/')) basePath = basePath.slice(0, -1);

      let relativePath = path;
      if (basePath && path.startsWith(basePath)) {
        relativePath = path.substring(basePath.length);
      }

      const parts = relativePath.split('/').filter(Boolean);
      const crumbs = [{ name: '根目录', path: basePath || '/' }];

      let currentAcc = basePath || '';
      for (const part of parts) {
        currentAcc = `${currentAcc.endsWith('/') ? currentAcc.slice(0, -1) : currentAcc}/${part}`;
        crumbs.push({ name: part, path: currentAcc });
      }
      setBreadcrumbs(crumbs);
    } catch (err) {
      console.error('Failed to load folder:', err);
      alert('无法读取该目录: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBrowserLoading(false);
    }
  };

  const handleBrowseInto = (item: WebDAVFile) => {
    if (!item.isDir) return;
    loadWebDAVFolder(item.path);
  };

  const handleBreadcrumbClick = (crumbPath: string) => {
    loadWebDAVFolder(crumbPath);
  };

  const handleSelectCurrentDir = () => {
    setSelectedPath(currentBrowsePath);
  };

  // 选择本地文件夹 (Electron 专享 API)
  const handleSelectFolder = async () => {
    if ('electronAPI' in window) {
      const path = await (window as any).electronAPI.selectFolder();
      if (path) {
        setLocalPath(path);
        // 如果名字为空，自动用路径最后一段做名字
        if (!newSourceName) {
          const folderName = path.split(/[\\/]/).pop() || '本地媒体库';
          setNewSourceName(folderName);
        }
      }
    }
  };

  // 测试 WebDAV/Alist 连接
  const handleTestConnection = async () => {
    if (newSourceType === 'local') return;
    if (!webdavUrl) {
      alert('请输入服务地址');
      return;
    }

    setTestStatus('testing');
    const client = new WebDAVClient(webdavUrl, webdavUser, webdavPassword);
    const success = await client.testConnection();
    setTestStatus(success ? 'success' : 'failed');

    if (success) {
      setFolderBrowserOpen(true);
      let basePath = '';
      try {
        basePath = new URL(webdavUrl).pathname;
      } catch {}
      await loadWebDAVFolder(basePath || '');
    } else {
      setFolderBrowserOpen(false);
    }
  };

  // 保存挂载源
  const handleSaveSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceName.trim()) {
      alert('请输入资源名称');
      return;
    }

    let sourcePath = '';
    let settings = undefined;

    if (newSourceType === 'local') {
      if (!localPath) {
        alert('请选择本地文件夹');
        return;
      }
      sourcePath = localPath;
    } else {
      if (!webdavUrl) {
        alert('请输入服务地址');
        return;
      }
      const client = new WebDAVClient(webdavUrl, webdavUser, webdavPassword);
      sourcePath = client.resolveUrl(selectedPath);
      settings = {
        url: webdavUrl,
        username: webdavUser,
        password: webdavPassword
      };
    }

    const newSource: MediaSourceConfig = {
      id: Date.now().toString(),
      name: newSourceName,
      type: newSourceType,
      path: sourcePath,
      settings
    };

    const data = await storageService.loadData();
    const updatedSources = [...data.sources, newSource];
    
    await storageService.saveData({ sources: updatedSources });
    
    // 重置并关闭
    resetForm();
    onRefresh();
  };

  const handleDeleteSource = async (id: string) => {
    if (!confirm('确定要删除该挂载源吗？该操作不会删除您的物理文件。')) return;
    
    const data = await storageService.loadData();
    const updatedSources = data.sources.filter(s => s.id !== id);
    await storageService.saveData({ sources: updatedSources });
    onRefresh();
  };

  const resetForm = () => {
    setNewSourceName('');
    setNewSourceType('local');
    setLocalPath('');
    setWebdavUrl('');
    setWebdavUser('');
    setWebdavPassword('');
    setTestStatus('idle');
    setFolderBrowserOpen(false);
    setCurrentBrowsePath('');
    setBreadcrumbs([]);
    setBrowserItems([]);
    setSelectedPath('');
    setIsModalOpen(false);
  };

  return (
    <div className="max-w-[1000px] mx-auto py-8 px-4 h-full overflow-y-auto custom-scrollbar">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-headline font-extrabold text-on-surface tracking-tight">媒体库与挂载源</h2>
          <p className="text-sm text-on-surface-variant mt-1">
            添加或管理您的视频库，支持本地目录和云端 WebDAV / Alist 资源
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="py-2.5 px-5 bg-primary text-white text-xs font-bold rounded-xl flex items-center gap-2 hover:opacity-90 active:scale-95 transition-all shadow-md shadow-primary/10"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          添加挂载源
        </button>
      </header>

      {/* 挂载源网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {sources.map(source => (
          <div key={source.id} className="apple-card rounded-2xl p-5 flex flex-col bg-white/80 hover:shadow-md transition-shadow relative group">
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined">
                    {source.type === 'local' ? 'folder' : source.type === 'alist' ? 'dns' : 'cloud'}
                  </span>
                </div>
                <div>
                  {editingId === source.id ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={() => handleSaveEditedName(source.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSaveEditedName(source.id);
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                      autoFocus
                      className="font-bold text-xs text-on-surface bg-black/[0.04] border border-black/10 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary w-full max-w-[200px]"
                    />
                  ) : (
                    <h3 className="font-bold text-sm text-on-surface">{source.name}</h3>
                  )}
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider bg-black/5 px-2 py-0.5 rounded-md mt-1 inline-block">
                    {source.type === 'local' ? '本地目录' : source.type === 'alist' ? 'Alist 挂载' : 'WebDAV 挂载'}
                  </span>
                </div>
              </div>

              {/* 操作按钮组 */}
              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-all">
                <button
                  onClick={() => startEditing(source.id, source.name)}
                  className="w-8 h-8 rounded-full hover:bg-black/[0.04] text-on-surface-variant flex items-center justify-center transition-all cursor-pointer"
                  title="修改名称"
                >
                  <span className="material-symbols-outlined text-[16px]">edit</span>
                </button>
                <button
                  onClick={() => handleDeleteSource(source.id)}
                  className="w-8 h-8 rounded-full hover:bg-red-50 text-red-500 flex items-center justify-center transition-all cursor-pointer"
                  title="删除挂载源"
                >
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
              </div>
            </div>

            <div className="mt-2 text-xs font-mono text-on-surface-variant truncate bg-black/[0.02] p-2 rounded-lg border border-black/5">
              路径: {source.path}
            </div>

            <div className="mt-4 pt-3 border-t border-black/5 flex justify-between items-center text-[11px] text-on-surface-variant">
              <span>状态: <span className="text-green-500 font-bold">已挂载</span></span>
              <span>ID: {source.id.substring(source.id.length - 6)}</span>
            </div>
          </div>
        ))}

        {sources.length === 0 && (
          <div className="col-span-2 py-20 flex flex-col items-center justify-center text-center bg-white/40 border border-dashed border-black/10 rounded-3xl">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-3">cloud_off</span>
            <span className="text-sm font-semibold text-on-surface-variant">目前没有任何挂载源</span>
            <p className="text-xs text-on-surface-variant/70 mt-1 max-w-[300px]">
              点击右上角的“添加挂载源”按钮，导入本地教程目录或 WebDAV 资源开始学习
            </p>
          </div>
        )}
      </div>

      {/* 添加数据源 Modal (毛玻璃弹窗) */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="glass-panel-dark text-white rounded-2xl w-full max-w-[480px] p-6 shadow-2xl animate-fade-in relative border border-white/10">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined">add_box</span>
              添加新视频源
            </h3>

            <form onSubmit={handleSaveSource} className="space-y-4">
              {/* 源类型选择 */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-white/60 mb-1.5">类型</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['local', 'webdav', 'alist'] as const).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setNewSourceType(type);
                        setTestStatus('idle');
                      }}
                      className={`py-2 rounded-xl text-xs font-bold transition-all border ${
                        newSourceType === type
                          ? 'bg-primary text-white border-primary shadow-sm shadow-primary/20'
                          : 'bg-white/5 text-white/80 border-white/5 hover:bg-white/10'
                      }`}
                    >
                      {type === 'local' ? '本地目录' : type === 'alist' ? 'Alist' : 'WebDAV'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 资源名称 */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-white/60 mb-1">名称</label>
                <input
                  type="text"
                  required
                  placeholder="例如：深入浅出人工智能"
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                  className="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary placeholder-white/30"
                />
              </div>

              {/* 本地目录字段 */}
              {newSourceType === 'local' ? (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-white/60 mb-1">本地路径</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      required
                      placeholder="请选择本地视频所在目录"
                      value={localPath}
                      className="flex-1 bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs text-white/80 focus:outline-none placeholder-white/30 truncate"
                    />
                    {'electronAPI' in window ? (
                      <button
                        type="button"
                        onClick={handleSelectFolder}
                        className="px-4 py-2 bg-white/10 rounded-xl text-xs font-bold hover:bg-white/15 transition-all"
                      >
                        选择
                      </button>
                    ) : (
                      <span className="text-[10px] text-orange-400 bg-orange-400/10 p-2 rounded-xl border border-orange-400/20">
                        网页端不支持本地目录，请添加 WebDAV
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                // WebDAV & Alist 字段
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-white/60 mb-1">
                      {newSourceType === 'alist' ? 'Alist WebDAV 地址' : 'WebDAV 服务器地址'}
                    </label>
                    <input
                      type="url"
                      required
                      placeholder="https://example.com/dav"
                      value={webdavUrl}
                      onChange={(e) => setWebdavUrl(e.target.value)}
                      className="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-primary placeholder-white/30"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-white/60 mb-1">账号 (可选)</label>
                      <input
                        type="text"
                        placeholder="用户名"
                        value={webdavUser}
                        onChange={(e) => setWebdavUser(e.target.value)}
                        className="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-primary placeholder-white/30"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-white/60 mb-1">密码 (可选)</label>
                      <input
                        type="password"
                        placeholder="密码"
                        value={webdavPassword}
                        onChange={(e) => setWebdavPassword(e.target.value)}
                        className="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-primary placeholder-white/30"
                      />
                    </div>
                  </div>

                  {newSourceType === 'alist' && (
                    <div className="text-[10px] text-orange-400 bg-orange-400/10 p-2.5 rounded-xl border border-orange-400/20 leading-relaxed">
                      ⚠️ <strong>安全提示：</strong>建议在 AList 管理面板中为本应用单独创建一个<strong>只读（Read-Only）</strong>且限制访问目录的子账号，避免在应用中直接使用主管理员账号（admin）。
                    </div>
                  )}

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      className="py-1.5 px-4 bg-white/10 hover:bg-white/15 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5"
                    >
                      {testStatus === 'testing' ? '正在连接...' : '测试连接'}
                    </button>
                    {testStatus === 'success' && <span className="text-xs text-green-400 font-bold flex items-center gap-1">✔ 连接成功</span>}
                    {testStatus === 'failed' && <span className="text-xs text-red-400 font-bold flex items-center gap-1">❌ 连接失败</span>}
                  </div>

                  {/* 文件夹浏览器 */}
                  {folderBrowserOpen && (
                    <div className="mt-4 p-3 bg-white/5 rounded-xl border border-white/10 space-y-3">
                      <div className="flex items-center justify-between border-b border-white/10 pb-2">
                        <span className="text-xs font-bold text-white/70">选择视频所在文件夹</span>
                        <button
                          type="button"
                          onClick={handleSelectCurrentDir}
                          className="px-3 py-1 bg-primary hover:bg-primary/95 text-white text-[11px] font-bold rounded-lg transition-all"
                        >
                          选择当前目录
                        </button>
                      </div>

                      {/* 面包屑导航 */}
                      <div className="flex flex-wrap items-center gap-1 text-[11px] text-white/60">
                        {breadcrumbs.map((crumb, idx) => (
                          <React.Fragment key={idx}>
                            {idx > 0 && <span className="text-white/30">/</span>}
                            <button
                              type="button"
                              onClick={() => handleBreadcrumbClick(crumb.path)}
                              className={`hover:text-white hover:underline transition-all ${
                                idx === breadcrumbs.length - 1 ? 'text-primary font-bold' : ''
                              }`}
                            >
                              {crumb.name}
                            </button>
                          </React.Fragment>
                        ))}
                      </div>

                      {/* 文件夹/视频列表 */}
                      <div className="max-h-[160px] overflow-y-auto custom-scrollbar border border-white/5 rounded-lg bg-black/20 text-xs">
                        {browserLoading ? (
                          <div className="flex items-center justify-center py-8 text-white/60">
                            <span className="animate-spin mr-2">⏳</span> 正在读取目录...
                          </div>
                        ) : browserItems.length > 0 ? (
                          <div className="divide-y divide-white/5">
                            {browserItems.map((item, idx) => (
                              <div
                                key={idx}
                                onClick={() => item.isDir && handleBrowseInto(item)}
                                className={`flex items-center gap-2 px-3 py-2 transition-all ${
                                  item.isDir
                                    ? 'hover:bg-white/10 cursor-pointer text-white font-medium'
                                    : 'text-white/40 cursor-not-allowed'
                                }`}
                              >
                                <span className={`material-symbols-outlined text-[16px] ${item.isDir ? 'text-primary' : 'text-white/30'}`}>
                                  {item.isDir ? 'folder' : 'movie'}
                                </span>
                                <span className="truncate flex-1">{item.name}</span>
                                {item.isDir && (
                                  <span className="material-symbols-outlined text-[12px] text-white/30">
                                    chevron_right
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-8 text-white/40">
                            <span className="material-symbols-outlined text-xl mb-1">folder_open</span>
                            <span>空目录或没有支持的视频文件</span>
                          </div>
                        )}
                      </div>

                      {/* 当前选中的路径反馈 */}
                      {selectedPath && (
                        <div className="text-[11px] text-green-400 bg-green-500/10 border border-green-500/20 p-2 rounded-lg truncate">
                          已选择: {selectedPath}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 底部按钮 */}
              <div className="flex justify-end gap-3 pt-4 border-t border-white/10 mt-6">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 bg-white/5 rounded-xl text-xs font-semibold hover:bg-white/10 transition-all text-white/60"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-primary rounded-xl text-xs font-bold hover:opacity-90 active:scale-95 transition-all text-white"
                >
                  确定添加
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
