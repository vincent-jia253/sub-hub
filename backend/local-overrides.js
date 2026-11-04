/**
 * 本地私有覆盖项（不随仓库分发）
 *
 * 用于存放「不适合写进公开代码/公开规则仓库」的个人配置，例如：
 *   data/auto-select-exclude.json  -> ["某个节点名", "另一个节点名"]
 *
 * 这些节点会被排除在 url-test（自动选择/香港自动/日本自动...）这类分组之外，
 * 具体做法是在生成订阅时，把它们注入到分组的 filter 负向断言里，
 * 这样公开的规则仓库里就不需要出现任何节点名/机场名。
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const EXCLUDE_FILE = path.join(DATA_DIR, 'auto-select-exclude.json');

let cache = { mtimeMs: -1, list: [] };

/**
 * 读取本地排除名单（带 mtime 缓存，文件改了就自动生效，不用重启）
 */
function getAutoSelectExclude() {
  try {
    const st = fs.statSync(EXCLUDE_FILE);
    if (st.mtimeMs !== cache.mtimeMs) {
      const raw = fs.readFileSync(EXCLUDE_FILE, 'utf8');
      const arr = JSON.parse(raw);
      const list = Array.isArray(arr) ? arr.map(String).map(s => s.trim()).filter(Boolean) : [];
      cache = { mtimeMs: st.mtimeMs, list };
    }
  } catch (e) {
    cache = { mtimeMs: -1, list: [] };
  }
  return cache.list;
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把本地排除名单注入到分组的 filter 里。
 * 只处理形如 `^((?!(DIRECT|xxx)).)*$` 这种「负向断言」过滤器，
 * 命中就追加到同一个断言组内；不命中就跳过，绝不改动过滤语义。
 */
function applyAutoSelectExclude(groups) {
  const list = getAutoSelectExclude();
  if (!Array.isArray(groups) || groups.length === 0 || list.length === 0) return groups;

  const addition = list.map(escapeRegExp).join('|');

  // 返回新数组（浅拷贝组对象），避免改到被缓存的远程配置
  return groups.map(group => {
    if (!group || typeof group !== 'object') return group;
    if (typeof group.filter !== 'string' || group.filter === '') return group;

    const m = group.filter.match(/\(\?!\(([^)]*)\)/);
    if (!m) return group;

    const current = m[1];
    if (list.every(name => current.indexOf(escapeRegExp(name)) !== -1)) return group;

    return {
      ...group,
      filter: group.filter.replace(m[0], `(?!(${current}|${addition})`)
    };
  });
}

module.exports = { getAutoSelectExclude, applyAutoSelectExclude };
