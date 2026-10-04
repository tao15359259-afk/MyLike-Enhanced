// profile 统计探测:裸 fetch 自己的主页资料,回传"喜欢/收藏"显示计数(主页可见的累计数字)。
// 用途:与深度探测外推的可采条数对比 → 差值 = 已删除/私密/下架的量(绝对值+比例口径)。
// 注意:本文件注释中不得出现带花括号的占位符原文(Replace 误替换 → 语法错误静默死亡,历史事故)。
// 回传消息:stats_resp { id, result: ok|blocked|notready, favoritingCount, followingCount... }
(function () {
  var ID = '{{ID}}';
  function post(d) {
    try { window.chrome.webview.postMessage(d); } catch (e) {}
  }
  var p = new URLSearchParams();
  p.set('device_platform', 'webapp');
  p.set('aid', '6383');
  p.set('channel', 'channel_pc_web');
  p.set('pc_client_type', '1');
  p.set('version_code', '290100');
  p.set('version_name', '29.1.0');
  p.set('update_version_code', '170400');
  p.set('cookie_enabled', 'true');
  p.set('platform', 'PC');
  var u = 'https://www.douyin.com/aweme/v1/web/user/profile/self/?' + p.toString();
  try {
    var m = document.cookie.match(/(?:^|;\s*)msToken=([^;]+)/);
    if (m && m[1]) u += '&msToken=' + encodeURIComponent(m[1]);
  } catch (e) {}
  var timeout = new Promise(function (res, rej) { setTimeout(function () { rej(new Error('timeout6s')); }, 6000); });
  Promise.race([
    fetch(u, { method: 'GET', credentials: 'include', headers: { 'accept': 'application/json, text/plain, */*' } })
      .then(function (r) { return r.text(); }),
    timeout
  ]).then(function (text) {
    var c = window.__dsh_classify(text);
    if (c.kind === 'verify') { post({ type: 'stats_resp', id: ID, result: 'blocked' }); return; }
    if (c.kind === 'json' && c.data && c.data.user) {
      var u2 = c.data.user;
      post({
        type: 'stats_resp', id: ID, result: 'ok',
        favoritingCount: u2.favoriting_count || 0,   // 喜欢数(主页显示口径,历史累计)
        collectCount: u2.collect_count !== undefined ? u2.collect_count : -1,   // 收藏数(字段存在与否以接口为准)
        awemeCount: u2.aweme_count || 0
      });
      return;
    }
    post({ type: 'stats_resp', id: ID, result: 'notready' });
  }).catch(function () {
    post({ type: 'stats_resp', id: ID, result: 'notready' });
  });
})();
