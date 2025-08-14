# ADR 0003: 错误与修复日志（滚动）

记录迄今遇到的问题与对应解决方案，便于回溯与协作。

## 1) Not allowed to load local resource: chrome://favicon/...
- 症状：控制台大量报错。
- 原因：尝试用 `chrome://favicon/<url>` 作为大图或回退图；`chrome:`/`chrome-extension:` 协议不允许。
- 解决：不再用 favicon 作为大预览图，仅在元信息行显示小图标；仅允许 `http/https/data` 协议的 favicon。

## 2) Hide sleeping 无效或不稳定
- 症状：开启后无差异或过滤异常。
- 原因：直接用 `tab.discarded` 过滤不稳定；误用 `autoDiscardable`。
- 解决：`tabs.query({ discarded: true, ...scope })` 获取集合并按 id 过滤；`autoDiscardable` 不参与过滤；提供 Debug 信息。

## 3) Current window only 只显示一个标签
- 原因：弹窗被当作当前窗口。
- 解决：`windows.getLastFocused({ windowTypes: ['normal'] })`，且不缓存。

## 4) 过滤后感觉更卡
- 解决：并发自适应（2–4）、更早懒加载触发、较轻 JPEG、移除失败后即时重过滤。

## 5) 调试横幅无法关闭
- 结论：系统安全提示无法隐藏。
- 方案：提供互斥模式：CDP（真实截图，有横幅）/ DOM（页面内画布，无横幅）。

## 6) CDP 无图且无横幅
- 原因：移除 `debugger` 权限。
- 解决：恢复权限；改为单选模式。

## 7) DOM 仅有文字
- 解决：canvas 合成，尝试 og:image/主图，暗色遮罩，多行标题与域名；受 CSP/跨域限制可能回退。

## 8) 默认对齐 F3
- 仅显示未休眠标签，默认仅当前窗口；默认 DOM 缩略图。
