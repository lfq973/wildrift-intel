#!/usr/bin/env node
/**
 * 峡谷情报站 · 实时英雄数据采集器
 * 抓取 zathong.com 各英雄 build 页（Tier/出装/召唤师技能/符文/加点），
 * 生成 content/champion_builds.json，供 App 攻略页「实时数据」区展示。
 *
 * 运行：node crawler/crawl_builds.js（可并入 crawl-sync 定时任务）
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'content', 'champion_builds.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WildRiftIntelBot/1.0';

// championId -> zathong slug（与 champions.json 对齐）
const SLUGS = {
  yasuo: 'yasuo', zed: 'zed', ahri: 'ahri', orianna: 'orianna',
  fiora: 'fiora', riven: 'riven', garen: 'garen', malphite: 'malphite',
  'lee-sin': 'lee-sin', khazix: 'khazix', 'jarvan-iv': 'jarvan', 
  jinx: 'jinx', kaisa: 'kaisa', jhin: 'jhin', thresh: 'thresh', rakan: 'rakan',
  volibear: 'volibear', olaf: 'olaf', darius: 'darius', 'dr-mundo': 'dr-mundo',
  irelia: 'irelia', yone: 'yone', lucian: 'lucian', vayne: 'vayne',
  evelynn: 'evelynn', gragas: 'gragas', nami: 'nami', lulu: 'lulu',
  pantheon: 'pantheon', galio: 'galio',
  'jarvan-iv': 'jarvan-iv'
};

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

function plainText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function grab(re, text) {
  const m = re.exec(text);
  return m ? m[1].replace(/^[\s:,]+|[\s:,]+$/g, '').trim() : '';
}

async function crawlChampion(id, slug) {
  const url = 'https://zathong.com/' + slug + '-wild-rift-build/';
  const text = plainText(await fetch(url));
  const tier = grab(/Tier:\s*(\S+)/, text);
  const items = grab(/Best items for[^:]+?are:\s*([^.]{5,260})\./, text);
  const spells = grab(/Best spells for[^:]+?are:\s*([^.]{5,120})\./, text);
  const runes = grab(/Best runes for[^:]+?are:\s*([^.]{5,260})\./, text);
  const skillOrder =
    grab(/Best skill order for[^:]+?is:\s*([^.]{5,160})\./, text) ||
    grab(/skill order for[^:]+?is:\s*([^.]{5,160})\./, text);
  return {
    championId: id,
    tier: tier || '',
    items: items.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6),
    spells: spells.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    runes: runes || '',
    skillOrder: skillOrder || '',
    crawledAt: new Date().toISOString().slice(0, 10),
    sourceUrl: url,
    sourceName: 'Zathong'
  };
}

async function main() {
  const results = [];
  const entries = Object.entries(SLUGS);
  for (let i = 0; i < entries.length; i++) {
    const [id, slug] = entries[i];
    try {
      const r = await crawlChampion(id, slug);
      if (r.items.length > 0 || r.tier) {
        results.push(r);
        console.log('[' + (i + 1) + '/' + entries.length + ']', id, 'tier=' + r.tier, 'items=' + r.items.length);
      } else {
        console.log('[' + (i + 1) + '/' + entries.length + ']', id, 'EMPTY');
      }
    } catch (e) {
      console.warn('[' + (i + 1) + '/' + entries.length + ']', id, 'failed:', e.message);
    }
    // 礼貌间隔，避免被限流
    await new Promise((r) => setTimeout(r, 400));
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2), 'utf8');
  console.log('champion_builds.json written:', results.length, 'champions');
}

main().catch((e) => {
  console.error('crawl_builds failed:', e);
  process.exit(1);
});
