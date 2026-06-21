import React, { useState, useEffect } from 'react';
import { storageService, MediaSourceConfig, VideoProgress } from '../services/storage';
import { WebDAVClient, WebDAVFile } from '../services/webdav';

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  activeVideoPath: string | null;
  onSelectVideo: (url: string, path: string, name: string) => void;
  progressMap: Record<string, VideoProgress>;
  refreshSignal: number;
  onCollapse: () => void;

  sources: MediaSourceConfig[];
  currentSource: MediaSourceConfig | null;
  setCurrentSource: (s: MediaSourceConfig | null) => void;
  fileTree: TreeNode[];
  setFileTree: React.Dispatch<React.SetStateAction<TreeNode[]>>;
  isLoading: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  mtime?: number;
  children?: TreeNode[];
  isLoaded?: boolean;
}

export default function Sidebar({
  currentTab,
  setCurrentTab,
  activeVideoPath,
  onSelectVideo,
  progressMap,
  refreshSignal,
  onCollapse,

  sources,
  currentSource,
  setCurrentSource,
  fileTree,
  setFileTree,
  isLoading
}: SidebarProps) {
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});

  // 平铺视图与排序状态 (PotPlayer 风格)
  const [viewMode, setViewMode] = useState<'tree' | 'flat'>('tree');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'ext' | 'mtime' | 'duration' | 'shuffle'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [shuffleMap, setShuffleMap] = useState<Record<string, number>>({});

  // 格式化时长 (如 25:01)
  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };

  // 格式化大小
  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // 计算播放进度百分比
  const getProgressPercent = (videoPath: string): number => {
    const prog = progressMap[videoPath];
    if (!prog || prog.duration <= 0) return 0;
    return Math.min(100, Math.max(0, (prog.currentTime / prog.duration) * 100));
  };

  // 递归打平视频树为纯视频列表并进行排序
  const getSortedFlatVideos = (): TreeNode[] => {
    const flatten = (nodes: TreeNode[]): TreeNode[] => {
      let res: TreeNode[] = [];
      for (const n of nodes) {
        if (n.isDir) {
          if (n.children) {
            res = res.concat(flatten(n.children));
          }
        } else {
          res.push(n);
        }
      }
      return res;
    };

    const flatList = flatten(fileTree);

    return flatList.sort((a, b) => {
      let comp = 0;
      if (sortBy === 'name') {
        comp = a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
      } else if (sortBy === 'size') {
        const sizeA = a.size || 0;
        const sizeB = b.size || 0;
        comp = sizeA - sizeB;
      } else if (sortBy === 'ext') {
        const extA = a.name.split('.').pop() || '';
        const extB = b.name.split('.').pop() || '';
        comp = extA.localeCompare(extB, 'zh-CN');
      } else if (sortBy === 'mtime') {
        const mtimeA = a.mtime || 0;
        const mtimeB = b.mtime || 0;
        comp = mtimeA - mtimeB;
      } else if (sortBy === 'duration') {
        const durA = progressMap[a.path]?.duration || 0;
        const durB = progressMap[b.path]?.duration || 0;
        comp = durA - durB;
      } else if (sortBy === 'shuffle') {
        const valA = shuffleMap[a.path] || 0;
        const valB = shuffleMap[b.path] || 0;
        comp = valA - valB;
      }
      return sortOrder === 'asc' ? comp : -comp;
    });
  };

  // 当选择 shuffle 且 map 没有足够节点时，动态填充
  useEffect(() => {
    if (sortBy === 'shuffle') {
      const newMap: Record<string, number> = { ...shuffleMap };
      let changed = false;
      const flatten = (nodes: TreeNode[]): TreeNode[] => {
        let res: TreeNode[] = [];
        for (const n of nodes) {
          if (n.isDir) {
            if (n.children) res = res.concat(flatten(n.children));
          } else {
            res.push(n);
          }
        }
        return res;
      };
      const flatList = flatten(fileTree);
      flatList.forEach(v => {
        if (newMap[v.path] === undefined) {
          newMap[v.path] = Math.random();
          changed = true;
        }
      });
      if (changed || Object.keys(shuffleMap).length === 0) {
        setShuffleMap(newMap);
      }
    }
  }, [sortBy, fileTree]);

  // 手动点击重新打乱随机排序
  const handleShuffleClick = () => {
    const newMap: Record<string, number> = {};
    const flatten = (nodes: TreeNode[]): TreeNode[] => {
      let res: TreeNode[] = [];
      for (const n of nodes) {
        if (n.isDir) {
          if (n.children) res = res.concat(flatten(n.children));
        } else {
          res.push(n);
        }
      }
      return res;
    };
    flatten(fileTree).forEach(v => {
      newMap[v.path] = Math.random();
    });
    setShuffleMap(newMap);
    setSortBy('shuffle');
  };

  const sortedFlatVideos = getSortedFlatVideos();

  // 3. 树节点展开与折叠控制
  const handleToggleExpand = async (node: TreeNode) => {
    const isExpanded = expandedPaths[node.path];
    
    // 如果目前要展开，且该节点是网络网盘目录，且子节点还没加载过
    if (!isExpanded && node.isDir && node.children?.length === 0 && !node.isLoaded) {
      if (currentSource && currentSource.type !== 'local') {
        const client = new WebDAVClient(
          currentSource.settings?.url || '',
          currentSource.settings?.username,
          currentSource.settings?.password
        );
        
        try {
          const relativePath = node.path;
          const files = await client.readDir(relativePath);
          node.children = files.map(f => ({
            name: f.name,
            path: f.path,
            isDir: f.isDir,
            size: f.size,
            mtime: f.mtime,
            children: f.isDir ? [] : undefined,
            isLoaded: false
          }));
          node.isLoaded = true;
          // 强制更新树
          setFileTree([...fileTree]);
        } catch (err) {
          console.error('Failed to load sub directory:', err);
        }
      }
    }

    setExpandedPaths(prev => ({
      ...prev,
      [node.path]: !prev[node.path]
    }));
  };

  // 4. 点击播放视频节点
  const handlePlayVideo = async (node: TreeNode) => {
    if (!currentSource) return;

    let url = '';
    
    if (currentSource.type === 'local') {
      if ('electronAPI' in window) {
        url = await (window as any).electronAPI.getVideoStreamUrl(node.path);
      }
    } else {
      const parsedUrl = new URL(currentSource.settings?.url || '');
      if (currentSource.settings?.username && currentSource.settings?.password) {
        parsedUrl.username = encodeURIComponent(currentSource.settings.username);
        parsedUrl.password = encodeURIComponent(currentSource.settings.password);
      }
      
      const relative = node.path.startsWith('/') ? node.path : `/${node.path}`;
      const urlPath = parsedUrl.pathname.endsWith('/') ? parsedUrl.pathname.slice(0, -1) : parsedUrl.pathname;
      
      if (node.path.startsWith(urlPath)) {
        parsedUrl.pathname = node.path;
      } else {
        parsedUrl.pathname = `${urlPath}${relative}`;
      }
      
      url = parsedUrl.toString();
    }

    onSelectVideo(url, node.path, node.name);
  };

  // 获取视频播放状态的小图标
  const renderProgressIcon = (videoPath: string) => {
    const prog = progressMap[videoPath];
    if (!prog) {
      return <span className="material-symbols-outlined text-[16px] text-[#86868B] relative z-10 flex-shrink-0">play_circle</span>;
    }
    if (prog.isFinished) {
      return <span className="material-symbols-outlined text-[16px] text-green-500 font-bold relative z-10 flex-shrink-0">check_circle</span>;
    }
    return <span className="material-symbols-outlined text-[16px] text-primary relative z-10 flex-shrink-0">play_circle</span>;
  };

  // 递归渲染树形组件
  const renderTreeNodes = (nodes: TreeNode[], depth = 0) => {
    return nodes.map(node => {
      const isExpanded = expandedPaths[node.path];
      const isSelected = activeVideoPath === node.path;

      if (node.isDir) {
        return (
          <div key={node.path} className="select-none">
            <div
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
              onClick={() => handleToggleExpand(node)}
              className="flex items-center gap-2 py-1.5 rounded-lg cursor-pointer text-on-surface hover:bg-black/[0.03] transition-colors"
            >
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant">
                {isExpanded ? 'expand_more' : 'chevron_right'}
              </span>
              <span className="material-symbols-outlined text-[18px] text-primary/80">
                {isExpanded ? 'folder_open' : 'folder'}
              </span>
              <span className="text-sm font-medium text-on-surface truncate">{node.name}</span>
            </div>
            {isExpanded && node.children && (
              <div className="border-l border-black/5 ml-3">
                {renderTreeNodes(node.children, depth + 1)}
              </div>
            )}
          </div>
        );
      } else {
        const percent = getProgressPercent(node.path);
        const prog = progressMap[node.path];
        const showProgressBg = percent > 0 && !prog?.isFinished;
        const durStr = prog?.duration ? ` · ${formatDuration(prog.duration)}` : '';
        const metaStr = `${formatSize(node.size)}${durStr}`;

        return (
          <div
            key={node.path}
            style={{ paddingLeft: `${depth * 12 + 20}px` }}
            onClick={() => handlePlayVideo(node)}
            className={`relative flex flex-col items-start gap-0.5 py-2 px-3 rounded-lg cursor-pointer transition-colors select-none ${
              isSelected ? 'bg-primary/10 text-primary font-semibold' : 'text-on-surface hover:bg-black/[0.03]'
            }`}
          >
            {showProgressBg && (
              <div 
                className="absolute left-0 top-0 bottom-0 bg-primary/8 pointer-events-none z-0 rounded-l-lg"
                style={{ width: `${percent}%` }}
              />
            )}
            <div className="relative z-10 flex items-center gap-2 w-full">
              {renderProgressIcon(node.path)}
              <span className="text-sm truncate flex-1" title={node.name}>{node.name}</span>
            </div>
            {metaStr && (
              <div className="relative z-10 text-[9px] text-on-surface-variant/50 font-mono pl-6 mt-0.5">
                {metaStr}
              </div>
            )}
          </div>
        );
      }
    });
  };

  return (
    <aside className="w-full flex flex-col bg-white/80 backdrop-blur-xl border-r border-black/5 h-full overflow-hidden select-none">
      {/* 顶部 Logo 与系统标头 */}
      <div className="p-5 border-b border-black/5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-headline font-extrabold tracking-tight text-on-surface">VideoTracker</h1>
          <p className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider mt-0.5 opacity-70">
            学习跟踪仪表盘
          </p>
        </div>
        
        {/* 收起侧边栏按钮 */}
        <button
          onClick={onCollapse}
          className="w-8 h-8 rounded-xl text-on-surface-variant hover:bg-black/[0.04] hover:text-on-surface flex items-center justify-center transition-colors cursor-pointer"
          title="收起侧边栏"
        >
          <span className="material-symbols-outlined text-[18px]">menu</span>
        </button>
      </div>

      {/* 选项卡导航 */}
      <nav className="p-4 space-y-1">
        <button
          onClick={() => setCurrentTab('dashboard')}
          className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl transition-all ${
            currentTab === 'dashboard'
              ? 'bg-primary text-white font-semibold shadow-sm shadow-primary/20'
              : 'text-on-surface-variant hover:bg-black/[0.03] hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">dashboard</span>
          <span className="text-sm font-medium">学习主台</span>
        </button>
        <button
          onClick={() => setCurrentTab('sources')}
          className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl transition-all ${
            currentTab === 'sources'
              ? 'bg-primary text-white font-semibold shadow-sm shadow-primary/20'
              : 'text-on-surface-variant hover:bg-black/[0.03] hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">cloud</span>
          <span className="text-sm font-medium">挂载源管理</span>
        </button>
        <button
          onClick={() => setCurrentTab('analytics')}
          className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl transition-all ${
            currentTab === 'analytics'
              ? 'bg-primary text-white font-semibold shadow-sm shadow-primary/20'
              : 'text-on-surface-variant hover:bg-black/[0.03] hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">analytics</span>
          <span className="text-sm font-medium">数据大屏</span>
        </button>
        <button
          onClick={() => setCurrentTab('settings')}
          className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl transition-all ${
            currentTab === 'settings'
              ? 'bg-primary text-white font-semibold shadow-sm shadow-primary/20'
              : 'text-on-surface-variant hover:bg-black/[0.03] hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">settings</span>
          <span className="text-sm font-medium">系统设置</span>
        </button>
      </nav>

      {/* 仅在仪表盘模式下展示侧边栏大纲目录 */}
      {currentTab === 'dashboard' && (
        <div className="flex-1 flex flex-col overflow-hidden border-t border-black/5 mt-2">
          {/* 数据源选择器 */}
          <div className="px-4 py-3 flex items-center justify-between bg-black/[0.01] border-b border-black/5">
            <select
              value={currentSource ? currentSource.id : ''}
              onChange={(e) => setCurrentSource(sources.find(s => s.id === e.target.value) || null)}
              className="bg-transparent border-none text-xs font-semibold focus:ring-0 text-on-surface cursor-pointer p-0 pr-6 w-full"
            >
              {sources.map(s => (
                <option key={s.id} value={s.id} className="text-on-surface bg-white">
                  {s.name} ({s.type === 'local' ? '本地' : s.type === 'alist' ? 'Alist' : 'WebDAV'})
                </option>
              ))}
              {sources.length === 0 && <option value="">暂无挂载源</option>}
            </select>
          </div>

          {/* PotPlayer 风格：平铺/树状及排序控制条 */}
          <div className="px-4 py-2 flex items-center justify-between border-b border-black/5 bg-black/[0.01]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setViewMode(viewMode === 'tree' ? 'flat' : 'tree')}
                className={`px-2 py-1 rounded-lg hover:bg-black/[0.04] flex items-center gap-1 text-[10px] font-extrabold transition-all cursor-pointer ${
                  viewMode === 'flat' ? 'text-primary bg-primary/5' : 'text-on-surface-variant'
                }`}
                title={viewMode === 'tree' ? '平铺展示列表 (打平所有文件夹)' : '层级大纲展示'}
              >
                <span className="material-symbols-outlined text-[15px]">
                  {viewMode === 'tree' ? 'format_list_bulleted' : 'account_tree'}
                </span>
                <span>{viewMode === 'tree' ? '树状大纲' : '平铺视频'}</span>
              </button>
            </div>

            {/* 平铺模式下的排序与极简样式控制 */}
            {viewMode === 'flat' && (
              <div className="flex items-center gap-1 text-on-surface-variant">
                {sortBy === 'shuffle' && (
                  <button
                    type="button"
                    onClick={handleShuffleClick}
                    className="p-0.5 rounded hover:bg-black/[0.04] flex items-center cursor-pointer mr-0.5 text-primary"
                    title="重新随机打乱"
                  >
                    <span className="material-symbols-outlined text-[13px]">shuffle</span>
                  </button>
                )}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-transparent border-none text-[9px] font-bold p-0 pr-4 focus:ring-0 text-on-surface-variant cursor-pointer"
                >
                  <option value="name">文件名</option>
                  <option value="size">大小</option>
                  <option value="ext">扩展名</option>
                  <option value="mtime">修改日期</option>
                  <option value="duration">播放时长</option>
                  <option value="shuffle">随机乱序</option>
                </select>

                <button
                  type="button"
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  className="p-0.5 rounded hover:bg-black/[0.04] flex items-center cursor-pointer"
                  title={sortOrder === 'asc' ? '升序 (点击切换降序)' : '降序 (点击切换升序)'}
                >
                  <span className="material-symbols-outlined text-[13px]">
                    {sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* 目录树/平铺滚动区域 */}
          <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
            {isLoading ? (
              <div className="flex items-center justify-center h-20 text-xs text-on-surface-variant/60">
                <span className="animate-spin mr-2">⏳</span> 正在扫描资源树...
              </div>
            ) : fileTree.length > 0 ? (
              viewMode === 'tree' ? (
                // 树状展示
                <div className="space-y-1">{renderTreeNodes(fileTree)}</div>
              ) : (
                // PotPlayer 风格：平铺展示 (剔除文件夹)
                <div className="space-y-1">
                  {sortedFlatVideos.map(video => {
                    const isSelected = activeVideoPath === video.path;
                    const percent = getProgressPercent(video.path);
                    const prog = progressMap[video.path];
                    const showProgressBg = percent > 0 && !prog?.isFinished;
                    const durStr = prog?.duration ? ` · ${formatDuration(prog.duration)}` : '';
                    const metaStr = `${formatSize(video.size)}${durStr}`;

                    return (
                      <div
                        key={video.path}
                        onClick={() => handlePlayVideo(video)}
                        className={`relative flex flex-col items-start gap-0.5 py-2 px-3 rounded-lg cursor-pointer transition-colors select-none ${
                          isSelected ? 'bg-primary/10 text-primary font-semibold' : 'text-on-surface hover:bg-black/[0.03]'
                        }`}
                      >
                        {showProgressBg && (
                          <div 
                            className="absolute left-0 top-0 bottom-0 bg-primary/8 pointer-events-none z-0 rounded-l-lg"
                            style={{ width: `${percent}%` }}
                          />
                        )}
                        <div className="relative z-10 flex items-center gap-2.5 w-full">
                          {renderProgressIcon(video.path)}
                          <span className="text-xs truncate flex-1" title={video.name}>{video.name}</span>
                        </div>
                        {metaStr && (
                          <div className="relative z-10 text-[9px] text-on-surface-variant/50 font-mono pl-6.5 mt-0.5 ml-0.5">
                            {metaStr}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-center px-4">
                <span className="material-symbols-outlined text-3xl text-on-surface-variant/40 mb-2">folder_off</span>
                <span className="text-xs text-on-surface-variant">
                  {sources.length === 0 ? '请先到“挂载源管理”添加资源' : '此媒体库内没有兼容的视频文件'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
