# 多人旅游记账 APP（联网共享版 · 国内可访问）

多人一起旅行时，用手机记录团队共同开销，行程结束后自动算出每个人应收 / 应付，并生成最小转账清单。

> 本版本是**真正的联网共享版**：数据存在服务端，多人跨设备一起记同一笔账。
> **推荐部署到腾讯 EdgeOne Pages**（国内直连、永久免费、无需信用卡、数据长期保存）→ 见「部署到 EdgeOne Pages」。
> 备选：Cloudflare Workers + D1（**但 `*.workers.dev` 在国内常被墙/限速，不推荐国内使用**）、Node + Postgres（Render 需绑卡、国内访问不稳）。

---

## 功能一览

| 功能 | 说明 |
|---|---|
| 多人一起记账 | 新建行程生成「邀请码 / 邀请链接」，同伴用邀请码加入，看到的是同一份账目 |
| 每人创建自己的角色 | 进入行程后各自「创建我的角色」，成员表记录创建者（用于默认付款人=自己） |
| 记支出 | 付款时间（默认当前、可改）、付款人、支付方式（支付宝/微信/现金/其他）、金额、备注、**多选分摊人员均分** |
| 默认付款人=自己 | 记一笔时付款人下拉默认选中「我」，需要时可改成替别人付 |
| 自动结算 | 每人「付款总额 / 分摊总额 / 净额」，区分应收/应付，贪心算法生成最小转账清单 |

---

## 技术栈

- 前端：HTML + CSS + JS（移动端优先单页应用，大按钮、清晰反馈）
- 后端：EdgeOne Pages Functions（边缘函数，Node.js 运行时，零服务器）
- 数据库：EdgeOne Pages Blob 对象存储（即用即得、免人工审批，1GB 免费额度，数据长期保存）
- 数据模型：以「行程」为单位，trip / 成员 / 支出 / 分摊分别独立存储为 Blob 键，写入互不覆盖

> 仓库同时保留了两套旧方案代码（Cloudflare：`worker.js`+`db-d1.js`+`wrangler.toml`；Node+Postgres：`server.js`+`db.js`），仅作为备选参考，主推 EdgeOne 方案。

---

## 本地运行（零依赖，用 SQLite）

```bash
cd travel-account-online
npm install        # 仅 Postgres 模式需要 pg；本地 SQLite 模式可跳过此步
npm start
# 浏览器打开 http://localhost:3000
```

不设 `DATABASE_URL` 即自动使用本地 SQLite 文件 `data/travel.db`，无需安装任何数据库。

---

## 推送到 GitHub

```bash
git init
git add .
git commit -m "init: 多人旅游记账联网版"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

---

## 部署到 EdgeOne Pages（推荐：国内可访问 + 免费 + 不绑卡）

腾讯 EdgeOne Pages：**国内网络直连、永久免费额度、注册无需信用卡**。本仓库已带 `functions/`（边缘函数）+ `public/`（前端），前端一行不改。

### 第一步：把代码推到 GitHub
（见上方「推送到 GitHub」）

### 第二步：创建 EdgeOne Makers 项目
1. 打开 https://edgeone.cloud.tencent.com/ → 左侧「Makers」→ 点击「通过导入 Git 仓库创建」
2. 授权 GitHub 后选择仓库 `travel-account-online`
3. 构建配置：
   - **构建命令**：留空（无需构建）
   - **输出目录**：填 `public`（前端静态文件所在目录）
   - 部署分支：`main`
   - 加速区域：选「全球可用区（含中国大陆）」以保证国内直连
4. 保存，平台自动首次部署

### 第三步：数据存储（无需任何配置 ✅）
本项目使用 **EdgeOne Blob 存储**，与 KV 不同，Blob 是「即用即得」——
**首次请求时由代码自动创建命名空间，不需要在控制台申请开通、也不需要绑定变量名、更不用人等审批**。
所以这一步什么都不用做，部署完即可直接记账，数据自动持久化。

> 若之前误点了 KV 的「申请开通」正在审批中，可忽略，本方案完全不依赖 KV。

### 第四步：重新部署 / 自动部署
推送到 GitHub 的 `main` 分支会**自动触发重新部署**；也可在控制台「构建部署」手动「重新部署」。
部署完成后得到地址：`https://<你的子域名>.edgeone.cool`（或你绑定的自定义域名），**手机任意网络（国内直连）都能用**。

