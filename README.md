# 科研进度管理 · Research Progress Manager

一个科研进度管理小工具，支持**账号登录 + 云端同步**：在任意电脑登录同一账号，即可看到自己的科研进度。
前端是纯静态页面（可部署到 GitHub Pages），数据通过后端 API 存到云端，本机保留离线缓存。

> 适合研究生 / 科研人员管理课题任务、实验记录、文献与投稿进度、里程碑时间线。

## ✨ 功能

| 模块 | 说明 |
|------|------|
| 📋 **进度看板** | 四列看板（待启动 / 进行中 / 已阻塞 / 已完成），**拖拽**即可改变阶段，支持优先级、截止日期、标签 |
| 🧫 **实验记录** | 记录实验名称、状态、条件参数、指标结果与结论分析，支持全文搜索 |
| 📚 **论文文献** | 管理文献与自己的论文，覆盖「构思 → 精读 → 撰写 → 投稿 → 返修 → 接收/被拒」全流程，按状态筛选 |
| 🗓 **时间线** | 里程碑时间轴 + 未来 30 天「近期截止」自动汇总 |
| 📈 **统计** | 任务阶段分布、优先级分布、实验进度、文献状态、近 8 周完成任务趋势（Chart.js 图表） |
| ☁️ **账号与云同步** | 邮箱注册 / 登录，每个账号**只能看到自己的数据**；离线可用，联网自动同步 |
| 💾 **数据管理** | 导出 / 导入 JSON 备份，一键载入示例数据，一键清空 |

## 🔐 账号与数据隔离

- 邮箱 + 密码注册，密码经 **PBKDF2-SHA256 加盐哈希**（10 万次迭代）后存储，**服务器不保存明文**
- 登录后签发 JWT（7 天有效），所有数据读写以令牌中的用户 ID 为准
- **每个账号的数据在服务端独立存储**，即使拿到别人的令牌也无法读取或覆盖其数据
- 退出登录后旧令牌立即失效

## ☁️ 云端同步

- **离线优先**：断网时照常增删改，数据落在本机缓存，联网后自动补推
- 多设备冲突时（同一账号在两台电脑同时改）会提示你选择保留哪一份，**不会静默丢数据**
- 首次用空账号登录时，若本机已有数据会询问是否上传，避免误覆盖

## 🚀 本地使用

```bash
# Python 3
python -m http.server 8080
# 访问 http://localhost:8080
```

> 需要先部署后端（见下）并把 `assets/cloud.js` 里的 `API_BASE` 指向你的 Worker 地址。

## 🌐 部署

### 1. 部署后端（Cloudflare Worker + D1）

后端代码在 `research-cloud/` 目录，完整步骤见该目录的 `README.md`，简要：

```bash
cd research-cloud
npm install
npx wrangler login
npx wrangler d1 create research-progress    # 把 database_id 填进 wrangler.toml
npm run migrate:remote
npx wrangler secret put JWT_SECRET          # 设置会话签名密钥
npm run deploy
```

### 2. 配置前端指向后端

编辑 `assets/cloud.js`：

```js
const API_BASE = window.RESEARCH_API_BASE || 'https://<你的-worker>.workers.dev';
```

### 3. 部署前端到 GitHub Pages

```bash
git add .
git commit -m "feat: 账号系统 + 云端同步"
git push
```

推送后，在 GitHub 仓库 **Settings → Pages**：Source 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`。

> 若仓库 **Settings → Pages → Source** 选 **GitHub Actions**，则每次 push 会自动部署。
> 同时记得把 Worker 的 `ALLOWED_ORIGINS` 设成 `https://<你的用户名>.github.io`。

## 📁 目录结构

```
科研进度管理/
├── index.html              # 页面结构（含登录/注册界面）
├── assets/
│   ├── style.css           # 样式（含深色模式、响应式、登录界面）
│   ├── cloud.js            # 云端 API 封装（注册/登录/同步）
│   └── app.js              # 应用逻辑（数据层 / 渲染 / 图表 / 导入导出）
├── data/
│   └── sample.json         # 示例数据（可「导入」体验）
├── .github/workflows/
│   └── pages.yml           # GitHub Pages 自动部署
└── README.md
```

后端另在 `research-cloud/`（Worker 源码、D1 建表、部署文档）。

## 🛠 自定义

- 修改任务阶段 / 优先级 / 状态枚举：编辑 `assets/app.js` 顶部的 `TASK_STAGES`、`PRIORITIES`、`EXP_STATUS`、`PAPER_STATUS`。
- 修改配色 / 主题：编辑 `assets/style.css` 顶部的 CSS 变量（`--accent` 等），深色模式会自动跟随系统。

## 📄 License

MIT
