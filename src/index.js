import Parser from 'rss-parser';

// ============================================================
// 配置区：想加/删源直接改这里
// name: 展示名；url: RSS 地址；limit: 每个源取最新几条
// ============================================================
const FEEDS = [
  { name: '巨潮资讯',     url: 'https://www.cninfo.com.cn/new/disclosure/stock?rss=latest', limit: 10 },
  { name: '东方财富-财报', url: 'https://finance.eastmoney.com/rss/', limit: 10 },
  { name: '雪球',         url: 'https://xueqiu.com/hots/topic/rss', limit: 8 },
  { name: '华尔街见闻',    url: 'https://wallstreetcn.com/feed', limit: 8 },
  { name: '财新公司',     url: 'https://www.caixin.com/rss/company.xml', limit: 8 },
  { name: '第一财经公司',  url: 'https://www.yicai.com/rss/company.xml', limit: 8 },
  { name: '新浪财经',     url: 'https://rss.sina.com.cn/finance/stock/', limit: 8 },
];

// 筛选阈值：LLM 打分 >= 这个值才推送
const SCORE_THRESHOLD = 6;
// 最多推送几条（防止飞书卡片太长）
const MAX_PUSH = 8;

// ============================================================
// 1. 拉取所有 RSS
// ============================================================
const parser = new Parser({ timeout: 15000 });

async function fetchAllFeeds() {
  const items = [];
  for (const feed of FEEDS) {
    try {
      const f = await parser.parseURL(feed.url);
      (f.items || []).slice(0, feed.limit).forEach((it) => {
        items.push({
          title: (it.title || '').trim(),
          link: (it.link || '').trim(),
          source: feed.name,
        });
      });
      console.log(`[ok] ${feed.name}: ${f.items?.length || 0} 条`);
    } catch (e) {
      console.error(`[fail] ${feed.name}: ${e.message}`);
    }
  }
  return items;
}

// ============================================================
// 2. 去重（按 URL，其次按标题）
// ============================================================
function dedup(items) {
  const seen = new Set();
  return items.filter((it) => {
    const k = (it.link || it.title).trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ============================================================
// 3. 调 LLM 筛选 + 摘要（OpenAI 兼容协议）
// ============================================================
async function llmFilter(items) {
  console.log(items,'items项')
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    console.error('[warn] 未配置 LLM_API_KEY，跳过 LLM 筛选，直接推送全部去重后资讯');
    return items.slice(0, MAX_PUSH).map((it) => ({
      title: it.title, link: it.link, source: it.source,
      summary: '', category: '未分类', score: 8,
    }));
  }

  const payload = items.map((it, i) => `${i + 1}. [${it.source}] ${it.title} | ${it.link}`).join('\n');

  const systemPrompt = `你是一个资深财经编辑，重点关注上市公司财报、业绩预告、重大公告。
你的任务：从给定资讯列表中筛出与公司财报、业绩、重大经营事项相关的，打分(0-10)，并给一句话中文摘要。
只输出 JSON 数组，不要任何额外解释。每项字段：
{
  "title": "原标题",
  "link": "原链接",
  "source": "原来源",
  "score": 数字,
  "category": "业绩财报|业绩预告|重大公告|分红送转|并购重组|公司动态",
  "summary": "一句话中文摘要，不超过50字"
}
只保留 score >= ${SCORE_THRESHOLD} 的，最多 ${MAX_PUSH} 条，按 score 从高到低排。`;

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: payload },
      ],
    }),
  });
  console.log(resq,'resq')
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM 请求失败 ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '[]';

  // 容错：从返回文本里抠出 JSON 数组
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('LLM 返回无法解析为 JSON: ' + content.slice(0, 200));

  const list = JSON.parse(match[0]);
  return list.slice(0, MAX_PUSH);
}

// ============================================================
// 4. 推送到飞书群机器人
// ============================================================
async function pushToFeishu(newsList) {
  const webhook = process.env.FEISHU_WEBHOOK;
  if (!webhook) throw new Error('未配置 FEISHU_WEBHOOK');

  const today = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  if (!newsList.length) {
    newsList = [{ title: '今天没有筛到值得看的资讯', link: '', source: '', summary: '', category: '', score: 0 }];
  }

  const elements = newsList.flatMap((n, i) => {
    const header = `${i + 1}. 【${n.category || '资讯'}｜${n.source || ''}】${n.title}`;
    const body = n.summary ? `   ${n.summary}` : '';
    const linkLine = n.link ? `   [打开原文](${n.link})` : '';
    return [
      { tag: 'div', text: { tag: 'lark_md', content: [header, body, linkLine].filter(Boolean).join('\n') } },
      { tag: 'hr' },
    ];
  });

  // 去掉最后一条 hr
  if (elements.length && elements[elements.length - 1].tag === 'hr') elements.pop();

  const card = {
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: `🤖 每日 AI 资讯 · ${today}` },
        template: 'blue',
      },
      elements,
    },
  };

  const resp = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card),
  });

  const result = await resp.json();
  if (result.code !== 0 && result.StatusCode !== 0) {
    throw new Error(`飞书推送失败: ${JSON.stringify(result)}`);
  }
  console.log('[ok] 飞书推送成功，共', newsList.length, '条');
}

// ============================================================
// main
// ============================================================
async function main() {
  console.log('=== 开始执行 AI 资讯推送 ===');
  const raw = await fetchAllFeeds();
  console.log(`[info] 共拉取 ${raw.length} 条`);

  const clean = dedup(raw);
  console.log(`[info] 去重后 ${clean.length} 条`);

  const picked = await llmFilter(clean);
  console.log(`[info] LLM 筛出 ${picked.length} 条`);

  await pushToFeishu(picked);
  console.log('=== 完成 ===');
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});