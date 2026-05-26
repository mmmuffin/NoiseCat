# NoiseCat

NoiseCat 是一个 Chrome Manifest V3 插件，支持两类能力：

- 在 X/Twitter 页面上划词，一键写入你自己的 X 屏蔽词
- 接入一个公开维护的 GitHub 屏蔽词库，并在前端直接隐藏命中评论，或批量同步到 X 屏蔽词

## 当前能力

- 点击扩展图标，进入划词模式
- 选中文本后，显示“添加到屏蔽词”按钮
- 自动打开 `https://x.com/settings/add_muted_keyword`
- 自动把选中的词语或短语写入 X 的屏蔽词输入框并提交保存
- 支持公共词库 URL
- 支持在推文详情页按公共词库前端隐藏评论块
- 支持把公共词库批量同步到 X 屏蔽词
- 支持 `x.com` 和 `twitter.com`

## 本地安装

1. 打开 Chrome，进入 `chrome://extensions/`
2. 打开右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择这个仓库的根目录

## 使用方式

### 划词添加单个屏蔽词

1. 保证你已经在 Chrome 里登录 X
2. 打开任意 `x.com` 或 `twitter.com` 页面
3. 点击浏览器工具栏里的 NoiseCat 图标
4. 选中你想屏蔽的词或短语
5. 点击浮出的“添加到屏蔽词”
6. 插件会自动跳转到 X 的“添加要隐藏的字词”页面并尝试保存

### 启用公共词库

1. 打开插件设置页
2. 填入一个 GitHub raw 文件地址，例如：
   `https://raw.githubusercontent.com/mmmuffin/NoiseCat/main/community-keywords/keywords.json`
3. 打开“启用公共词库”
4. 点击“刷新公共词库”
5. 如果你同时打开了“前端直接隐藏命中公共词库的评论块”，插件会在推文详情页直接隐藏命中词的评论
6. 如果你想把这些词写入自己的 X 账号，点击“同步到 X 屏蔽词”

## 公共词库格式

项目里已经准备了一份仓库骨架，在：

- `community-keywords/README.md`
- `community-keywords/keywords.json`
- `community-keywords/CONTRIBUTING.md`

推荐的 `keywords.json` 格式：

```json
{
  "version": 1,
  "updatedAt": "2026-05-25T00:00:00Z",
  "description": "Community-maintained mute keywords for NoiseCat.",
  "keywords": [
    "点击私信",
    "加我飞机",
    "兼职日结"
  ]
}
```

插件也兼容纯文本格式，每行一个关键词。

## 设计说明

实现分成三段：

- 当前页面中的内容脚本负责“划词模式”、浮动按钮、公共词库前端隐藏和 X 设置页自动提交
- 后台脚本负责拉取公共词库、缓存关键词，以及启动批量写入 X 的流程
- 设置页负责配置公共词库 URL、预览缓存状态、触发刷新和批量同步

因为 X 是单页应用，路由切换和表单渲染都是动态的，所以这里使用 `MutationObserver` 和延迟轮询去等待输入框可用。

## 当前限制

- 当前公共词库拉取只支持 `raw.githubusercontent.com`
- 批量同步到 X 目前是“乐观提交”，如果 X 后续改版，最可能失效的是新增屏蔽词页的输入框和保存按钮定位
