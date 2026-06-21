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

*   **chore: 添加一键快速启动批处理脚本 run.bat** (a8c48eb)
    *   **时间**: 2026-06-21
    *   **描述**: 在项目根目录下创建了 `run.bat`，设定好国内 Electron 二进制下载镜像环境，简化用户在 Windows 下的双击启动操作。

*   **fix: 修复 run.bat 调用指令，使用 call 防止执行权流失闪退** (661661c)
    *   **时间**: 2026-06-21
    *   **描述**: 修改了 `run.bat`，将 `npm run dev` 替换为 `call npm run dev`，确保在错误退出时窗口能停留在 `pause` 处呈现真实报错。

*   **fix: 转换 run.bat 为纯英文，彻底避免中文编码乱码与分行解析错误** (1bf0d2a)
    *   **时间**: 2026-06-21
    *   **描述**: 移除批处理脚本内所有中文注释与提示，采用纯英文 ASCII 格式，根治了 Windows CMD 读取 UTF-8 文件时导致的乱码及解析崩坏。

*   **fix: 修复选项高亮融色问题与本地中文路径播放解析错误** (8661a63)
    *   **时间**: 2026-06-21
    *   **描述**: 在 index.css 声明 Tailwind v4 @theme，使 bg-primary 生效解决高亮白屏；对 base64 路径做 URL 编码及空格转加号容错，修复中文大纲视频无法播放的故障。
