# LeetDock

LeetDock 是一个通过 [leetcode.cn](https://leetcode.cn) 获取题目内容的 Visual Studio Code 扩展。扩展 ID 为 `cooronx.leetdock`。

第一阶段支持：

- 浏览器授权登录，Cookie 只保存在 VS Code SecretStorage。
- 按题号、中文名、英文名、titleSlug 或中国站题目 URL 打开题目。
- 每道题使用独立 Webview 页面；重复打开同一道题会复用原页面。
- 中文题面优先、英文回退，支持标签、难度、状态、提示和 KaTeX 公式。
- C++、Rust、Python、Java、TypeScript 本地代码文件。
- Activity Bar 中显示当前账号、题目搜索和最近打开记录。
- 题目列表、详情与搜索缓存，以及手动刷新和缓存清理。

## 使用

1. 在命令面板运行 `LeetDock: Sign In`，或点击状态栏/侧栏中的登录入口。
2. 在浏览器完成 LeetDock 授权，返回 VS Code 后核对弹窗中的账号并确认。
3. 运行 `LeetDock: Open Problem`，输入例如 `1`、`两数之和`、`two-sum` 或完整题目 URL。
4. 在题目页面点击“打开代码”。首次使用时选择默认语言和代码根目录。

如果首次选择代码目录时取消，LeetDock 会使用并记住系统用户目录下的默认位置：

- Linux/macOS：`$HOME/leetdock`
- Windows：`%USERPROFILE%\leetdock`

代码按题目分目录保存，例如：

```text
leetdock/
└── 0001-two-sum/
    ├── solution.cpp
    └── solution.py
```

已有文件只会重新打开，LeetDock 不会覆盖其中的修改。代码默认在题目页面旁边打开。

## 命令与设置

主要命令都以 `LeetDock:` 开头：

- `Sign In` / `Sign Out`
- `Open Problem` / `Search Problem`
- `Refresh Problem` / `Refresh Problem List`
- `Open Code` / `Switch Language`
- `Clear Cache`

`leetdock.defaultLanguage` 保存默认语言。`Clear Cache` 只清理题目缓存和最近记录，不会退出登录、修改默认语言、删除代码文件或重置代码目录。

## 开发与静态检查

```shell
npm install
npm run check
npm run compile
node --check media/problem.js
```

使用桌面版 VS Code 打开本目录，然后启动 Extension Development Host；也可以从本目录运行：

```shell
code --extensionDevelopmentPath=.
```

## 手工验收清单

交互式登录和 Webview 需要桌面 VS Code 与浏览器，请依次验证：

1. 登录后确认回调弹窗显示正确账号，状态栏和侧栏显示用户名。
2. 输入 `1`，确认打开 `1. 两数之和` 题目页面；再次打开题号 `1` 时复用同一页面。
3. 打开另一道题，确认出现独立页面。
4. 在题面点击“打开代码”，选择 C++ 和一个目录；确认生成 `0001-two-sum/solution.cpp`，题面仍保留且代码在旁边打开。
5. 修改代码后再次执行“打开代码”，确认原文件内容不被覆盖。
6. 切换到 Python，确认同一题目目录下生成并打开 `solution.py`。
7. 重新启动 Extension Development Host，确认默认语言与代码根目录仍然有效。
8. 检查 Activity Bar 的搜索与最近打开；分别执行单题刷新、题目列表刷新和缓存清理。
9. 退出登录，确认凭证状态与用户名被清除，已打开的账号相关题目页面被关闭，但本地代码文件仍保留。
