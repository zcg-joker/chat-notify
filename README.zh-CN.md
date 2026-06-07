# Chat Notify

[English README](README.md)

Chat Notify 是一个注重隐私的浏览器插件：当 ChatGPT 或 Gemini 回复完成时，它会通过浏览器/系统通知提醒你。

> Alpha 状态：当前版本已经可以通过 GitHub Releases 进行早期测试，但还没有发布到 Chrome Web Store 或 Edge Add-ons。

## 它能做什么

- 只在你主动发送 ChatGPT 或 Gemini 消息后开始监控。
- 支持多个正在运行的 ChatGPT 和 Gemini 会话。
- 支持多个标签页，也支持在同一个标签页中切换不同对话时的可观测完成通知。
- 当可观测的回复完成时，发送浏览器/系统通知。
- 通知中显示你问题的前几十个字，方便快速识别是哪条问题完成了。
- 点击通知可以回到并聚焦触发通知的标签页。
- 插件弹窗会显示当前页面、插件、通知健康状态、上一次完成状态，以及最近活动诊断。
- 最近活动会显示最新一次监控流程到达了哪一步。
- 当保留的页面探测样本足够分析时，弹窗会显示探测推荐，提示是否还要补充证据或可以开始起草 adapter。
- Debug logs 默认关闭，只在排查问题时手动开启。

当前 Alpha 版本支持 ChatGPT 和常规 Gemini 网页应用：

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`
- `https://gemini.google.com/*`

Gemini 支持目前是 MVP，目标站点是 `gemini.google.com`。

## 普通用户安装

推荐从 GitHub Releases 下载最新的插件压缩包，例如：

```text
chat-notify-0.2.0-alpha.1.zip
```

下载后：

1. 解压 zip 文件。
2. 打开 Chrome 的 `chrome://extensions`，或 Edge 的 `edge://extensions`。
3. 打开 Developer mode / 开发者模式。
4. 点击 "Load unpacked" / "加载已解压的扩展程序"。
5. 选择刚刚解压出来的文件夹。
6. 点击插件图标，使用 "Test notification" 测试通知是否正常。

更详细的安装步骤见 [安装指南](docs/INSTALL.md)。

## 开发者使用

```bash
npm test
```

从源码加载插件：

1. 克隆本仓库。
2. 打开 Chrome 或 Edge Chromium。
3. 进入 `chrome://extensions` 或 `edge://extensions`。
4. 启用开发者模式。
5. 点击 "Load unpacked"。
6. 选择本仓库目录。
7. 打开 ChatGPT 或 Gemini 并发送一条消息。

## 打包发布

```bash
npm run package
```

打包脚本会在 `dist/` 下生成干净的插件 zip，用于 GitHub Releases。维护者发布前请参考 [发布指南](docs/RELEASE.md)。

生成的 zip 会把 `manifest.json` 放在压缩包根目录，因此解压后的文件夹可以直接通过 "Load unpacked" 加载。

当前 Alpha 版本生成的发布包名是 `chat-notify-0.2.0-alpha.1.zip`。

## 隐私

Chat Notify 不上传、同步或持久化保存聊天内容。它不使用分析服务、外部服务器或云同步。

通知中的问题摘要很短，只用于帮助识别哪条回复已经完成。

最近活动诊断只保存在本地，数量有限。它可能包含清理后的简短问题摘要和流程元数据，例如最新监控流程到达的阶段。它不保存完整问题内容、完整聊天内容、助手回复文本、请求或响应正文、令牌或 URL。

Debug logs 默认关闭。开启后，日志可能包含问题摘要，因此不要把包含敏感信息的日志公开发布。

## 排障

如果没有看到通知，请先查看插件弹窗中的最近活动，确认最新一次监控流程到达了哪一步。之后如需更多 console 细节，再开启 Debug logs。

更详细的排查步骤见 [Troubleshooting](docs/TROUBLESHOOTING.md)，包括：

- 测试通知不出现。
- ChatGPT 或 Gemini 回复完成后没有通知。
- 如何查看最近活动诊断。
- 通知里的问题摘要不准确。
- 如何开启 Debug logs。
- 如何查看页面 console 和 service worker 日志。

开发者适配新的 AI 网站时，应该先基于脱敏探测证据分析请求行为，而不是直接猜测。弹窗里的探测推荐会总结当前样本是证据不足、还缺关键场景，还是已经可以开始起草 adapter。具体流程见 [适配探测流程](docs/ADAPTER_PROBE_WORKFLOW.md)。

## 当前限制

- Gemini 支持目前是 MVP，目标站点是 `gemini.google.com`。
- 仅支持 Chrome 和 Edge Chromium。
- Alpha 版本需要手动安装 zip。
- 暂未上架 Chrome Web Store 或 Edge Add-ons。
- 暂不支持声音提醒。
- 暂不支持 webhook。
- 暂不支持云同步。

## 开源协议

Chat Notify 使用 MIT License 开源。欢迎在 GitHub 上提交 issue 和早期反馈。
