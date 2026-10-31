---
name: anna-breadl-book-finder
description: 纯无头查询 Anna’s Archive 图书记录与 Request Code，再通过 Breadl 解析下载页和镜像链接。用于查找国际法研究所需图书、评注和专著；也可在用户明确要求时下载文件。搜索受限时返回 auth-required，不把登录门槛误报为零命中。
---

# Anna Breadl Book Finder

> **`<skill-dir>`** = 本 SKILL.md 所在目录。核心脚本为 `<skill-dir>/scripts/anna_breadl_book_finder.mjs`；Windows 用 `<skill-dir>/run.ps1`，macOS/Linux 用 `<skill-dir>/run.sh`。部署与实测边界见 [README.md](README.md)。

这个 skill 只处理一条图书获取链路：

1. 在 Anna’s Archive 检索图书，或读取用户给出的 Anna 图书页；
2. 从图书详情页提取 `Request Code`，例如 `ZLIBIO4398714`；
3. 把 Request Code 提交给 Breadl；
4. 返回 Breadl 下载页、文件名、大小和镜像候选；
5. 只有 `download` 命令才实际下载文件。

## 强制边界

- 所有浏览器操作必须使用无头 Chrome。脚本硬编码 `--headless=new`，没有有头模式开关。
- 不绕过登录、验证码、付费墙或站点访问控制。Anna 搜索页若只显示登录提示且没有结果行，返回 `status=auth-required`；不得改写成“没有这本书”。
- `search` 结果与 `resolve` 的 Request Code 是定位信息；文件是否存在、是否可下载仍以 Breadl 返回的下载页为准。
- Breadl 候选链接可能失效、指向 IPFS 网关、代理页或 Tor 地址。脚本只自动下载普通 `http/https` 候选，拒绝 `.onion`；不处理验证码页面。
- 下载前确认资料使用权。`request` 默认只解析候选，不落盘；用户明确要求下载后才运行 `download`。

## 命令

```powershell
# 检索书目。Anna 未提供登录态而拒绝搜索时，会明确返回 auth-required
& '<skill-dir>/run.ps1' search 'The International Criminal Court commentary' --limit 10

# 已有 Anna 图书 URL 或数字 ID：直接提取书名、元数据和 Request Code
& '<skill-dir>/run.ps1' resolve 'https://annas-archive.cc/book/18497390'
& '<skill-dir>/run.ps1' resolve '18497390'

# 把 Request Code 或 Anna URL 交给 Breadl，返回下载候选，不下载
& '<skill-dir>/run.ps1' request 'ZLIBIO4398714'

# 明确要求下载时，选择候选并落盘
& '<skill-dir>/run.ps1' download 'ZLIBIO4398714' --out-dir './books' --mirror 'Mirror 1'

# 部署自检
& '<skill-dir>/run.ps1' doctor
```

通用参数：`--out`、`--timeout`（秒）、`--wait-ms`、`--state <json>`、`--chrome-path`。`search` 另有 `--limit`；`download` 另有 `--out-dir`、`--mirror`、`--out-file`。

`--state` 接受常见浏览器导出的 JSON storage state，至少支持顶层 `cookies` 数组。它不会创建登录凭据；只是让无头浏览器使用用户已经持有的会话。

## 结果状态

- `ok`：页面已读取，且目标字段存在。
- `auth-required`：Anna 页面明确要求登录，当前无头会话没有可用结果。
- `no-results`：已取得搜索结果页，但没有图书行，也没有登录门槛。
- `no-request-code`：图书详情页可读，但没有 Request Code。
- `not-found`：Breadl 明确表示 Request Code 或链接无效。
- `unexpected-content`：页面改版、WAF 或中间状态；保留原始 URL 和页面标题供排查。

## 参考

- 选择器、2026-10-31 无头实测与已知限制：[references/anna-breadl.md](references/anna-breadl.md)
- 安装、参数与排错：[README.md](README.md)
