# ADR 0002: Performance tuning for thumbnail capture

Context

- 初版缩略图为同步批处理，阈值较高，attach/detach 开销偏大，滚动时偶发卡顿。

Decision

- 并发自适应：基于 `navigator.hardwareConcurrency` 一半，夹在 2–4 之间。
- 提前触发懒加载：`threshold=0.1`，`rootMargin=400px`，上滚即预取。
- 截图更轻：JPEG 质量 55，关闭 `captureBeyondViewport`，可选启用 `Page.enable/disable`。
- 去除截图失败的即时 re-render，减少主线程争用。

Consequences

- 滚动更丝滑，缩略图逐步淡入。
- 在弱机器或大量标签时，CPU 压力显著下降。

