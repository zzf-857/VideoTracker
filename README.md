# 🎬 VideoTracker — 视频学习进度追踪器

<div align="center">

**专为自学者打造的视频学习仪表盘 · A Desktop Dashboard for Video Learning Progress**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38BDF8?logo=tailwindcss)](https://tailwindcss.com/)

> 📚 支持本地文件夹与 WebDAV 远程挂载，精准记录每一分钟的学习时长，让学习进度一目了然。

</div>

---

## ✨ 功能特性

### 📂 多数据源管理
- ✅ 支持**本地视频文件夹**直接挂载
- ✅ 支持 **WebDAV / Alist** 远程挂载源（坚果云、Alist 等）
- ✅ 左侧边栏多数据源快速切换
- ✅ 树状目录 / 平铺列表双模式浏览
- ✅ 视频列表支持排序、乱序、随机播放

### 🎬 视频播放器
- ✅ 基于 **ArtPlayer 5** 的高品质内嵌播放器
- ✅ 自动记忆上次播放进度，续播无忧
- ✅ 播放倍速调节（支持快捷键 C/X/Z）
- ✅ **原生画中画（PiP）** 支持，切换窗口不停学
- ✅ 全屏快捷键（F 键一键切换）

### ⏱️ 精准学习计时
- ✅ 视频播放时自动累计学习时长
- ✅ **防挂机检测**：超时无操作自动停止计时
- ✅ 画中画模式下计时器**正常运行不中断**
- ✅ 仅暂停时停止计时，切换应用不影响记录

### 📊 数据统计与可视化
- ✅ **日历热力图**：直观展示每天学习时长
- ✅ **数据大屏**：总时长、已学完数量、进度百分比
- ✅ **预计学完天数**智能计算（基于当前倍速和每日目标）
- ✅ 多维度进度统计

### ⚙️ 自定义快捷键
- ✅ 内置 F / C / X / Z 默认快捷键
- ✅ **设置页面可完全自定义**按键绑定
- ✅ 自定义绑定**持久化保存**到本地
- ✅ **一键重置**为默认设置

### ☁️ 数据同步
- ✅ 学习数据保存至本地 AppData 目录
- ✅ 支持 **WebDAV 云同步**，多设备共享进度
- ✅ 手动标记视频已学完 / 未学完（右键菜单）
- ✅ 视频静默时长后台自动扫描

### 🖥️ 界面与交互
- ✅ 现代化 macOS 风格三栏布局
- ✅ 双侧边栏可拖拽折叠
- ✅ 毛玻璃（Glassmorphism）视觉风格
- ✅ 一键重置所有设置为默认值

---

## 📸 界面预览

> 📷 *截图示例：请在此处添加项目实际运行截图*
>
> 建议截图内容：主界面（三栏布局）、视频播放中、数据统计大屏、设置页面

---

## 🛠️ 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| [Electron](https://www.electronjs.org/) | 42 | 桌面应用框架 |
| [React](https://react.dev/) | 19 | 前端 UI 框架 |
| [TypeScript](https://www.typescriptlang.org/) | 6 | 类型安全 |
| [Vite](https://vitejs.dev/) | 8 | 构建工具 |
| [Tailwind CSS](https://tailwindcss.com/) | v4 | 原子化 CSS |
| [ArtPlayer](https://artplayer.org/) | 5 | 视频播放器 |
| [hls.js](https://github.com/video-dev/hls.js/) | 1.6 | HLS 流媒体支持 |
| [lucide-react](https://lucide.dev/) | 1.x | 图标库 |

---

## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [Git](https://git-scm.com/)

### 安装与运行

```bash
# 1. 克隆仓库
git clone https://github.com/zzf-857/VideoTracker.git
cd VideoTracker

# 2. 安装依赖
npm install

# 3. 启动开发模式
npm run dev
```

> 💡 也可以直接双击项目根目录的 `run.bat` 一键启动（Windows）

### 生产打包

```bash
npm run build
```

---

## ⌨️ 快捷键说明

| 快捷键 | 功能 |
|--------|------|
| `F` | 切换全屏 / 退出全屏 |
| `C` | 倍速 +0.1x |
| `X` | 倍速 -0.1x |
| `Z` | 重置倍速为 1.0x |

> 💡 所有快捷键均可在**设置 → 快捷键设置**中自定义绑定，自动保存到本地。

---

## 📁 目录结构

```
VideoTracker/
├── src/
│   ├── main/                 # Electron 主进程
│   │   ├── index.ts          # 主进程入口、窗口管理
│   │   └── preload.ts        # IPC 预加载脚本
│   └── renderer/             # 渲染进程（React 应用）
│       ├── App.tsx           # 根组件、全局状态
│       ├── index.css         # 全局样式
│       ├── components/       # UI 组件
│       │   ├── Dashboard.tsx # 主内容区（播放器 + 统计）
│       │   ├── Sidebar.tsx   # 左侧文件浏览器
│       │   ├── Player.tsx    # ArtPlayer 播放器封装
│       │   ├── Settings.tsx  # 设置页面（快捷键自定义）
│       │   └── CustomSelect.tsx # 自定义下拉选择器
│       └── services/
│           └── storage.ts    # 本地数据持久化服务
├── package.json
├── vite.config.ts
└── README.md
```

---

## 💾 数据存储

- **本地存储路径**：`%APPDATA%\VideoTracker\` （Windows）
- **存储内容**：视频观看进度、学习时长、自定义设置、快捷键绑定
- **云同步**：在设置页面配置 WebDAV 服务器地址即可启用多端同步

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

```bash
# 1. Fork 本仓库
# 2. 创建你的特性分支
git checkout -b feature/amazing-feature

# 3. 提交你的修改
git commit -m 'feat: add amazing feature'

# 4. 推送到分支
git push origin feature/amazing-feature

# 5. 打开 Pull Request
```

Commit message 请遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范。

---

## 📄 开源协议

本项目基于 **MIT License** 开源，详情见 [LICENSE](LICENSE) 文件。

```
MIT License  Copyright (c) 2025 zzf-857
```

---

## 🙏 致谢

- [ArtPlayer](https://artplayer.org/) — 强大的 Web 视频播放器
- [Electron](https://www.electronjs.org/) — 跨平台桌面应用框架
- [Tailwind CSS](https://tailwindcss.com/) — 实用优先的 CSS 框架
- [lucide-react](https://lucide.dev/) — 精美的开源图标库

---

<div align="center">

⭐ 如果这个项目对你有帮助，欢迎给它一个 Star！

</div>
