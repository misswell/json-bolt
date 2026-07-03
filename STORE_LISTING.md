# Chrome Web Store 发布清单

> 以下内容需要在 Chrome 开发者控制台 (https://chrome.google.com/webstore/devconsole) 中填写。

---

## 1. 已修复的 Manifest 问题

| 问题 | 状态 |
|------|------|
| icons (16/32/48/128) | ✅ 已创建至 `public/icons/` 并纳入 manifest |
| host_permissions | ✅ 已添加 `"<all_urls>"` |
| default_icon | ✅ 已添加至 action |
| description 详细说明 | ✅ 已更新至 25 字符以上 |

## 2. Store Listing 需要填写的内容（请在开发者控制台完成）

### 商品详情
- **名称**: JsonBolt
- **说明（详细说明）**: 
  > JsonBolt is a high-performance JSON viewer for Chrome that lets you inspect, format, and search JSON payloads directly in your browser. Features include:
  > - **Parse & Format**: Paste, drag-and-drop, or read JSON from the current page
  > - **Virtual Tree View**: Uses react-window for smooth scrolling through large JSON trees
  > - **Web Worker Backend**: Parsing runs off the main thread — no UI freezes
  > - **Search**: Search keys and values with keyboard navigation
  > - **Expand by Depth**: Expand/collapse all or expand to a specific depth level
  > - **Clipboard Integration**: Paste JSON from clipboard or copy formatted output
  > - **File Drop**: Drop JSON/text files to parse instantly
  > - **Side Panel & Popup**: Works both as a side panel and a full-page extension
  > - **i18n**: Supports English and Chinese (browser language detection)
  > - **Large File Support**: Streaming parse with progress for multi-hundred-MB files
- **类别**: Developer Tools（开发者工具）
- **语言**: English（主要）, 中文 Chinese

### 截图
需要至少 1 张截图（1280x800 或 640x400 建议比例）。
建议截图内容：
1. **主界面** — 粘贴 JSON 后展示格式化后的树状视图
2. **搜索功能** — 高亮显示搜索结果
3. **Side Panel 视图** — 在侧边栏中使用

### 图标
已生成至 `dist/icons/` 目录：
- icon16.png, icon32.png, icon48.png, icon128.png

### 隐私权规范（Privacy Tab）

需要在开发者控制台 -> 修改 -> 隐私权规范 中填写以下信息：

#### 权限说明（Permission Justifications）

| 权限 | 单一用途说明 | 理由 |
|------|-------------|------|
| `activeTab` | **读取当前页面 JSON 内容** | 用户点击"Page"按钮时，扩展需要读取当前标签页的纯文本内容，从中提取 JSON 数据进行解析和展示。仅在用户主动触发时使用。 |
| `scripting` | **在用户标签页中执行内容提取脚本** | 配合 activeTab 使用，通过 chrome.scripting.executeScript 在当前标签页中提取 body text 以获取 JSON 内容。只在用户主动点击"Page"按钮时执行。 |
| `sidePanel` | **在 Chrome 侧边栏中展示 JSON 查看器** | 扩展的核心 UI 之一，允许用户在浏览网页时同时打开侧边栏查看和操作 JSON，而不需要切换到独立的标签页。 |
| `storage` | **存储扩展设置和用户偏好** | 用于保存用户的搜索历史、展开层级偏好等本地设置，提升使用体验。所有数据存储在本地，不上传。 |
| `clipboardRead` | **从剪贴板粘贴 JSON** | 用户点击"Paste"按钮时，需要读取剪贴板中的文本内容来获取 JSON 数据。仅在用户主动触发时使用。 |
| `clipboardWrite` | **复制格式化后的 JSON 到剪贴板** | 用户点击"Copy"按钮时，需要将格式化/压缩后的 JSON 写入剪贴板。仅在用户主动触发时使用。 |

#### 远程代码声明
- ❌ **未使用远程代码**。扩展的所有代码均打包在本地，无远程代码注入。
- ❌ **未使用 wasm**（如有则需额外声明）

#### 数据使用声明
- **用户数据收集**: 不收集任何用户数据。所有 JSON 数据仅在本地处理，不会传输到任何远程服务器。
- **认证**: 不需要。
- **数据分析**: 不使用。
- **广告**: 不包含。

---

## 3. 发布前最终检查清单

- [x] Manifest 包含 icons (16, 32, 48, 128)
- [x] Manifest 包含 host_permissions
- [x] Manifest 包含 default_icon
- [ ] 在开发者控制台上传至少 1 张截图（建议 1280x800）
- [ ] 在开发者控制台选择类别：Developer Tools
- [ ] 在开发者控制台选择语言
- [ ] 在隐私权规范中填写上述权限说明
- [ ] 确认数据使用符合开发者政策
- [ ] 上传 `release/JsonBolt-0.1.1-chrome.zip`
