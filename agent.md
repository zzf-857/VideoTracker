# VideoTracker 提交历史与开发记录

本文档用于记录开发过程中的 Git Commit 历史与各个阶段的功能点实现。

## 提交历史日志 (Git Commit Logs)

*   **Initial Commit** (ff2c512)
    *   **时间**: 2026-06-21
    *   **描述**: 初始化项目目录，创建项目 Git 仓库与 `agent.md` 记录文件。

*   **feat: 项目开发骨架与基础脚手架搭建完成** (8ac1678)
    *   **时间**: 2026-06-21
    *   **描述**: 完成 Electron + React + TypeScript + Vite + Tailwind CSS 脚手架搭建，编写主进程入口、Preload 预加载 API 以及开发/构建自动化脚本。

*   **feat: 实现核心组件与数据服务开发** (9159cd0)
    *   **时间**: 2026-06-21
    *   **描述**: 编写完成了 ArtPlayer 播放器封装、多源目录树异步解析、自动计时（含鼠标/键盘防挂机检测）、WebDAV 双向数据同步合并算法、学习进度仪表盘和全量数据统计大屏等全套核心业务组件。

*   **fix: 修复 esbuild 与 Vite 编译配置，完美适配 Tailwind CSS v4** (b76b043)
    *   **时间**: 2026-06-21
    *   **描述**: 修正了 esbuild 编译 flags，指定 Vite root 指向渲染进程目录，调整 CSS 的 Tailwind 导入语法，配置 postcss.config 引入新版 @tailwindcss/postcss。

*   **fix: 强绑定 127.0.0.1 保证主进程成功加载页面** (e329f80)
    *   **时间**: 2026-06-21
    *   **描述**: 锁定 Vite 监听 IP 为 127.0.0.1，优化 Electron 主进程窗口的 did-fail-load 重试，解决并发加载引起的白屏。
