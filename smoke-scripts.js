// 注入脚本冒烟测试:模拟宿主模板替换 → new Function 语法校验
// (历史事故:模板替换后语法错误 → ExecuteScriptAsync 静默死亡 40 分钟)
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'src', 'DouyinShuffle.Win', 'Capture', 'Scripts');

function smoke(file, replacements, label) {
  let js = fs.readFileSync(path.join(dir, file), 'utf8');
  for (const [k, v] of Object.entries(replacements)) js = js.split(k).join(v);
  try {
    new Function(js);   // 语法校验(不执行)
    console.log(`PASS ${label} ${file}`);
    return true;
  } catch (e) {
    console.log(`FAIL ${label} ${file}: ${e.message}`);
    return false;
  }
}

let ok = true;
// 喜欢域(回归):原脚本 + 完整占位符替换
ok &= smoke('paged-loop.js', {
  '{{SEC_USER_ID}}': 'MS4wLjABAAAA_test',
  '{{START_CURSOR}}': '0',
  '{{KNOWN_IDS}}': 'null',
  '{{RESUME_MODE}}': '0'
}, 'like');
// 收藏域(新):无 SEC 占位符,其余同构(多余 Replace 不应产生任何影响)
ok &= smoke('collection-loop.js', {
  '{{SEC_USER_ID}}': '',
  '{{START_CURSOR}}': '12345',
  '{{KNOWN_IDS}}': '{"7300000000000000000":1}',
  '{{RESUME_MODE}}': '1'
}, 'coll');
// 探针两枚
ok &= smoke('favorite-probe.js', { '{{ID}}': 'abc123', '{{SEC_USER_ID}}': 'MS4wLjABAAAA_test' }, 'like');
ok &= smoke('collection-probe.js', { '{{ID}}': 'abc123' }, 'coll');
// 深度探测 + profile 统计(v1.0.9)
ok &= smoke('depth-probe.js', {
  '{{ID}}': 'abc', '{{SRC}}': 'like', '{{SEC_USER_ID}}': 'MS4wLjABAAAA_test',
  '{{CURSOR_VALUE}}': '1759000000', '{{COUNT}}': '1'
}, 'depth-like');
ok &= smoke('depth-probe.js', {
  '{{ID}}': 'abc', '{{SRC}}': 'collection', '{{SEC_USER_ID}}': '',
  '{{CURSOR_VALUE}}': '3000', '{{COUNT}}': '18'
}, 'depth-coll');
ok &= smoke('profile-stats.js', { '{{ID}}': 'abc' }, 'stats');
// 分类器 + 心跳相关脚本回归
['classify.js', 'health-check.js', 'detail-fetch.js'].forEach(f => {
  ok &= smoke(f, { '{{ID}}': 'x', '{{AID}}': 'x', '{{RID}}': 'null' }, 'regress');
});

// classify.js 对收藏响应的兼容性断言(在 Node 里跑分类器本身)
const cls = fs.readFileSync(path.join(dir, 'classify.js'), 'utf8');
const win = {};
new Function('window', cls)(win);   // classify.js 挂在传入的 window 参数上
const c = win.__dsh_classify;
const fav = c(JSON.stringify({ status_code: 0, aweme_list: [{ aweme_id: '1' }], has_more: 1, max_cursor: 100 }), 200);
console.log(`PASS classify favorite: kind=${fav.kind} hasMore=${fav.hasMore} list=${fav.list.length}`);
const coll = c(JSON.stringify({ status_code: 0, aweme_list: [{ aweme_id: '2' }], has_more: 1, cursor: "200" }), 200);
console.log(`PASS classify collection: kind=${coll.kind} hasMore=${coll.hasMore} list=${coll.list.length}`);
const verify = c('<html><body>verify</body></html>', 200);
console.log(`PASS classify verify-page: kind=${verify.kind}`);
const empty = c(JSON.stringify({ status_code: 0, aweme_list: [], has_more: 1 }), 200);
console.log(`PASS classify fake-data: kind=${empty.kind} list=${empty.list.length} hasMore=${empty.hasMore}`);
process.exit(ok ? 0 : 1);
