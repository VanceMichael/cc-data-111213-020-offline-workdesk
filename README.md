# 离线工作台的远端确认资料

offline-workdesk 用于合作资料的本地查看和来源保存。当前版本支持人工触发的整份资料查看与字节级归档，资料对象按内容摘要保存，每次领取保留单独回执。自动组织领域资料的能力与人工查看入口分别演进。

## 运行环境

使用 Node.js 22。依赖已锁定；首次准备执行 `npm ci --ignore-scripts`，正式运行无需下载资料或软件。全部样例使用合成数据与本机来源，不连接生产系统。

```bash
npm run check
npm test
npm run demo
```

`npm run demo` 在临时目录实际读取资料、归档并重新核验摘要，退出时清理临时内容。浏览器项目还会启动本地门户和 Chromium 并完成可见页面查看；浏览器在环境准备阶段安装，正式运行不下载。正常演示应在九十秒内结束。

## 本地来源门户

`fixtures/portal/` 是合成业务来源的页面与交互脚本，由 `src/portal.js` 提供本地 HTTP 服务；浏览器功能测试直接操作这些页面。

运行 `npm start -- --port 4173` 后访问终端显示的本地地址，按 Ctrl+C 停止；端口也可由 `PORT` 配置。

## 巡检同步清单（浏览器流程）

`npm run fieldwork` 在本地 PWA 上跑一条完整的现场流程：持久化浏览器上下文里断网填写五项巡检、关页重开（页面由本机缓存提供）、管理端发布新版触发缓存升级、另一台合成设备改动同一项巡检，重新联网后逐项同步。流程只读页面公开的状态板与回执查看入口，不触碰本机存储与离线队列；联网后以管理端台账逐行核对，产出可以解释的清单：

- 【需人工处理】与管理端冲突、或被拒收的项，本机改动未送达；
- 【管理端确认】回执与管理端台账核对一致的项；
- 【正在同步】已发起、管理端尚未回应的项；
- 【只在这台浏览器】本机已保存、尚未送达的项。

冲突与拒收不会自动重试，重复提交也不会在管理端产生第二份（按改动标识幂等）。全部状态转换来自真实浏览器与真实本地服务，时间线随清单一并输出。

## 资料操作

```bash
npm run cli -- inspect fixtures/portal.json
npm run cli -- capture fixtures/portal.json .local/archive
npm run cli -- list .local/archive
```

`capture` 只表示来源字节已保存，不声称领域流程已自动完成。已有查看功能只展示现有资料，不替代业务接纳判断。`scripts/create-fixtures.js` 用于维护者重建合成资料；运行与测试直接读取已提交的资料。

## 目录约定

- `src/domain.js`：现有领域读取和查看接口。
- `src/fieldwork.js`：巡检同步的浏览器流程与清单核对。
- `src/archive.js`：内容对象、来源回执与完整性检查。
- `fixtures/`：本地资料与领域配置。
- `test/`：已有行为的运行验证，使用独立临时目录。

## Linux 环境

`Dockerfile` 使用 Node.js 22 镜像；浏览器项目使用包含 Chromium 的运行镜像。可执行 `docker build -t offline-workdesk:local .` 后运行 `docker run --rm --network none offline-workdesk:local npm test`。测试中的 HTTP、MQTT 和门户都仅绑定回环地址；不需要第二个容器。构建阶段准备依赖，运行时不安装依赖。
