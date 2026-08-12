# 多人旅游记账 APP（联网共享版 · 永久免费域名）

多人一起旅行时，用手机记录团队共同开销，行程结束后自动算出每个人应收 / 应付，并生成最小转账清单。

> 本版本是**真正的联网共享版**：数据存在服务端，多人跨设备一起记同一笔账。
> **推荐部署到 Cloudflare Pages**（自带 `*.pages.dev` **永久免费域名**、无需信用卡、数据存在 D1 长期保存）→ 见「部署到 Cloudflare Pages」。
> 说明：Cloudflare `*.pages.dev` 在大陆访问速度可能不及国内厂商，但一般可打开；若需国内最优访问可考虑绑定自己的域名（CNAME 到 Cloudflare）。

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
- 后端：Cloudflare Pages（`_worker.js` 边缘函数，零服务器）
- 数据库：Cloudflare D1（SQLite 语法，绑定名 `DB`，建表在首次请求时自动完成，数据长期保存）
- 数据模型：以「行程」为单位，trip / 成员 / 支出 / 分摊分别建表，外键级联删除

> 数据访问层在 `db-d1.js`，业务路由在 `_worker.js`，前端 `public/` 一行不改。
> 早期试过的 EdgeOne Makers / Node+Postgres 方案已弃用（保留在本地 `edge-functions/`、`server.js` 等文件，已 gitignore，不纳入部署）。

---

## 本地预览（可选）

如需本地调试，用 wrangler 起一个 Cloudflare 本地环境（需先 `wrangler d1 create` 并在 `wrangler.toml` 填好 `database_id`）：

```bash
npm install -g wrangler
wrangler pages dev --binding DB=./.wrangler/d1 --persist
# 浏览器打开提示的本地地址
```

直接部署到 Cloudflare Pages 更简单，见上方「部署到 Cloudflare Pages」。

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

## 部署到 Cloudflare Pages（推荐：自带永久免费域名）

Cloudflare Pages：**自带 `*.pages.dev` 永久免费域名、无需信用卡、数据存在 D1 长期保存**。本仓库已带 `_worker.js`（边缘函数）+ `db-d1.js`（D1 数据层）+ `public/`（前端），前端一行不改。

### 第一步：把代码推到 GitHub
（见上方「推送到 GitHub」）

### 第二步：创建 Cloudflare Pages 项目（全程在网页控制台，不用 wrangler CLI）
1. 登录 https://dash.cloudflare.com/ → 左侧 **Workers 和 Pages** → **创建** → **Pages** → **连接到 Git**
2. 授权 GitHub 后选择仓库 `travel-account-online`
3. 构建设置：
   - **构建命令**：**留空**（无需构建）
   - **构建输出目录**：填 `public`
   - 框架预设：无（或 Other）
4. 点击「保存并部署」，等待首次构建完成（几十秒）

### 第三步：创建并绑定 D1 数据库（关键，否则数据存不下来）
1. Cloudflare 控制台左侧 **D1 SQL 数据库** → **创建数据库**，名称填 `travel-db`，创建后复制它的 **数据库 ID**
2. 回到 Pages 项目 → **设置** → **Functions** → **D1 数据库绑定** → **添加绑定**
   - 变量名称填 **`DB`**（必须与 `_worker.js` 中一致）
   - 选择刚才创建的 `travel-db`
3. 保存

### 第四步：重新部署
回到 Pages 项目 → **部署** → 最新部署点 **「重新部署」**（或等下次推 GitHub 自动部署）。
部署完成后得到**永久地址**：`https://travel-account-online.pages.dev`（子域名可改），**手机、电脑直接打开即用，无需任何 token**。

> 说明：建表语句在首次请求时由 `_worker.js` 自动执行，无需手动建表。
> 多人协作：APP 里新建行程 → 复制「邀请链接」发给同伴 → 同伴打开后创建自己的角色，一起记账。
> 若 `*.pages.dev` 在你的网络下偏慢，可在 Pages 项目「自定义域」里绑定你自己的域名（CNAME 到 Cloudflare 即可）。

---

## 备选：Cloudflare Workers（非 Pages）

本仓库的 `_worker.js` 同样可以作为**普通 Cloudflare Worker** 部署（用 `wrangler deploy`，需把 `wrangler.toml` 的 `pages_build_output_dir` 改为 `main = "_worker.js"`，并填好 `database_id`）。前端静态资源用 Workers 的 Static Assets 提供。功能和 Pages 版完全一致，区别只是部署形态。一般推荐直接用上面的 **Cloudflare Pages Git 集成**（更简单、自带 `*.pages.dev` 域名）。

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
├── edge-functions/            # ★ EdgeOne Makers Edge Functions（边缘函数，主推部署方式）
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