> 说明：首次访问可能稍慢（边缘函数冷启动），之后正常。数据全部存在 EdgeOne Blob，长期保存。
> 多人协作：APP 里新建行程 → 复制「邀请链接」发给同伴 → 同伴打开后创建自己的角色，一起记账。

---

## 部署到 Cloudflare（备选 · 国内访问不稳）

> ⚠️ `*.workers.dev` 域名在大陆常被墙或严重限速，国内手机可能无法打开。**不推荐国内使用**，仅作记录。

Cloudflare Workers + D1 数据库：永久免费额度、注册无需信用卡，数据存在 D1（SQLite）长期不丢。本仓库已带 `worker.js` / `db-d1.js` / `wrangler.toml`，前端一行不改。

### 准备

```bash
# 1) 安装 wrangler（Cloudflare 官方部署工具，需 Node ≥ 18）
npm install -g wrangler

# 2) 登录 Cloudflare（浏览器授权；若登录失败可用 API Token：wrangler login --api-token）
wrangler login
```

### 创建 D1 数据库

```bash
wrangler d1 create travel-db
```

命令会输出一段配置，其中有一行 `database_id = "...."`。**复制这个 id**，粘贴到本仓库 `wrangler.toml` 里替换 `REPLACE_WITH_YOUR_D1_ID`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "travel-db"
database_id = "你复制的 id"
```

### 部署

```bash
wrangler deploy
```

部署完成后会得到地址，形如：

```
https://travel-account-online.<你的子域名>.workers.dev
```

> 也可在 Cloudflare 控制台给 Worker **绑定自定义域**（如 `travel.example.com`），国内访问更稳。

### 使用

- 手机打开上面的地址，**任意网络都能访问**（国内可直连）。
- 新建行程 → 复制「邀请链接」发给同伴 → 同伴打开后创建自己的角色，即可一起记账。
- 数据全部存在 Cloudflare D1，长期保存；首次访问 Worker 冷启动约 1 秒。

> **免费额度**：Workers 每天 10 万次请求、D1 每天 500 万次读 / 10 万次写，个人旅行记账完全够用，且**不绑卡**。

---

## 部署到 Render（含 Postgres，备选）

1. 把上面的仓库推到 GitHub。
2. 打开 [Render 控制台](https://dashboard.render.com) → **New** → **Blueprint** → 连接你的 GitHub 仓库。
3. Render 读取本仓库的 `render.yaml`，自动创建：
   - 一个免费的 **Postgres 数据库** `travel-db`
   - 一个 **Web 服务** `travel-account-online`，并把 `DATABASE_URL` 自动注入到服务环境变量
4. 部署完成后得到公网地址（如 `https://travel-account-online.onrender.com`），**手机任意网络都能打开**。
5. 多人协作：在 APP 里新建行程 → 复制「邀请链接」发给同伴 → 同伴打开后创建自己的角色，即可一起记账。

> **免费版注意**：Render 免费 Postgres 在 90 天无活动后会暂停/删除；免费 Web 服务空闲后首次访问会冷启动（约几十秒）。要真正的长期稳定，建议：
> - 升级 Render 付费实例；或
> - 改用 Supabase / Neon 等外部 Postgres，把 `DATABASE_URL` 指向它即可，**无需改动任何代码**。

---

---

## 部署到 Hugging Face Spaces（免信用卡 · 备选）

> 注意：Hugging Face 在中国大陆网络下通常无法访问，国内用户建议优先选上面的 Cloudflare 方案。
> 如果你能正常打开 huggingface.co，用 **Hugging Face Spaces（Docker 模式）** 也很省事：免费、用 GitHub 直接登录、不需要信用卡，本仓库已带 `Dockerfile`，**代码一行都不用改**。数据库继续用你建好的 Neon（或 Supabase）。

### 步骤

1. 打开 https://huggingface.co → 右上角 **Sign in** → 选 **Continue with GitHub**（用你的 `carol0662` 账号登录，无需信用卡）。
2. 右上角头像 → **New** → **Space**。
3. 填写：
   - **Space name**：`travel-account-online`（随便起，会拼进网址）
   - **SDK**：选 **Docker**（重要！不是 Gradio）
   - **Visibility**：**Public**（同伴才能用邀请链接进来）
   - 其他默认 → 点 **Create Space**。
4. 创建后进入 Space 页面 → 顶部 **Settings** → **Variables and secrets**（或 **Repository secrets**）：
   - 新增一个 **Secret / Variable**：
     - Name：`DATABASE_URL`
     - Value：粘贴你从 Neon 复制的连接串（带 `?sslmode=require` 的那串）
   - Save。
