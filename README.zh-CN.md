# Chat Notify

[English README](README.md)

Chat Notify 是一个注重隐私的浏览器插件：当 ChatGPT 回复完成时，它会通过浏览器/系统通知提醒你。

> Alpha 状态：当前版本已经可以通过 GitHub Releases 进行早期测试，但还没有发布到 Chrome Web Store 或 Edge Add-ons。

## 它能做什么

- 只在你主动发送 ChatGPT 消息后开始监控。
- 支持多个正在运行的 ChatGPT 会话。
- 支持多个标签页，也支持在同一个标签页中切换不同对话时的可观测完成通知。
- 当可观测的回复完成时，发送浏览器/系统通知。
- 通知中显示你问题的前几十个字，方便快速识别是哪条问题完成了。
- Debug logs 默认关闭，只在排查问题时手动开启。

当前 Alpha 版本只支持 ChatGPT：

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

## 普通用户安装

推荐从 GitHub Releases 下载最新的插件压缩包，例如：

```text
chat-notify-0.1.0-alpha.1.zip
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
7. 打开 ChatGPT 并发送一条消息。

## 打包发布

```bash
npm run package
```

打包脚本会在 `dist/` 下生成干净的插件 zip，用于 GitHub Releases。维护者发布前请参考 [发布指南](docs/RELEASE.md)。

生成的 zip 会把 `manifest.json` 放在压缩包根目录，因此解压后的文件夹可以直接通过 "Load unpacked" 加载。

## 隐私

Chat Notify 不上传、同步或持久化保存聊天内容。它不使用分析服务、外部服务器或云同步。

问题摘要只会在当前待完成回复的本地内存中短暂保存，并会在通知、取消、超时或放弃监控后清除。

Debug logs 默认关闭。开启后，日志可能包含问题摘要，因此不要把包含敏感信息的日志公开发布。

## 排障

如果没有看到通知，请先点击插件弹窗中的 "Test notification"。

更详细的排查步骤见 [Troubleshooting](docs/TROUBLESHOOTING.md)，包括：

- 测试通知不出现。
- ChatGPT 回复完成后没有通知。
- 通知里的问题摘要不准确。
- 如何开启 Debug logs。
- 如何查看页面 console 和 service worker 日志。

## 当前限制

- 仅支持 ChatGPT。
- 仅支持 Chrome 和 Edge Chromium。
- Alpha 版本需要手动安装 zip。
- 暂未上架 Chrome Web Store 或 Edge Add-ons。
- 暂不支持声音提醒。
- 暂不支持 webhook。
- 暂不支持云同步。
- 暂不支持点击通知回到对应标签页。

## 开源协议

Chat Notify 使用 MIT License 开源。欢迎在 GitHub 上提交 issue 和早期反馈。

