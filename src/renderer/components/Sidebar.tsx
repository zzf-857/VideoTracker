import React, { useState, useEffect } from 'react';
import { storageService, MediaSourceConfig, VideoProgress, AppHotkeys, getEventHotkeyString } from '../services/storage';
import { WebDAVClient, WebDAVFile } from '../services/webdav';
import CustomSelect from './CustomSelect';

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  activeVideoPath: string | null;
  onSelectVideo: (url: string, path: string, name: string) => void;
  progressMap: Record<string, VideoProgress>;
  refreshSignal: number;
  onCollapse: () => void;
  onRefresh?: () => void;

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
  onRefresh,

  sources,
  currentSource,
  setCurrentSource,
  fileTree,
  setFileTree,
  isLoading
}: SidebarProps) {
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedVideoPath, setHighlightedVideoPath] = useState<string | null>(null);
  const [hotkeys, setHotkeys] = useState<AppHotkeys>({
    fullscreen: 'f',
    speedUp: 'c',
    speedDown: 'x',
    speedReset: 'z',
    search: 'ctrl+f'
  });

  // 加载快捷键配置
  useEffect(() => {
    storageService.loadData().then(data => {
      if (data.settings.hotkeys) {
        setHotkeys(data.settings.hotkeys);
      }
    });
  }, [refreshSignal]);

  // 全局监听搜索快捷键以聚焦输入框
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.tagName === 'SELECT'
      )) {
        return;
      }

      const searchKey = (hotkeys.search || 'ctrl+f').toLowerCase();
      const pressedHotkey = getEventHotkeyString(e);
      
      if (pressedHotkey === searchKey) {
        e.preventDefault();
        e.stopPropagation();
        const searchInput = document.getElementById('sidebar-search-input');
        if (searchInput) {
          searchInput.focus();
          (searchInput as HTMLInputElement).select();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [hotkeys]);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    videoPath: string;
    videoName: string;
    isFinished: boolean;
    duration?: number;
  }>({
    visible: false,
    x: 0,
    y: 0,
    videoPath: '',
    videoName: '',
    isFinished: false
  });

  // 监听全局点击以关闭右键菜单
  useEffect(() => {
    const handleCloseMenu = () => {
      if (contextMenu.visible) {
        setContextMenu(prev => ({ ...prev, visible: false }));
      }
    };
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, [contextMenu.visible]);

  // 查找某个节点在文件树中的所有父目录路径
  const findParentPaths = (nodes: TreeNode[], targetPath: string, currentParents: string[] = []): string[] | null => {
    for (const node of nodes) {
      if (node.path === targetPath) {
        return currentParents;
      }
      if (node.isDir && node.children) {
        const found = findParentPaths(node.children, targetPath, [...currentParents, node.path]);
        if (found) return found;
      }
    }
    return null;
  };

  // 当选中的视频变化时，自动展开其父级目录并滚动到可视区域
  useEffect(() => {
    if (!activeVideoPath || fileTree.length === 0) return;
    
    // 1. 自动寻找并展开所有祖先目录
    const parentPaths = findParentPaths(fileTree, activeVideoPath);
    if (parentPaths && parentPaths.length > 0) {
      setExpandedPaths(prev => {
        const next = { ...prev };
        let changed = false;
        for (const p of parentPaths) {
          if (!next[p]) {
            next[p] = true;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }

    // 2. 自动滚动到选中的节点
    const timer = setTimeout(() => {
      const activeEl = document.querySelector('[data-active-video="true"]');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 250); // 稍微延迟以保证父级目录展开动画与 DOM 渲染完成

    return () => clearTimeout(timer);
  }, [activeVideoPath, fileTree]);


  // 手动切换完成状态
  const handleToggleFinishedStatus = async (
    videoPath: string,
    videoName: string,
    isFinished: boolean,
    duration?: number
  ) => {
    const finalDuration = duration && duration > 0 ? duration : 1800;
    if (isFinished) {
      // 标记为未完成：进度归零
      await storageService.saveVideoProgress(videoPath, {
        currentTime: 0,
        duration: finalDuration,
        isFinished: false
      });
    } else {
      // 标记为已完成：进度设为 100%
      await storageService.saveVideoProgress(videoPath, {
        currentTime: finalDuration,
        duration: finalDuration,
        isFinished: true
      });
    }
    // 触发更新
    if (onRefresh) {
      onRefresh();
    }
  };

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



  // 定位到当前播放视频位置并执行微缩放动画
  const handleLocateActiveVideo = () => {
    if (!activeVideoPath) return;

    // 1. 自动寻找并展开所有祖先目录
    const parentPaths = findParentPaths(fileTree, activeVideoPath);
    if (parentPaths && parentPaths.length > 0) {
      setExpandedPaths(prev => {
        const next = { ...prev };
        for (const p of parentPaths) {
          next[p] = true;
        }
        return next;
      });
    }

    // 2. 自动滚动到选中的节点并触发微缩放
    setTimeout(() => {
      const activeEl = document.querySelector('[data-active-video="true"]');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        // 触发高亮动画
        setHighlightedVideoPath(activeVideoPath);
        setTimeout(() => {
          setHighlightedVideoPath(null);
        }, 1600);
      }
    }, 200);
  };

  // 树状展示的过滤匹配算法 (包含父节点级联关系)
  const getFilteredTree = (nodes: TreeNode[], query: string): { nodes: TreeNode[]; hasMatch: boolean } => {
    if (!query.trim()) {
      return { nodes, hasMatch: false };
    }

    const cleanQuery = query.toLowerCase();
    const result: TreeNode[] = [];
    let anyMatch = false;

    for (const node of nodes) {
      if (node.isDir) {
        const subResult = getFilteredTree(node.children || [], query);
        const nameMatches = node.name.toLowerCase().includes(cleanQuery);
        
        if (subResult.hasMatch || nameMatches) {
          result.push({
            ...node,
            children: subResult.nodes
          });
          anyMatch = true;
        }
      } else {
        if (node.name.toLowerCase().includes(cleanQuery)) {
          result.push(node);
          anyMatch = true;
        }
      }
    }

    return { nodes: result, hasMatch: anyMatch };
  };

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
      
      const remoteUrl = parsedUrl.toString();
      if ('electronAPI' in window) {
        url = await (window as any).electronAPI.getVideoStreamUrl(remoteUrl);
      } else {
        url = remoteUrl;
      }
    }

    onSelectVideo(url, node.path, node.name);
  };

  // 获取视频播放状态的小图标
  const renderProgressIcon = (videoPath: string) => {
    const prog = progressMap[videoPath];
    if (!prog) {
      return (
        <div className="w-6 h-6 flex items-center justify-center flex-shrink-0 relative z-10">
          <span className="material-symbols-outlined text-[18px] text-[#86868B] leading-none">play_circle</span>
        </div>
      );
    }
    if (prog.isFinished) {
      return (
        <div className="w-6 h-6 flex items-center justify-center flex-shrink-0 relative z-10">
          <span className="material-symbols-outlined text-[18px] text-green-500 font-bold leading-none">check_circle</span>
        </div>
      );
    }
    return (
      <div className="w-6 h-6 flex items-center justify-center flex-shrink-0 relative z-10">
        <span className="material-symbols-outlined text-[18px] text-primary leading-none">play_circle</span>
      </div>
    );
  };

  // 递归渲染树形组件
  const renderTreeNodes = (nodes: TreeNode[], depth = 0) => {
    return nodes.map(node => {
      const isExpanded = searchQuery.trim() ? true : expandedPaths[node.path];
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

        const isFinished = prog?.isFinished || false;
        return (
          <div
            key={node.path}
            data-active-video={isSelected ? "true" : "false"}
            style={{ paddingLeft: `${depth * 12 + 20}px` }}
            onClick={() => handlePlayVideo(node)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({
                visible: true,
                x: e.clientX,
                y: e.clientY,
                videoPath: node.path,
                videoName: node.name,
                isFinished,
                duration: prog?.duration
              });
            }}
            className={`relative flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-colors select-none ${
              isSelected ? 'bg-primary/10 text-primary font-semibold' : 'text-on-surface hover:bg-black/[0.03]'
            } ${node.path === highlightedVideoPath ? 'animate-locate-highlight' : ''}`}
          >
            {showProgressBg && (
              <div 
                className="absolute left-0 top-0 bottom-0 bg-primary/8 pointer-events-none z-0 rounded-l-lg"
                style={{ width: `${percent}%` }}
              />
            )}
            
            {/* 绿点表示已学完 */}
            {isFinished && (
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0 relative z-10 animate-pulse" />
            )}

            {renderProgressIcon(node.path)}
            
            <div className="relative z-10 flex-1 min-w-0 flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-1.5 w-full">
                <span className="text-sm truncate" title={node.name}>{node.name}</span>
                {isFinished && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-green-500/10 text-green-600 font-bold flex-shrink-0">
                    已学完
                  </span>
                )}
              </div>
              {metaStr && (
                <div className="text-[9px] text-on-surface-variant/50 font-mono">
                  {metaStr}
                </div>
              )}
            </div>
          </div>
        );
      }
    });
  };

  return (
    <>
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
            {/* 搜索与定位控制栏 */}
            <div className="px-4 py-2 flex items-center gap-2 border-b border-black/5 bg-black/[0.01]">
              {/* 定位按钮 */}
              <button
                onClick={handleLocateActiveVideo}
                disabled={!activeVideoPath}
                className={`p-1.5 rounded-xl border flex items-center justify-center transition-all cursor-pointer ${
                  activeVideoPath
                    ? 'bg-white border-black/10 text-primary hover:border-primary/40 hover:bg-black/[0.01] active:scale-95 shadow-sm'
                    : 'bg-black/[0.02] border-black/5 text-on-surface-variant/20 cursor-not-allowed'
                }`}
                title={activeVideoPath ? "定位到当前播放视频" : "当前未播放任何视频"}
              >
                <span className="material-symbols-outlined text-[16px]">my_location</span>
              </button>

              <div className="relative flex-1">
                <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant/40">
                  search
                </span>
                <input
                  id="sidebar-search-input"
                  type="text"
                  placeholder="搜索视频..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white border border-black/10 rounded-xl pl-8 pr-7 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary placeholder-on-surface-variant/40"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant/40 hover:text-on-surface cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
              </div>
            </div>

            {/* 数据源选择器 */}
            <div className="px-4 py-3 flex items-center justify-between bg-black/[0.01] border-b border-black/5 relative z-30">
              <CustomSelect
                value={currentSource ? currentSource.id : ''}
                onChange={(val) => setCurrentSource(sources.find(s => s.id === val) || null)}
                options={sources.length > 0 ? sources.map(s => ({
                  value: s.id,
                  label: `${s.name} (${s.type === 'local' ? '本地' : s.type === 'alist' ? 'Alist' : 'WebDAV'})`
                })) : [{ value: '', label: '暂无挂载源' }]}
                className="w-full"
                variant="card"
                fullWidth={true}
              />
            </div>

            {/* PotPlayer 风格：平铺/树状及排序控制条 */}
            <div className="px-4 py-2 flex items-center justify-between border-b border-black/5 bg-black/[0.01] relative z-20">
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
                  <CustomSelect
                    value={sortBy}
                    onChange={(val) => setSortBy(val as any)}
                    options={[
                      { value: 'name', label: '文件名' },
                      { value: 'size', label: '大小' },
                      { value: 'ext', label: '扩展名' },
                      { value: 'mtime', label: '修改日期' },
                      { value: 'duration', label: '播放时长' },
                      { value: 'shuffle', label: '随机乱序' }
                    ]}
                    variant="flat"
                    dropdownAlign="right"
                  />

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
            <div className="flex-1 overflow-y-auto p-3 custom-scrollbar relative z-10">
              {isLoading ? (
                <div className="flex items-center justify-center h-20 text-xs text-on-surface-variant/60">
                  <span className="animate-spin mr-2">⏳</span> 正在扫描资源树...
                </div>
              ) : fileTree.length > 0 ? (
                viewMode === 'tree' ? (
                  // 树状展示
                  <div className="space-y-1">{renderTreeNodes(getFilteredTree(fileTree, searchQuery).nodes)}</div>
                ) : (
                  // PotPlayer 风格：平铺展示 (剔除文件夹)
                  <div className="space-y-1">
                    {(() => {
                      const filteredFlatVideos = searchQuery.trim()
                        ? sortedFlatVideos.filter(v => v.name.toLowerCase().includes(searchQuery.toLowerCase()))
                        : sortedFlatVideos;

                      return filteredFlatVideos.map(video => {
                        const isSelected = activeVideoPath === video.path;
                        const percent = getProgressPercent(video.path);
                        const prog = progressMap[video.path];
                        const showProgressBg = percent > 0 && !prog?.isFinished;
                        const durStr = prog?.duration ? ` · ${formatDuration(prog.duration)}` : '';
                        const metaStr = `${formatSize(video.size)}${durStr}`;

                        const isFinished = prog?.isFinished || false;
                        return (
                          <div
                            key={video.path}
                            data-active-video={isSelected ? "true" : "false"}
                            onClick={() => handlePlayVideo(video)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setContextMenu({
                                visible: true,
                                x: e.clientX,
                                y: e.clientY,
                                videoPath: video.path,
                                videoName: video.name,
                                isFinished,
                                duration: prog?.duration
                              });
                            }}
                            className={`relative flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-colors select-none ${
                              isSelected ? 'bg-primary/10 text-primary font-semibold' : 'text-on-surface hover:bg-black/[0.03]'
                            } ${video.path === highlightedVideoPath ? 'animate-locate-highlight' : ''}`}
                          >
                          {showProgressBg && (
                            <div 
                              className="absolute left-0 top-0 bottom-0 bg-primary/8 pointer-events-none z-0 rounded-l-lg"
                              style={{ width: `${percent}%` }}
                            />
                          )}
                          
                          {/* 绿点表示已学完 */}
                          {isFinished && (
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0 relative z-10 animate-pulse" />
                          )}

                          {renderProgressIcon(video.path)}
                          
                          <div className="relative z-10 flex-1 min-w-0 flex flex-col gap-0.5">
                            <div className="flex items-center justify-between gap-1.5 w-full">
                              <span className="text-xs truncate" title={video.name}>{video.name}</span>
                              {isFinished && (
                                <span className="text-[9px] px-1 py-0.2 rounded bg-green-500/10 text-green-600 font-bold flex-shrink-0">
                                  已学完
                                </span>
                              )}
                            </div>
                            {metaStr && (
                              <div className="relative z-10 text-[9px] text-on-surface-variant/50 font-mono">
                                {metaStr}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )) : (
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

      {/* 自定义右键上下文菜单 */}
      {contextMenu.visible && (
        <div 
          className="fixed bg-white/90 backdrop-blur-md border border-black/5 rounded-xl shadow-xl py-1 z-[300] min-w-[130px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              handleToggleFinishedStatus(
                contextMenu.videoPath,
                contextMenu.videoName,
                contextMenu.isFinished,
                contextMenu.duration
              );
              setContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3 py-2 text-xs hover:bg-primary hover:text-white transition-colors flex items-center gap-2 cursor-pointer font-medium text-on-surface"
          >
            <span className="material-symbols-outlined text-[14px]">
              {contextMenu.isFinished ? 'bookmark_border' : 'bookmark_added'}
            </span>
            <span>{contextMenu.isFinished ? '标记为未完成' : '标记为已完成'}</span>
          </button>
        </div>
      )}
    </>
  );
}
