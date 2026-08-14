# Books

> 一个专注本地阅读、整理和管理电子书的跨平台桌面阅读器。

**[English](README.md) | 简体中文**

Books 是一个基于 Electron、React 和 Redux 构建的开源桌面电子书阅读器。它在保留 Koodo Reader 阅读体验的基础上，继续扩展本地图书管理、书架、数据统计、阅读器外观和在线书库功能。

Books 适合希望把书籍、阅读进度和阅读环境集中保存在本地的用户。你可以将图书库存放在自己选择的磁盘位置，并通过左下角书库入口直接浏览和管理文件夹中的书籍。

## 主要功能

- 支持 EPUB、PDF、MOBI、AZW、AZW3、TXT、FB2、CBR、CBZ、CBT、CB7、Markdown、DOCX、HTML、XML、XHTML 和 MHTML 等格式。
- 支持本地书库和自定义书架，可以创建书架、拖拽整理图书并查看书架中的书籍数量。
- 内联支持 ZLibrary 入口，方便从应用内访问和查找电子书资源。具体可用性取决于网络环境和当地法律法规。
- 提供阅读统计页面，查看阅读时长、阅读进度、图书数量和其他阅读数据。
- 支持多种阅读主题、背景图片、字体、字号、行距、页面布局和夜间模式。
- 支持自定义符号颜色规则，便于在阅读时突出显示特定内容。
- 支持笔记、高亮、书签、阅读进度和阅读历史。
- 支持数据备份、快照恢复、导出图书、导出笔记和导出高亮。
- 支持云同步以及多个在线书库和书源功能，具体服务需要根据设置单独配置。
- 支持本地文件夹书库，可以直接在书库面板中创建文件夹、创建 Markdown 笔记、刷新内容和打开文件所在位置。
- 支持 Windows 桌面版便携运行，不需要安装即可使用。

## 界面预览

### ZLibrary

应用内置 ZLibrary 入口，便于在阅读器和在线书籍资源之间切换。

![ZLibrary](assets/picture/zlib.png)

### 数据统计

通过统计页面了解自己的阅读习惯和阅读进度。

![阅读统计](assets/picture/stat.png)

### 书架

使用书架整理不同主题、状态或来源的图书。

![书架](assets/picture/shelf.png)

### 阅读界面

提供专注阅读的界面，并支持主题、字体、背景和布局调整。

![阅读界面](assets/picture/reading.png)

## 下载 Windows 版本

前往 [GitHub Releases](https://github.com/user-A100/books-reader/releases) 下载最新版本。

1. 下载 `Books-x.x.x-win-x64-portable.zip`。
2. 将压缩包解压到任意文件夹。
3. 双击 `Books.exe` 启动程序。

这是便携版，不需要安装程序。图书库和应用数据会保存在 Books 中配置的位置，不会被打包进发布压缩包。

## 从源码运行和构建

环境要求：

- Node.js 20 或更高版本
- npm 或 Yarn
- Python
- Visual Studio C++ Build Tools
- LLVM（Clang-cl），用于编译 Electron 原生依赖

安装依赖：

```powershell
npm install --legacy-peer-deps
```

启动开发环境：

```powershell
yarn dev
```

构建 React 前端：

```powershell
npm run build
```

重新编译原生模块：

```powershell
npm run rebuild
```

生成桌面版：

```powershell
npm run release
```

构建结果会写入 `dist/`。如果只需要 Windows 便携版，可以运行：

```powershell
npx electron-builder --win portable
```

## 数据和隐私

- Books 默认将应用数据存放在本机用户数据目录中。
- 书库位置可以在应用内配置，也可以使用左下角书库面板管理。
- 云同步、在线书源和第三方服务只有在用户主动配置后才会使用。
- 不要将包含令牌、密码、个人书籍路径或私密配置的文件提交到公开仓库。

## 开源协议和致谢

Books 是基于 [Koodo Reader](https://github.com/koodo-reader/koodo-reader) 重建和持续开发的个人开源项目，保留上游 Apache License 2.0 相关许可和致谢信息。详细内容请查看 [LICENSE](LICENSE) 和 [NOTICE.md](NOTICE.md)。Books 的名称、Logo、本地图书功能以及后续修改由本项目独立维护。
