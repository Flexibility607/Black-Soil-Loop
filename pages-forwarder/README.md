# Cloudflare Pages 转发入口

该项目不复制前端和 Mock，只通过 `UPSTREAM` Service Binding 将全部路径转发到 `black-soil-loop` Worker。Worker 更新后，Pages 无需重新部署即可读取最新静态资源。

当前入口：<https://black-soil-loop-cn.pages.dev/>。

本地校验：

```powershell
npm run verify:pages
```

部署：

```powershell
npm run pages:deploy
```

`pages.dev` 只是备用入口，不等于中国大陆网络加速。Cloudflare 官方说明 Pages 并不直接在其中国大陆网络中提供；若需要稳定的大陆访问，应使用完成 ICP 备案的自有域名和适用的中国网络服务。
