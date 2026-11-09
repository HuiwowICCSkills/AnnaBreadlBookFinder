# anna-breadl-book-finder

独立的 Anna’s Archive → Breadl 图书查找 skill。它只使用无头 Chrome，不启动有头浏览器，不保存账号密码。

仓库：<https://github.com/HuiwowICCSkills/AnnaBreadlBookFinder>

## 运行环境

| 组件 | 要求 |
| --- | --- |
| Node.js | 22+，需要内置 `WebSocket` 与 `fetch` |
| 浏览器 | Chrome、Chromium 或 Edge |
| 网络 | 可访问 `annas-archive.cc` 与 `breadl.cc` |

没有 Python、npm 或 Playwright 依赖。

## 工作流

1. `search` 以无头 Chrome 打开 Anna’s Archive 的普通搜索页。
2. Anna 若要求登录而当前会话没有登录态，返回 `auth-required`，不写成零命中。
3. 用户已有图书 URL 或数字 ID 时，用 `resolve` 提取详情页的 `Request Code`。
4. `request` 将 Request Code 提交给 Breadl，解析下载页和候选链接。
5. `download` 才把用户选择的普通 `http/https` 候选下载到本地。

`--state <file>` 只用于加载用户已经持有的 JSON storage state。顶级 `cookies` 数组可被直接注入；如果文件含 `origins[].localStorage`，脚本也会在对应 origin 上恢复。它不是登录工具，不接收用户名或密码。

## 安装

```powershell
git clone https://github.com/HuiwowICCSkills/AnnaBreadlBookFinder.git "$env:USERPROFILE\.codex\skills\anna-breadl-book-finder"
```

如果 skill 目录另有统一命名规则，以本机实际安装路径为准。

## 自检

```powershell
& "$env:USERPROFILE\.codex\skills\anna-breadl-book-finder\run.ps1" doctor
```

`doctor --no-probe` 只检查 Node、Chrome 和脚本结构；不加 `--no-probe` 时会用无头 Chrome 分别打开 Anna 首页和 Breadl 请求页。

## 命令与输出

```powershell
& .\run.ps1 search 'international criminal law' --limit 10
& .\run.ps1 resolve '18497390'
& .\run.ps1 request 'ZLIBIO4398714'
& .\run.ps1 download 'ZLIBIO4398714' --out-dir .\books --mirror 'Mirror 1'
```

所有命令输出 JSON。加 `--out path.json` 时同时写文件。

关键字段：

| 字段 | 说明 |
| --- | --- |
| `status` | `ok`、`auth-required`、`no-results`、`no-request-code`、`not-found` 或 `unexpected-content` |
| `results[]` | Anna 搜索行，含 `title`、`url`、`book_id` 和可得的元数据 |
| `book.request_code` | Anna 图书详情页的 Request Code |
| `download_page_url` | Breadl 的 `/d/<id>` 页面 |
| `candidates[]` | 下载候选，含标签、URL、来源和是否可直接交给普通 HTTP 下载 |
| `download.path` | 实际落盘路径 |
| `evidence` | 本次访问的起始 URL、最终 URL、页面标题和时间 |

## 已知边界

- 2026-10-31 无头实测中，`annas-archive.cc` 的普通搜索在无登录会话下对所有词都显示登录提示和 `Books (0+)`。脚本将此类情形报告为 `auth-required`，而不是不存在。
- 图书详情页可以直接读取。实测 `https://annas-archive.cc/book/18497390` 返回 `Request Code : ZLIBIO4398714`。
- Breadl 实测将 `ZLIBIO4398714` 导向 `https://breadl.cc/d/1514078`，并返回 Mirror、IPFS gateway、Proxy 和 Tor 候选。
- Anna 或 Breadl 改版时，选择器可能失效。此时应返回 `unexpected-content` 或 `no-request-code`，不能猜测代码或链接。
- Breadl 的 `Download Now` 和 `Proxy` 可能是包装页；优先测试清晰标注的 `Mirror`，失效后按输出顺序换候选。

## 合规

只使用用户有权访问或法律允许使用的资料。不绕过验证码、登录、付费墙或站点访问限制；遇到这类障碍时保留页面状态并停止该条路径。
