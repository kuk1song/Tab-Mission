# ADR 0001: Hide sleeping filter behavior

Context

- 需求：在概览中隐藏“已休眠（discarded）”的标签，减少黑屏与噪音。
- 初版做法：基于 `tab.discarded` 字段直接过滤。
- 问题：在部分环境中效果不明显，或与预期不一致；也出现站点阻止截图导致黑图但并非 discarded。

Decision

- 采用两步策略：
  1) 使用 `chrome.tabs.query({ discarded: true })` 获取休眠集合，以 `id` 精确过滤；
  2) 在“Hide sleeping”开启时，若某标签 CDP 截图失败，标记为 `uncapturable`，并从列表中移除（避免黑图）。
- 引入“仅当前窗口”开关，缩小数据范围，降低开销与干扰。

Consequences

- 可见差异更明确，用户感知“Hide sleeping”有效。
- 对个别不可截页面（但非 discarded）会被隐藏；用户可关闭该开关查看完整列表。
- 未来可增加“最近 N 分钟使用”阈值开关，进一步压缩集合。

