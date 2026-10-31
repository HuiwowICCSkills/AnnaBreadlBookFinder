# Anna’s Archive → Breadl 实测与选择器

## 2026-10-31 无头核验

浏览器为系统 Chrome，启动参数始终包含：

```text
--headless=new
--disable-extensions
--remote-debugging-port=0
```

没有启用或回退到有头模式。

### Anna’s Archive

- 首页：`https://annas-archive.cc/`
- 搜索表单：`form#searchForm[action="/s/"][method="get"]`
- 搜索框：`#searchFieldx`
- 搜索结果行：`.bookRow`
- 结果题名链接：`.bookRow h3 a[href*="/book/"]`
- 无登录提示：页面正文同时出现 `Want to get more search results?`、`Login` 和 `On your request nothing has been found`

无登录会话中，`The Prince Machiavelli`、`International Criminal Court commentary` 等查询均返回 `Books (0+)` 与登录提示。该状态是权限或会话门槛，不是可靠的书目不存在结论。

图书详情页：

- 题名：`h1[itemprop="name"]`
- 作者：`a[itemprop="author"]`
- Request Code：`#reqcode`
- 元数据：`.bookDetailsBox .bookProperty` 下的 `.property_label` 与 `.property_value`
- 实测页：`https://annas-archive.cc/book/18497390`
- 实测 Request Code：`ZLIBIO4398714`

### Breadl

- 请求页：`https://breadl.cc/book-request`
- 输入框：`input[name="link_or_code"]`
- 表单：`form[method="post"]`
- 下载页：提交成功后跳转到 `https://breadl.cc/d/<id>`
- 下载按钮：`a.download_now`
- 部分按钮的真实 URL 写在 `onclick="openLinkNewTab('<base64>')"` 中

实测 Request Code `ZLIBIO4398714` 返回：

```text
https://breadl.cc/d/1514078
```

页面同时给出普通镜像、IPFS gateway、Breadl proxy 和 `.onion` 候选。脚本把普通 HTTP(S) URL 纳入候选，并标记 `.onion` 为不可自动下载。

## 登录态

`--state` 不创建凭据，只恢复用户已有的 JSON storage state。实现读取：

```json
{
  "cookies": [
    {
      "name": "session",
      "value": "...",
      "domain": ".annas-archive.cc",
      "path": "/",
      "secure": true,
      "httpOnly": true,
      "sameSite": "Lax",
      "expires": 1893456000
    }
  ],
  "origins": [
    {
      "origin": "https://annas-archive.cc",
      "localStorage": [
        {"name": "key", "value": "value"}
      ]
    }
  ]
}
```

只接受用户明确提供的状态文件。skill 不扫描浏览器 profile，也不保存用户名或密码。

## 失败解释

- `auth-required`：Anna 搜索页存在明确登录提示且没有结果行。
- `no-results`：已得到结果页，无结果行且没有登录提示。
- `no-request-code`：详情页可读，但 `#reqcode` 缺失。
- `unexpected-content`：站点结构、WAF 或中间页使目标字段不可读。

任何状态都不能通过猜测补齐缺失的 Request Code 或下载链接。
