# 在线视频源头脑风暴记录

更新时间：2026-06-30

## 当前产品边界

用户明确希望软件保持轻量，核心功能只围绕：

- 视频播放
- 观看记录
- 观看时间记录
- 多源读取与导入播放

因此后续优化应避免把软件做成完整的 B 站 / YouTube 客户端，不接管评论、推荐、弹幕社区、下载缓存、账号内容管理等重功能。

## 当前想法

把在线视频平台作为新的“媒体源”接入：

- YouTube 播放列表
- B 站单视频
- B 站多 P 视频
- B 站收藏夹

导入后仍按本软件现有逻辑记录：

- 每个视频 / 分 P 看到哪里
- 每天看了多久
- 当前系列完成进度
- 来源维度统计

## 已验证链接

### YouTube 播放列表

链接：

```text
https://www.youtube.com/playlist?list=PLgCVPIIZ3xL_FVLhDrC3atsy8CiZzAMh6
```

验证结果：

- 可获取播放列表信息
- 标题：Unity UI Toolkit & UGUI Tutorials
- 作者：Hj
- 可读取 8 个条目
- 前 7 个视频可获取 ID、标题、URL、时长
- 第 8 个视频是 private video，无法获取详情和时长
- YouTube 额外提示有 1 个不可用视频被隐藏

初步结论：

- YouTube playlist 导入可行
- 私有 / 失效视频需要标记为不可用，不应阻塞整个列表导入

### B 站单视频 / 多 P 视频

链接：

```text
https://www.bilibili.com/video/BV1vR4y1o7Z2/
```

验证结果：

- 直接用 yt-dlp 抓页面返回 HTTP 412
- 使用 B 站公开视频信息接口可成功获取元数据
- 标题：Redis 缓存技术 已完结（2021版本）4K蓝光画质+杜比音效 从内卷到开摆
- UP 主：青空の霞光
- BVID：BV1vR4y1o7Z2
- 总时长：10631 秒
- 分 P 数：11
- 每个分 P 可获取 cid、标题、时长、页码

初步结论：

- B 站单视频导入可行
- B 站多 P 视频可展开为系列课时
- 播放实现后续要继续验证 iframe 播放器能否稳定监听进度

### B 站收藏夹

链接：

```text
https://space.bilibili.com/434074919/favlist?fid=2799950719&ftype=create
```

验证结果：

- 不登录也能读取收藏夹基础信息和公开视频列表
- 收藏夹：就业发展
- 创建者：Lil_KingZZ
- media_id：2799950719
- 标称数量：24
- 实际可返回：23
- 少 1 条大概率是失效、删除、审核、不可见或权限受限视频
- 可获取视频标题、BVID、UP 主、封面、简介、收藏时间、发布时间、总时长、分 P 数、first_cid
- 对多 P 视频可继续调用公开视频信息接口展开分 P

初步结论：

- B 站公开收藏夹导入可行
- 导入时应提示“已导入 23 条，1 条不可见或已失效”
- 私有收藏夹 / 需要登录态的收藏夹暂不作为第一版目标

## 外部案例调研

### YouTube 方向

可借鉴案例：

- FreeTube：https://github.com/FreeTubeApp/FreeTube
  - Electron 桌面 YouTube 客户端
  - 本地保存订阅、播放列表和观看历史
  - 支持 playlist / history / profile 等完整 YouTube 客户端能力
  - 对本项目的启发：本地历史记录和播放列表管理这套思路很适合借鉴
  - 不建议照搬：它是完整 YouTube 客户端，功能明显比本项目重很多
- youtube-player：https://github.com/gajus/youtube-player
  - YouTube IFrame API 的轻量封装
  - 解决官方 API 需要全局 callback、ready 之前不能调用等麻烦点
  - 对本项目的启发：如果第一版接 YouTube 播放，优先考虑基于官方 iframe API 封装一个 `OnlinePlayerAdapter`
- YouTube 官方 IFrame API：https://developers.google.com/youtube/iframe_api_reference
  - 官方支持播放、暂停、seek、读取当前时间、监听播放状态
  - 适合做断点续播和本地观看记录
  - 官方已说明 `setPlaybackQuality` 等清晰度控制接口不再实际生效，因此不应承诺软件内强制指定 4K / 1080P
