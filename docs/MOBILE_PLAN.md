# VideoTracker 移动端与服务器部署长期规划

本篇文档记录了关于将 VideoTracker 适配并部署到服务器，并在移动端（手机网页版 / 独立 iOS App）使用的演进方案，以便在后续开发需求明确时作为指导。

---

## 1. 架构兼容性评估

本项目在设计之初即对非 Electron 的原生浏览器环境进行了前瞻性兼容：
* **数据存储**：在 [storage.ts](../src/renderer/services/storage.ts#L2) 中，当 `isElectron` 为 false 时，项目会自动降级使用浏览器的 `localStorage`。
* **数据通信**：在 [webdav.ts](../src/renderer/services/webdav.ts#L27-L41) 中，当 `isElectron` 为 false 且无主进程代理时，降级使用原生 `fetch` 向第三方 WebDAV / Alist 接口发起通信。

这意味着：**在不需要本地视频文件夹扫描的情况下，直接打包静态网页并部署到服务器是完全可行的，且 2核2G 级别的轻量服务器负载几乎为零。**

---

## 2. 方案对比：Web App (网页版) vs iOS App (原生/混合开发)

### 方案 A：Web App (响应式网页 / PWA)
* **实现逻辑**：适配手机浏览器排版，在 1panel 等服务器环境托管编译后的静态 `dist`。在手机 Safari 中将页面“添加到主屏幕”（PWA 模式）。
* **优势**：
  1. 100% 复用现有代码，0 增量硬件资源与网络流量消耗。
  2. 跨平台通用，不收年费 99$ 的 Apple 开发者账号限制。
* **限制**：
  1. iOS 对后台网页 JavaScript 的休眠控制极其严格，锁屏或切到后台时，学习计时器可能会中断。
  2. 需在 AList 或 WebDAV 服务端开启 CORS 跨域白名单。

### 方案 B：专属 iOS 客户端 App (混合框架 Capacitor)
* **实现逻辑**：使用 **Capacitor.js** 包装现有 React 前端，使用 Swift 补充原生 iOS 音视频后台播放插件。
* **优势**：
  1. 能够调用 iOS 原生 `Background Modes - Audio`。在锁屏、微信聊天、后台挂机状态下，均能稳定记忆播放进度和计时。
  2. 使用 SQLite 存储，防止浏览器清理 `localStorage` 缓存导致历史配置丢失。
  3. 支持灵动岛/锁屏实时活动（Live Activities）直接查看今日已学时间。
* **限制**：
  1. 开发与签名分发成本较高（需自签 TrollStore/AltStore，或每年 99$ 申请 App Store 上架）。

---

## 3. 分阶段演进 TODO List

未来如果有移动端使用需求，可按照以下两阶段步骤从长计议：

### 阶段一：响应式网页适配与 PWA 部署 (0 成本验证)
- [ ] **UI 响应式重构**：修改 [App.tsx](../src/renderer/App.tsx) 布局，检测屏幕宽度（如手机端宽 < 768px 时），默认隐藏左侧侧边栏、右侧日志和章节抽屉，并改造为可滑出的侧边遮罩（Drawer）或底部浮窗。
- [ ] **触屏手势交互**：为 ArtPlayer 播放器适配双击暂停、左右滑动快进/快退、上下滑动调节音量/亮度的移动端手势。
- [ ] **网页画中画优化**：验证 Safari 下原生画中画（PiP）的防挂机计时是否能被触发。
- [ ] **配置 PWA 支持**：在项目根目录下生成 `manifest.json` 与应用图标，使用户可“添加到主屏幕”，消除 Safari 浏览器地址栏以获得独立 App 般的使用体验。
- [ ] **1panel 部署验证**：使用 1panel 部署静态网站并配置 Nginx 代理，同时确保 AList 配置了允许跨域（CORS）的请求头部。

### 阶段二：使用 Capacitor 封装为原生 iOS App (极致体验)
- [ ] **集成 Capacitor**：在项目中引入 `@capacitor/core` 与 `@capacitor/cli`。
- [ ] **编写 Swift 后台播放与计时插件**：通过 iOS 原生 Swift 语言开发原生音频桥接，在 App 锁屏退入后台时模拟无声伴音，保证 iOS 后台计时不挂起。
- [ ] **集成 iOS SQLite 本地数据沙盒**：配置 SQLite 插件，代替 localStorage，确保手机数据永久储存。
- [ ] **打包与分发**：配置 Xcode，为没有签名账号的用户提供 IPA 编译包（支持 TrollStore / AltStore 自签安装）。
