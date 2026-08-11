# Black-Soil-Loop 网页端

本仓库是 `Flexibility607/Black-Soil-Loop` fork 的网页交付仓库，维护以下内容：

- `frontdesign-v1/`：E01 园区管理台和 E02 公开产销协同大屏。
- `cloudflare-worker.js`、`wrangler.jsonc`：Cloudflare Worker 发布入口。
- `pages-forwarder/`：Cloudflare Pages 自定义域入口。
- `frontdesign-v1/tests/`：前端数据契约、格式化、地图、语音和代理测试。
- `frontend-mocks-v0.1/`：仅供显式开发演示构建使用的模拟数据。

FastAPI、PostgreSQL、B01/B02 服务和小程序接口契约位于私有仓库 `Flexibility607/Black-Soil-Loop-server`。原网页仓库中的 Python 后端、Alembic 和后端测试已在 `web-v0.1.0` 迁移阶段移除，历史提交仍可用于追溯来源。

## 线上地址

- 主站：<https://loop.flexibility607.cn>
- Pages 项目：<https://black-soil-loop-f607.pages.dev>
- API：<https://api.flexibility607.cn>
- 阿里云备用站：<https://demo.flexibility607.cn>

Cloudflare 项目均由 `Flexibility607` 账号独立创建：

- Worker：`black-soil-loop-flexibility607`
- Pages：`black-soil-loop-f607`

## 开发和测试

```powershell
npm ci
npm run test:frontend
npm run verify:pages
npm run cf:check
```

生产构建固定连接 `https://api.flexibility607.cn/api/v1`，且不包含 Mock：

```powershell
npm run build
```

E02 助手支持自由文字、预设问题和匿名语音提问。浏览器将录音整理为 16 kHz、单声道、16 位 PCM WAV，最长 30 秒，通过服务器交由阿里云智能语音交互转写；本站不保存原始录音，转写文字最长约保留 10 分钟，用于幂等重放并避免重复计费。转写不可用或达到额度时，自由文字、预设问题和确定性业务问答仍可使用。图表输出只接受条形图、折线图、环图和路线摘要，不提供语音播报。

当前 API 域名直接解析到服务器源站。若以后改为经过 Cloudflare 或其他代理链路，发布前必须同步核对客户端 IP、录音处理链路和页面隐私披露。

只有显式执行以下命令才会打包开发演示数据。演示构建把 `apiBase` 固定为同源 `/api/v1`，并在 API 适配层阻止服务器请求；助手从本地快照生成确定性只读回答，麦克风明确降级为文字提问：

```powershell
npm run build:demo
```

本地调试 Worker 时，可复制 `.dev.vars.example` 为 `.dev.vars`，并填写本地服务器地址。`.dev.vars` 已被 Git 忽略。

## 发布

```powershell
npm run cf:deploy
npm run pages:deploy
```

Cloudflare 主站与阿里云备用站应使用同一次 `npm run build` 生成的 `dist/` 制品。生产发布前检查：

1. `dist/runtime-config.js` 指向正式 API。
2. `dist/` 不包含 `frontend-mocks-v0.1/`。
3. 前端测试、Pages 契约校验和 Wrangler dry-run 均通过。
4. `loop`、`api`、`demo` 的 HTTPS 和健康检查通过。

## 仓库边界

- 网页仓库：网页、大屏、Cloudflare 配置和前端测试。
- 服务器仓库：B01/B02、PostgreSQL、算法、实时事件、部署和小程序接口包。
- 小程序仓库：`X-BUGer/CCRC`，本轮保持源码不变，依据服务器仓库中的接口包改造。

迁移来源为上游仓库 `ancespio/Black-Soil-Loop`；后续网页变更通过本 fork 的 PR 合并到 `main`。
