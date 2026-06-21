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
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  children?: TreeNode[];
  isLoaded?: boolean; // 针对 WebDAV 异步加载子节点
}

export default function Sidebar({
  currentTab,
  setCurrentTab,
  activeVideoPath,
  onSelectVideo,
  progressMap,
  refreshSignal
}: SidebarProps) {
  const [sources, setSources] = useState<MediaSourceConfig[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [fileTree, setFileTree] = useState<TreeNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);

  // 1. 加载挂载源
  useEffect(() => {
    storageService.loadData().then(data => {
      setSources(data.sources);
      if (data.sources.length > 0 && !selectedSourceId) {
        setSelectedSourceId(data.sources[0].id);
      }
    });
  }, [refreshSignal]);

  // 2. 当选中的数据源改变时，加载对应的文件树
  useEffect(() => {
    if (!selectedSourceId) {
      setFileTree([]);
      return;
    }

    const source = sources.find(s => s.id === selectedSourceId);
    if (!source) return;

    setIsLoading(true);
    setExpandedPaths({});

    if (source.type === 'local') {
      // 本地数据源，直接全量读取 (Electron 主进程支持)
      if ('electronAPI' in window) {
        (window as any).electronAPI.scanFolder(source.path)
          .then((tree: TreeNode[]) => {
            setFileTree(tree);
            setIsLoading(false);
          })
          .catch((err: any) => {
            console.error(err);
            setIsLoading(false);
          });
      } else {
        setFileTree([]);
        setIsLoading(false);
      }
    } else {
      // WebDAV 或 Alist 数据源，异步按需读取首层
      const client = new WebDAVClient(
        source.settings?.url || '',
        source.settings?.username,
        source.settings?.password
      );
      
      client.readDir()
        .then((files: WebDAVFile[]) => {
          const tree: TreeNode[] = files.map(f => ({
            name: f.name,
            path: f.path,
            isDir: f.isDir,
            size: f.size,
            children: f.isDir ? [] : undefined,
            isLoaded: false
          }));
          setFileTree(tree);
          setIsLoading(false);
        })
        .catch(err => {
          console.error(err);
          setFileTree([]);
          setIsLoading(false);
        });
    }
  }, [selectedSourceId, sources]);

  // 3. 树节点展开与折叠控制
  const handleToggleExpand = async (node: TreeNode) => {
    const isExpanded = expandedPaths[node.path];
    
    // 如果目前要展开，且该节点是网络网盘目录，且子节点还没加载过
    if (!isExpanded && node.isDir && node.children?.length === 0 && !node.isLoaded) {
      const source = sources.find(s => s.id === selectedSourceId);
      if (source && source.type !== 'local') {
        const client = new WebDAVClient(
          source.settings?.url || '',
          source.settings?.username,
          source.settings?.password
        );
        
        try {
          // 通过相对路径读取
          const relativePath = node.path;
          const files = await client.readDir(relativePath);
          node.children = files.map(f => ({
            name: f.name,
            path: f.path,
            isDir: f.isDir,
            size: f.size,
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
    const source = sources.find(s => s.id === selectedSourceId);
    if (!source) return;

    let url = '';
    
    if (source.type === 'local') {
      // 本地视频：调用 Electron 主进程流转接 URL
      if ('electronAPI' in window) {
        url = await (window as any).electronAPI.getVideoStreamUrl(node.path);
      }
    } else {
      // 远端视频 (WebDAV/Alist)：拼接账号密码生成直链
      const parsedUrl = new URL(source.settings?.url || '');
      if (source.settings?.username && source.settings?.password) {
        parsedUrl.username = encodeURIComponent(source.settings.username);
        parsedUrl.password = encodeURIComponent(source.settings.password);
      }
      
      // 网络相对路径拼接
      const relative = node.path.startsWith('/') ? node.path : `/${node.path}`;
      // 如果 settings.url 里已经包含了路径部分，我们需要处理防重叠。
      // WebDAVClient 中 baseUrl 已经处理了末尾，这里简单拼合 pathname
      const urlPath = parsedUrl.pathname.endsWith('/') ? parsedUrl.pathname.slice(0, -1) : parsedUrl.pathname;
      
      // 大部分 WebDAV 接口返回的 href 已经带有完整的 pathname，我们需要防重叠
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
      return <span className="material-symbols-outlined text-[16px] text-[#86868B]">play_circle</span>;
    }
    if (prog.isFinished) {
      return <span className="material-symbols-outlined text-[16px] text-green-500 font-bold">check_circle</span>;
    }
    return <span className="material-symbols-outlined text-[16px] text-primary">play_circle</span>;
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
        return (
          <div
            key={node.path}
            style={{ paddingLeft: `${depth * 12 + 20}px` }}
            onClick={() => handlePlayVideo(node)}
            className={`flex items-center gap-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
              isSelected ? 'bg-primary/10 text-primary font-semibold' : 'text-on-surface hover:bg-black/[0.03]'
            }`}
          >
            {renderProgressIcon(node.path)}
            <span className="text-sm truncate flex-1">{node.name}</span>
          </div>
        );
      }
    });
  };

  return (
    <aside className="w-64 flex flex-col bg-white/80 backdrop-blur-xl border-r border-black/5 h-full">
      {/* 顶部 Logo 与系统标头 */}
      <div className="p-6 border-b border-black/5">
        <h1 className="text-2xl font-headline font-extrabold tracking-tight text-on-surface">VideoTracker</h1>
        <p className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider mt-1 opacity-70">
          学习跟踪仪表盘
        </p>
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
              value={selectedSourceId}
              onChange={(e) => setSelectedSourceId(e.target.value)}
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

          {/* 目录树滚动区域 */}
          <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
            {isLoading ? (
              <div className="flex items-center justify-center h-20 text-xs text-on-surface-variant/60">
                <span className="animate-spin mr-2">⏳</span> 正在扫描资源树...
              </div>
            ) : fileTree.length > 0 ? (
              <div className="space-y-1">{renderTreeNodes(fileTree)}</div>
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
