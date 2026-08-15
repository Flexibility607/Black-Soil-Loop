# E01 管理台与 E02 产销协同大屏

`frontdesign-v1/` 保留原生 HTML、CSS 和 JavaScript。生产构建由仓库根目录的 `build-cloudflare.mjs` 递归复制页面和本地资源，并从依赖包复制 ECharts 与三套字体。

## E02 数据口径

- 默认最近 30 个上海时区自然日，可切换 7 日与本月。
- 园区预订单只统计 `CONFIRMED`、`COMPLETED`，需求量按 `kg`、件、箱等单位分别展示。
- 两个环图只展示 B02 门店经营日报中的经营订单笔数占比和营业额占比。
- 传统门店使用冰蓝，第三空间使用吉品绿；第三空间排行和地图点位使用相同语义色。
- 未分类、缺少坐标和缺少日报记录进入数据质量提示，不进入正式业务总量。

## 离线资源

- `assets/maps/changchun-road-basemap.v2.geojson`：固定日期构建的轻量长春区划、主干道、水系、铁路和片区标签，坐标为 WGS84 / EPSG:4326；页面永久显示 OpenStreetMap contributors 与 ODbL 署名。
- `assets/maps/changchun-service-area.geojson`：道路底图加载或校验失败时使用的长春服务范围回退图。
- `assets/maps/changchun-road-basemap.v4.geojson`：长春轻量道路底图，补充路线连接道路与服务区划边界；v3、v2 和服务范围简图按顺序回退。
- `assets/maps/changchun-showcase-routes.v3.json`：去重的五条预设路线走廊目录，共线路段只保存和绘制一次；v2、v1 保留为回退。
- `assets/maps/northeast-china-admin1.geojson`：旧网页回滚兼容资源，新版 E02 不再把它作为正常地图。
- `assets/backgrounds/northeast-winter-corn-v1.webp`：无文字的玉米、冰晶、雪花与黑土地背景。
- `vendor/echarts/` 与 `vendor/fonts/`：构建时复制到 `dist`，浏览器不加载 CDN、在线字体或在线地图。

地图支持滚轮缩放、鼠标拖动和按钮缩放。首次进入选择路线 01 的终段；路线 01—05 均可切换终段、全程和五线全览。全览中的共线路段只绘制一次且保持静态，聚焦状态只有当前路线显示一个无拖尾车辆符号。公开快照含活动线路时最多显示五条真实下一站线路；活动线路为空时使用带“预设路线演示 · 非实时车辆”标记的冻结线路，两种模式不混合。预设线路不提供虚构速度、温湿度或定位时间。

## 数据加载与演示回退

浏览器始终请求同源 `/api/v1`。E02 每 30 秒刷新：

1. 首次连接成功时使用完整真实快照。
2. 生产构建首次连接失败时显示受控错误态，不加载 Mock。
3. 已有成功快照的刷新失败时保留上次完整快照。
4. `npm run build:demo` 才会把演示快照打入独立本地制品，且阻断生产 API 请求。

园区动态与政策资讯通过一次公开请求并列展示，两栏滚动不触发额外网络请求。协同方案首页使用摘要卡，完整说明和结果进入独立详情弹窗。

## 固定演示案例

服务器将公开数据集配置为 showcase 时，E02 只在顶部状态区显示一次“固定演示案例 · 更新至 HH:mm”，业务卡片、排行和算法结果不重复添加说明。受控演示账号登录 E01 后显示同款小标签；演示管理员可请求恢复今日标准状态，提交成功后前端立即清空操作上下文和会话。网页不提供数据集切换参数，数据来源完全由服务器签名令牌和公开配置决定。普通生产账号不显示该标签并继续读取真实经营数据。

## E01 今日展示序号

登录态资源表使用显式列白名单，并在首列显示 `01/02` 一类今日展示序号。序号按当前页和页容量计算，筛选或排序后可以变化，只用于当前列表定位，不替代业务编号，也不进入请求路径、请求体、幂等键或本地存储。原始记录编号仅在登录详情的“技术追溯信息”中展开；对象版本、追踪编号、算法运行编号、规则版本和原始快照不渲染。

## 语音助手

E02 同时提供自由文字、预设问题和匿名语音入口。点击麦克风开始，再次点击结束，满 30 秒自动停止；浏览器优先通过 AudioWorklet 采集 PCM，不支持时使用 ScriptProcessor 兼容路径，并在 Worker 中重采样、编码为 16 kHz、单声道、16 位 WAV。前端限制为 30 秒和 2 MiB。

匿名访客调用 `/public/assistant/transcriptions`，登录用户调用 `/web/assistant/transcriptions`。每轮录音使用同一 UUID 作为 `Idempotency-Key` 和 `client_request_id`。转写文字会写入可编辑输入框并自动执行只读业务查询；取消、页面隐藏或离开 E02 会中止请求并释放麦克风。语音不可用时仍可使用文字和预设问题，页面不提供 TTS 或自动播放。

录音只在浏览器内存中处理并上传本站服务器，网页端不写入本地存储、IndexedDB 或构建目录。本站不保存原始录音；服务器可将转写文字短期保留最长约 10 分钟，仅用于幂等重放并避免相同录音重复计费。生产启用阿里云语音服务所需的 AccessKey、Secret 与 AppKey 只能配置在 FastAPI 服务端。

`npm run build:demo` 使用同源 `/api/v1` 作为占位地址，API 适配层会阻止所有服务器请求。E02 快照和确定性助手只读取构建内的演示 JSON，匿名语音返回受控 `VOICE_DISABLED`，不会上传录音。

## 本地验证

在仓库根目录执行：

```powershell
npm ci
npm run test:frontend
npm run cf:check
```

本地连接 FastAPI 时复制 `.dev.vars.example` 为 `.dev.vars`，设置 `BACKEND_API_BASE_URL`、`ALLOW_INSECURE_BACKEND=true` 和与后端一致的 `DASHBOARD_SERVICE_TOKEN`，然后执行 `npm run cf:dev`。

服务器上线后只修改 Cloudflare 环境变量。阿里云及其他供应商凭据只放在 FastAPI 服务端，不能写入 Worker、前端源码或浏览器存储。
