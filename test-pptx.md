# 测试 PPTX 解析功能

## 如何测试

### 方法 1：使用现有的 PPTX 文件

如果你有现成的 PPTX 文件，直接放到 `test-docs/` 目录：

```bash
cp ~/Downloads/example.pptx test-docs/
npm run index
```

### 方法 2：创建测试 PPTX（用 PowerPoint）

1. 打开 PowerPoint
2. 创建几张幻灯片，添加一些文字
3. 保存为 `test-docs/test-presentation.pptx`
4. 运行索引：`npm run index`

### 方法 3：下载示例 PPTX

从网上下载任意 PPTX 文件测试。

## 验证结果

索引完成后，在 Cherry Studio 中搜索 PPTX 中的内容，看是否能找到。

## 注意事项

- ✅ 支持 `.pptx` (PowerPoint 2007+)
- ❌ 不支持 `.ppt` (旧版本)
  - 如果需要，请先用 PowerPoint 转换为 .pptx
- 提取的内容按幻灯片顺序，用 `---` 分隔
- 只提取文本，不提取图片、图表等
