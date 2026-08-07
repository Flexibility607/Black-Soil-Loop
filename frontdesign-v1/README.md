# E01 管理台与 E02 产销协同大屏

`frontdesign-v1/` 保留原生 HTML、CSS 和 JavaScript。生产构建由仓库根目录的 `build-cloudflare.mjs` 递归复制页面和本地资源，并从依赖包复制 ECharts 与三套字体。

## E02 数据口径

- 默认最近 30 个上海时区自然日，可切换 7 日与本月。
- 园区预订单只统计 `CONFIRMED`、`COMPLETED`，需求量按 `kg`、件、箱等单位分别展示。
- 两个环图只展示 B02 门店经营日报中的经营订单笔数占比和营业额占比。
- 传统门店使用冰蓝，第三空间使用吉品绿；第三空间排行和地图点位使用相同语义色。
- 未分类、缺少坐标和缺少日报记录进入数据质量提示，不进入正式业务总量。

## 离线资源

- `assets/maps/northeast-china-admin1.geojson`：Natural Earth Admin-1 1:50m 裁剪的黑龙江、吉林、辽宁三省，坐标为 CRS84 / EPSG:4326。
- `assets/backgrounds/northeast-winter-corn-v1.webp`：无文字的玉米、冰晶、雪花与黑土地背景。
- `vendor/echarts/` 与 `vendor/fonts/`：构建时复制到 `dist`，浏览器不加载 CDN、在线字体或在线地图。

哈尔滨参照点为 `[126.642, 45.757]`，长春参照点为 `[125.324, 43.817]`，园区演示点为 `[125.182, 44.432]`；哈尔滨纬度高于长春。

## 数据加载与演示回退

浏览器始终请求同源 `/api/v1`。E02 每 30 秒刷新：

1. 首次连接成功时使用完整真实快照。
2. 首次连接失败时加载 `frontend-mocks-v0.1/e02-dashboard-snapshot.json`，并显示演示数据标识。
3. 已有成功快照的刷新失败时保留上次完整快照，不把 Mock 字段混入真实数据。

右上角的本地演示开关只供调试；生产默认关闭。

## 语音助手

E02 没有文字输入框。点击麦克风开始，再次点击结束；前端限制 30 秒和 5 MiB，按浏览器能力选择 WebM/Ogg/MP4。服务端还支持 WAV 与 MP3，并负责语音转写、白名单工具问答和受控图表指令。

## 本地验证

在仓库根目录执行：

```powershell
npm ci
npm run test:frontend
npm run cf:check
```

本地连接 FastAPI 时复制 `.dev.vars.example` 为 `.dev.vars`，设置 `BACKEND_API_BASE_URL`、`ALLOW_INSECURE_BACKEND=true` 和与后端一致的 `DASHBOARD_SERVICE_TOKEN`，然后执行 `npm run cf:dev`。

服务器上线后只修改 Cloudflare 环境变量。OpenAI 密钥只放在 FastAPI 服务端，不能写入 Worker、前端源码或浏览器存储。