- YouTube Data API playlistItems：https://developers.google.com/youtube/v3/docs/playlistItems/list
  - 官方方式可以读取 playlist 条目
  - 单次最多 50 条，需要分页
  - 需要 API key / quota，不适合作为第一版唯一方案，但适合作为后续更稳定的官方导入通道

初步判断：

- YouTube 的最稳路线是：元数据导入用轻量解析或后续接 Data API，播放用官方 IFrame API。
- 不建议第一版做完整账号同步、订阅流、推荐流、评论等能力。

### B 站方向

可借鉴案例：

- Bili.Copilot：https://github.com/Richasy/Bili.Copilot
  - Windows 原生第三方 B 站客户端
  - 有扫码登录、收藏、历史、播放、下载等完整客户端能力
  - 播放层走 MPV / 外部播放器，下载层还集成 BBDown / ffmpeg
  - 对本项目的启发：B 站第三方客户端路线可行，扫码登录和播放体验都有人跑通过
  - 不建议照搬：这条路会把项目变成完整 B 站客户端，且依赖 MPV / ffmpeg / 下载链路，明显偏重
- wiliwili：https://github.com/xfangfang/wiliwili
  - C++ / MPV / FFmpeg 路线的跨平台 B 站客户端
  - 支持登录、个人收藏、历史、番剧、弹幕、评论等完整体验
  - 对本项目的启发：播放层如果追求极致体验可以走 MPV，但这不是本项目当前轻量方向
- PiliPala：https://github.com/guozhigq/pilipala
  - Flutter 第三方 B 站客户端
  - 项目声明 API 来自官网收集，不提供破解内容
  - 对本项目的启发：合规边界上应明确“不破解、不绕会员、不下载缓存”
- bilibili-API-collect：https://github.com/SocialSisterYi/bilibili-API-collect
  - 社区长期整理的 B 站野生 API 文档
  - 仓库已在 2026-01-30 归档只读
  - 对本项目的启发：元数据接口可以参考，但必须当作不稳定能力，做好失败降级
- bilibili-api-python：https://pypi.org/project/bilibili-api-python/
  - 覆盖视频、用户、收藏、番剧等大量接口
  - 明确包含 cookies、反风控等能力
  - 对本项目的启发：字段和接口设计可参考
  - 不建议照搬：不要把反风控、Cookie 管理、会员取流变成核心路线
- B 站外链播放器文档：https://player.bilibili.com/
  - 官方外链 iframe 播放器入口
  - 可以用 `player.html?bvid=...` 嵌入播放
  - 需要进一步实测是否能稳定获取 currentTime / seek；如果不能，B 站第一版只能做观看时长记录或用独立网页登录态方案

初步判断：

- B 站的元数据导入是可行的，尤其是 BV、多 P、公开收藏夹。
- B 站的播放层不能轻易承诺像本地视频一样完全可控，尤其是 currentTime、seek、清晰度、会员权益。
- 第一版应避开“直接解析会员流并用 ArtPlayer 播放”的路线。

### Electron 容器方向

可借鉴能力：

- Electron `session.fromPartition`：https://www.electronjs.org/docs/latest/api/session
  - `persist:` 前缀的 partition 可以保留持久 session
  - 适合做 `persist:youtube` / `persist:bilibili`，让用户在官方页面里自行登录
- Electron WebContentsView：https://www.electronjs.org/docs/latest/api/web-contents-view
  - Electron 42 已经适合用 WebContentsView 承载独立网页内容
  - BrowserView 已被 Electron 标记为 deprecated
- Electron `<webview>` partition：https://www.electronjs.org/docs/latest/api/webview-tag
  - webview 也支持 `persist:` partition
  - 但项目当前最好优先考虑主进程管理的 WebContentsView，安全边界更清楚

初步判断：

- 如果要支持用户登录 B 站 / YouTube 获取账号权益，建议走“平台官方页面 + 独立持久 session”的模式。
- 软件不保存账号密码，不主动导出 Cookie，只保留 Electron 自己的官方页面登录态。
- 本项目只记录自己的学习进度与观看时长，平台账号权益交给官方播放器自己处理。

## 推荐轻量方案

第一版只做“在线视频源导入”，不做完整平台客户端。

建议支持：

- 粘贴 YouTube playlist 链接导入
- 粘贴 B 站 BV 链接导入
- 粘贴 B 站收藏夹链接导入
- B 站多 P 视频默认展开为独立课时
- 私有 / 失效 / 不可见视频显示为不可导入项

## 展示结构共识

