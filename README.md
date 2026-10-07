# 科研进度管理 · Research Progress Manager

一个**纯前端、零后端、零依赖安装**的科研进度管理小工具。所有数据保存在浏览器 `localStorage`，随开随用，可一键部署到 GitHub Pages。

> 适合研究生 / 科研人员管理课题任务、实验记录、文献与投稿进度、里程碑时间线。

## ✨ 功能

| 模块 | 说明 |
|------|------|
| 📋 **进度看板** | 四列看板（待启动 / 进行中 / 已阻塞 / 已完成），**拖拽**即可改变阶段，支持优先级、截止日期、标签 |
| 🧫 **实验记录** | 记录实验名称、状态、条件参数、指标结果与结论分析，支持全文搜索 |
| 📚 **论文文献** | 管理文献与自己的论文，覆盖「构思 → 精读 → 撰写 → 投稿 → 返修 → 接收/被拒」全流程，按状态筛选 |
| 🗓 **时间线** | 里程碑时间轴 + 未来 30 天「近期截止」自动汇总 |
| 📈 **统计** | 任务阶段分布、优先级分布、实验进度、文献状态、近 8 周完成任务趋势（Chart.js 图表） |
| 💾 **数据管理** | 导出 / 导入 JSON 备份，一键载入示例数据，一键清空 |

## 🚀 本地使用

无需安装任何依赖，二选一：

**方式一：直接打开**

双击 `index.html` 即可在浏览器中使用。

**方式二：本地起服务（推荐，避免个别浏览器的 file:// 限制）**

```bash
# Python 3
python -m http.server 8080
# 然后访问 http://localhost:8080
```

## 🌐 部署到 GitHub Pages

```bash
git init
git add .
git commit -m "feat: 科研进度管理初始版本"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

推送后，在 GitHub 仓库页面进入 **Settings → Pages**：

- **Source** 选择 `Deploy from a branch`
- **Branch** 选择 `main`，目录选 `/ (root)`
- 保存，稍等片刻即可通过 `https://<你的用户名>.github.io/<仓库名>/` 访问

> 本项目已内置 GitHub Actions 工作流 `.github/workflows/pages.yml`。如果仓库的 **Settings → Pages → Source** 选择 **GitHub Actions**，则每次 push 会自动部署，无需手动选分支。

## 📁 目录结构

```
科研进度管理/
├── index.html              # 页面结构
├── assets/
│   ├── style.css           # 样式（含深色模式、响应式）
│   └── app.js              # 全部应用逻辑（数据层 / 渲染 / 图表 / 导入导出）
├── data/
│   └── sample.json         # 示例数据（可「导入」体验）
├── .github/workflows/
│   └── pages.yml           # GitHub Pages 自动部署
├── .gitignore
├── LICENSE
└── README.md
```

## ⚠️ 数据说明

- 数据仅保存在**当前浏览器**的 `localStorage` 中，**不会上传到任何服务器**。
- 清除浏览器数据、更换浏览器/设备会丢失数据 —— 请定期用「⬇ 导出」备份，换设备时「⬆ 导入」。
- GitHub Pages 部署的是**页面本身**，你在网页上录入的数据不会进入仓库。

## 🛠 自定义

- 修改任务阶段 / 优先级 / 状态枚举：编辑 `assets/app.js` 顶部的 `TASK_STAGES`、`PRIORITIES`、`EXP_STATUS`、`PAPER_STATUS`。
- 修改配色 / 主题：编辑 `assets/style.css` 顶部的 CSS 变量（`--accent` 等），深色模式会自动跟随系统。

## 📄 License

MIT
