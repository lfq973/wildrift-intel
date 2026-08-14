#!/usr/bin/env node
/**
 * 峡谷情报站 · 内容采集器
 * 抓取官方/资讯源的最新消息，生成 content/news_feed.json（供 App 在线更新拉取）。
 *
 * 运行：node crawler/crawl.js
 * 定时：GitHub Actions cron（见 .github/workflows/crawl-sync.yml），每 6 小时执行一次。
 *
 * 设计原则：
 *  - 只提取标题/链接/来源等公开信息，不做深层次解析，保证稳定性；
 *  - 与既有内容合并去重（按 URL），保留最近 MAX_ITEMS 条；
 *  - 任何源失败不影响其他源（逐源 try/catch）。
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'content', 'news_feed.json');
const MAX_ITEMS = 30;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WildRiftIntelBot/1.0';

function fetch(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': UA }, timeout: 20000 }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode + ' ' + url));
        }
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve(d));
      })
      .on('error', reject)
      .on('timeout', () => reject(new Error('timeout ' + url)));
  });
}

/** 官方补丁说明列表页（国际服 / 繁中） */
async function crawlOfficialPatches(locale) {
  const base = 'https://wildrift.leagueoflegends.com/' + locale + '/news/game-updates/';
  const html = await fetch(base);
  const tag = locale === 'zh-tw' ? '官方补丁说明（繁中）' : '官方补丁说明';
  const items = [];
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    const inner = m[2];
    const titleM = inner.match(/data-testid="card-title"[^>]*>([\s\S]*?)<\//);
    if (!titleM) continue;
    const title = titleM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/patch|版本更新|激鬥峽谷|激斗峡谷|版本公告/i.test(title)) continue;
    if (items.some((it) => it.url === url)) continue;
    const timeM = inner.match(/dateTime="([^"]+)"/);
    const absUrl = url.startsWith('http') ? url : 'https://wildrift.leagueoflegends.com' + url;
    // 摘要：card-description 之后的文本，去标签、去标题前缀
    let summary = '';
    const di = inner.indexOf('card-description');
    if (di >= 0) {
      summary = inner
        .substring(di)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220);
      if (summary.startsWith(title)) summary = summary.slice(title.length).trim();
    }
    items.push({
      id: 'auto_' + Math.abs(require('crypto').createHash('md5').update(absUrl).digest().readInt32LE(0)).toString(36),
      title,
      url: absUrl,
      source: tag,
      category: '版本更新',
      date: timeM ? timeM[1].slice(0, 10) : '',
      summary,
      crawledAt: new Date().toISOString().slice(0, 10)
    });
  }
  return items;
}

/** 抓取全部配置源（新源在此追加即可） */
async function crawlAll() {
  const sources = [];
  // 官方补丁页（国际服 + 繁中，任一失败不影响其他）
  for (const locale of ['en-sg', 'zh-tw']) {
    try {
      const items = await crawlOfficialPatches(locale);
      sources.push({ name: '官方补丁说明' + locale, items });
      console.log('official patches [' + locale + ']:', items.length);
    } catch (e) {
      console.warn('official patches [' + locale + '] failed:', e.message);
    }
  }
  return sources;
}

/** 合并去重：旧数据 + 新抓取 */
function merge(existing, fresh) {
  const seen = new Map();
  existing.forEach((it) => seen.set(it.url, it));
  fresh.forEach((it) => seen.set(it.url, it));
  return Array.from(seen.values()).slice(0, MAX_ITEMS);
}

async function main() {
  const existing = fs.existsSync(OUT_FILE)
    ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'))
    : [];
  const fresh = (await crawlAll()).flatMap((s) => s.items);
  const merged = merge(existing, fresh);
  fs.writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2), 'utf8');
  console.log('news_feed.json written, total items:', merged.length);
}

main().catch((e) => {
  console.error('crawl failed:', e);
  process.exit(1);
});