5. 回到 Space 主页 → **Files** 标签 → 点 **"…" 或 Git clone / 上传**，把本仓库的文件传上去（最简单：用 GitHub 关联，或在 Files 里一个个上传；也可以本地 `git clone` 这个 Space 后把代码 push 上去）。
   - 仓库需要包含：`server.js`、`db.js`、`package.json`、`Dockerfile`、`.dockerignore`、`public/`。
6. HF 会自动按 `Dockerfile` 构建并启动，启动完成后页面顶部的状态变绿，地址形如：
   ```
   https://<你的用户名>-travel-account-online.hf.space
   ```
   手机任意网络打开这个链接即可使用。

> **免费说明**：HF Spaces 免费实例在长时间无访问后会休眠，下次打开会自动唤醒（冷启动约几秒到十几秒），数据存在 Neon 不会丢。无需信用卡。

---

## API 概览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/trips` | 行程列表 |
| POST | `/api/trips` | 新建行程（自动生成邀请码 `code`） |
| GET | `/api/trips/code/:code` | 按邀请码查询行程（用于加入） |
| GET/PUT/DELETE | `/api/trips/:id` | 行程详情 / 改名 / 删除（级联删除成员与支出） |
| POST | `/api/trips/:id/members` | 新增成员（带 `created_by` 标记创建者） |
| PUT/DELETE | `/api/members/:id` | 改/删成员（作为付款人的成员需先删其支出） |
| POST | `/api/trips/:id/expenses` | 记一笔支出（含分摊人员数组） |
| PUT/DELETE | `/api/expenses/:id` | 改/删支出 |
| GET | `/api/trips/:id/settle` | 结算：每人汇总 + 最小转账清单 |

---

## 目录结构

```
travel-account-online/
├── functions/                 # ★ EdgeOne Pages Functions（边缘函数，主推部署方式）
│   ├── _db.js                 # ★ 基于 Blob 的数据层（KV 接口适配器）+ 结算算法
│   ├── _resp.js               # ★ JSON 响应辅助
│   └── api/                   # ★ /api/* 路由（trips、members、expenses、settle、code）
├── public/                    # 前端静态文件（EdgeOne 输出目录设为 public）
│   ├── index.html             # SPA 页面骨架
│   ├── style.css              # 移动端样式
│   └── app.js                 # 前端逻辑（身份 / 邀请码加入 / 创建角色 / 记账 / 结算）
├── worker.js                  # Cloudflare Worker 入口（备选方案）
├── db-d1.js                   # Cloudflare D1 数据层（备选方案）
├── wrangler.toml              # Cloudflare 部署配置（备选）
├── server.js                  # Node 版后端（本地开发 / Render 备选）
├── db.js                      # Node 版统一数据层（Postgres / SQLite 自动切换）
├── package.json               # 依赖与启动脚本
├── Dockerfile                 # Hugging Face Spaces 容器部署（免信用卡备选，国内打不开）
├── render.yaml                # Render 部署配置（含 Postgres，需绑卡）
├── .env.example               # 环境变量说明
└── data/                      # 本地 SQLite 文件（仅本地模式生成，已被 .gitignore 忽略）
```

---

## 数据持久化说明

- **EdgeOne Pages Blob（推荐）**：数据独立存储在腾讯云边缘 Blob 对象存储（1GB 免费），首次请求自动创建命名空间，无需申请开通 / 绑卡 / 等审批；应用重启或重新部署都不会丢失，且国内可访问、免费不绑卡。
- **Cloudflare D1（备选）**：数据存在 Cloudflare 托管的 SQLite，但 `*.workers.dev` 国内常无法访问。
- **云端（Render + Postgres）**：独立托管数据库，但 Render 免费实例需绑卡、国内访问不稳。
- **本地（SQLite）**：数据存在 `data/travel.db`，关闭不丢，适合开发调试或纯本机使用。

---

## 常见问题

- **手机连不上？** EdgeOne 版为国内公网链接，任意网络可访问；本地版需手机与电脑同一 Wi-Fi 并访问电脑局域网 IP。
- **删除成员提示有支出？** 该成员已作为付款人存在支出记录，需先删除其相关支出，避免账目错乱。
- **结算金额对不上？** 每笔支出按「分摊人员数量均分」，可在支出详情核对分摊名单。
