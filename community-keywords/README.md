# NoiseCat Community Keywords

这个仓库用于维护 NoiseCat 的公共屏蔽词库。

## 文件格式

主文件是 `keywords.json`：

```json
{
  "version": 1,
  "updatedAt": "2026-05-25T00:00:00Z",
  "description": "Community-maintained mute keywords for NoiseCat.",
  "keywords": [
    "约炮",
    "兼职日结",
    "点击私信",
    "加我飞机",
    "色图资源"
  ]
}
```

## 维护原则

- 只收录高频广告、黄赌骗、引流和明显骚扰类关键词
- 尽量避免误伤正常讨论词
- 优先收录短语，而不是过短的单字
- 改动时更新 `updatedAt`

## 给插件的 raw URL

发布到 GitHub 后，插件应填写：

`https://raw.githubusercontent.com/<owner>/<repo>/main/keywords.json`
