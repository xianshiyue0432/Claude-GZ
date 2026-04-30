# Claude-GZ 发布准备脚本

## 当前状态
- ✅ 前端构建成功 (`bun run build`)
- ✅ Lint 检查通过
- ✅ 版本已更新到 1.0.2
- ✅ Release notes 已创建
- ❌ Rust 编译因 Windows bug 失败

## 解决方案

### 步骤 1: 初始化 Git 仓库并推送到 GitHub

在 PowerShell 中运行以下命令：

```powershell
# 1. 进入项目目录
cd e:\MySoftware\GZ-IDE-CChaha111

# 2. 初始化 Git 仓库
git init

# 3. 添加所有文件
git add .

# 4. 创建提交
git commit -m "release: v1.0.2"

# 5. 添加远程仓库 (替换为你自己的仓库URL)
git remote add origin https://github.com/你的用户名/Claude-GZ.git

# 6. 创建标签
git tag -a v1.0.2 -m "Release v1.0.2"

# 7. 推送代码和标签到 GitHub
git push -u origin main
git push origin v1.0.2
```

### 步骤 2: GitHub Actions 将自动构建

推送后，GitHub Actions 会自动触发构建流程，生成：
- Windows NSIS 安装包 (Claude-GZ_v1.0.2_windows_x64_setup.exe)
- Windows 便携版 (Claude-GZ_v1.0.2_windows_x64.msi)

## 版本 1.0.2 更新内容

### 新功能
1. **终端弹出窗口** - 支持拖出主界面作为独立窗口
2. **Monaco Editor** - 完整的代码编辑器功能
3. **选择性加载** - 支持环境变量控制加载的模块

### 修复
- 修复代码编辑器重复标签页问题

## 文件变更清单

| 文件 | 变更 |
|------|------|
| desktop/package.json | 版本 1.0.1 → 1.0.2 |
| desktop/src-tauri/tauri.conf.json | 版本 1.0.1 → 1.0.2 |
| desktop/src-tauri/Cargo.toml | 版本 1.0.1 → 1.0.2 |
| release-notes/v1.0.2.md | 新建 |
| BUILD_INSTRUCTIONS.md | 新建 |