用户倾向：如果能自然识别到子视频 / 分 P，就把“包含多个视频的收藏夹或分 P 视频”作为文件夹展示。

建议结构：

- YouTube playlist：作为一个文件夹，下面每个 video 是一个视频条目
- B 站收藏夹：作为一个文件夹
  - 单 P 视频：直接作为视频条目
  - 多 P 视频：作为子文件夹，下面每个分 P 是一个视频条目
- B 站单个多 P 视频：作为一个文件夹，下面每个分 P 是一个视频条目

这样可以复用现有文件树心智：文件夹 = 系列 / 收藏夹 / 合集，文件 = 可播放课时。

## 清晰度与账号权益评估

### 不登录播放

YouTube：

- 公开视频可通过官方 iframe 播放
- 实测样本视频可获取到最高 2160p60 的格式信息
- 但 YouTube IFrame API 已不再支持可靠的程序化清晰度控制，`setPlaybackQuality` 等接口不再影响实际播放体验
- 实际清晰度由 YouTube 官方播放器根据窗口尺寸、网络、设备、用户选择和账号状态决定

B 站：

- 不登录调用 playurl 接口请求 `qn=120&fourk=1`，实测只返回：
  - 高清 1080P
  - 流畅 360P
- 这说明不登录状态下可以播放常规高清，但 4K、高码率、HDR、杜比等权益清晰度大概率无法解锁

### 账号会员权益

核心原则：

- 不保存用户平台账号密码
- 不抓取 / 导出用户浏览器 Cookie 作为第一方案
- 不绕过官方播放器或会员权限
- 用户已登录平台并拥有的清晰度权益，应尽量交给平台官方播放器自己处理

更安全的方案：

- 为在线视频源提供“官方播放器模式”
- 使用平台官方 iframe / BrowserView 加载播放页面
- 用户如果需要会员清晰度，就在平台官方页面内自行登录
- 软件只记录本地观看时间、完成状态和尽可能获取的当前播放进度

需要进一步验证：

- YouTube iframe 在 Electron 中是否能稳定复用登录态，以及能否正常读取 `currentTime`
- B 站官方播放器 / iframe 是否能在登录后选择 4K / 高码率
- B 站播放器是否能稳定读取当前播放时间；如果不能，只能先做观看时长记录和手动完成状态

不推荐的方案：

- 直接解析会员视频流并用 ArtPlayer 播放
- 保存 B 站 / YouTube Cookie
- 伪装请求绕过清晰度限制
- 自动代替用户登录

建议不做：

- 保存 B 站 / YouTube 用户账号密码
- 抓取 Cookie
- 绕过官方播放器下载或缓存视频
- 接管评论、弹幕、推荐流
- 做完整网页浏览器式平台客户端

## 数据建模初稿

在线视频源可以作为新的 source type，例如：

```ts
type SourceType = 'local' | 'webdav' | 'alist' | 'online';
```

在线视频条目建议抽象为：

```ts
interface OnlineVideoItem {
  provider: 'youtube' | 'bilibili';
  id: string;
  title: string;
  url: string;
  thumbnail?: string;
  duration?: number;
  collectionId?: string;
  collectionTitle?: string;
  page?: number;
  cid?: string | number;
  parentId?: string;
  uploader?: string;
  unavailable?: boolean;
}
```

进度 key 建议：

```text
youtube:video:<videoId>
bilibili:video:<bvid>
bilibili:page:<bvid>:<page>
```

## 待确认问题

- YouTube 是否第一版只支持公开 playlist，还是需要 OAuth 读取用户私有 playlist？
- B 站多 P 是否默认展开为独立课时，还是作为一个视频下的章节？
- B 站收藏夹导入后是否需要“手动刷新收藏夹”按钮？
- 在线视频是否复用现有侧边栏，还是给在线源增加独立图标 / 标识？
- B 站 iframe 播放器是否能稳定实现断点续播和当前时间读取？
- YouTube IFrame API 在 Electron 中的播放、进度监听、自动续播体验是否稳定？

## 推荐下一步实验

1. 做一个纯解析层原型，不接 UI：
   - `parseOnlineSource(url)`
   - 输出统一的 `OnlineVideoItem[]`
2. 用当前三个链接作为固定测试样本。
3. 再验证播放器层：
   - YouTube iframe 当前时间读取和 seek
   - B 站 iframe 当前时间读取和 seek
4. 如果播放器层稳定，再接入现有 source / sidebar / progress。
