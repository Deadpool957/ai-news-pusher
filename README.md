# AI 资讯筛洗推送（GitHub Actions + 飞书机器人）

每天定时拉取多个 AI 资讯源，用 LLM 筛选打分 + 生成中文摘要，自动推送到飞书群。

## 文件结构

```
ai-news-pusher/
├── package.json
├── src/
│   └── index.js              # 主逻辑：拉RSS → 去重 → LLM筛选 → 飞书推送
└── .github/
    └── workflows/
        └── daily-ai-news.yml # GitHub Actions 定时任务
```

## 三步跑通

### 第 1 步：建飞书群机器人
1. 飞书群 → 设置 → 群机器人 → 添加机器人 → **自定义机器人**
2. 名字随便起（如"AI日报"），复制 Webhook 地址（形如 `https://open.feishu.cn/open-apis/bot/v2/hook/xxxx`）

### 第 2 步：把代码推到你自己的 GitHub 仓库
```bash
cd ai-news-pusher
git init
git add .
git commit -m "init"
# 换成你自己的仓库地址
git remote add origin git@github.com:你的账号/ai-news-pusher.git
git push -u origin main
```

### 第 3 步：在 GitHub 仓库里配置 Secrets
打开仓库 → **Settings → Secrets and variables → Actions → New repository secret**，添加：

| Secret 名 | 填什么 | 示例 |
|---|---|---|
| `FEISHU_WEBHOOK` | 第1步复制的 webhook | `https://open.feishu.cn/...` |
| `LLM_API_KEY` | 你的大模型 API key | `xxx` |
| `LLM_BASE_URL` | OpenAI 兼容接口地址（可选，默认 OpenAI） | 豆包填 `https://ark.cn-beijing.volces.com/api/v3` |
| `LLM_MODEL` | 模型名（可选） | 豆包填 `doubao-pro-32k`；DeepSeek 填 `deepseek-chat` |

> 不填 `LLM_API_KEY` 也能跑——会跳过 LLM 筛选，直接把去重后的最新资讯推过来，方便你先验证飞书通道是否通。

## 本地调试（不依赖 Actions）

```bash
npm install

# 先只测飞书通道（不调 LLM）
export FEISHU_WEBHOOK="https://open.feishu.cn/open-apis/bot/v2/hook/xxxx"
node src/index.js

# 再带上 LLM 完整跑
export LLM_API_KEY="xxx"
export LLM_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
export LLM_MODEL="doubao-pro-32k"
node src/index.js
```

## 自定义

- **改资讯源**：编辑 `src/index.js` 顶部的 `FEEDS` 数组，加/删 RSS 地址即可。
- **改推送时间**：编辑 `.github/workflows/daily-ai-news.yml` 里的 `cron`（注意是 UTC 时间，北京时间 = UTC + 8）。当前配置 `0 0 * * *` = 每天北京时间早 8:00。
- **改筛选严格度**：调 `SCORE_THRESHOLD`（默认 6，越高筛得越狠）。
- **改关注方向**：编辑 `llmFilter()` 里的 `systemPrompt`，把"关注方向"那段换成你自己关心的领域。

## 常见问题

- **飞书没收到消息**：先看 Actions 运行日志（仓库 → Actions → 点最近一次运行），一般是 webhook 配错或 LLM 返回格式不对。
- **Actions 定时没触发**：GitHub 的 schedule 在新仓库/刚 push 后可能延迟；可以先在 Actions 页面手动点 **Run workflow** 验证。
- **想推到自己私聊而不是群**：用同样的自定义机器人建在你和自己的对话里，webhook 一样用。
