// 收藏接口探测脚本:裸 POST 收藏列表第一页(count=1 最小开销)→ 结果经 postMessage 回传。
// 与 favorite-probe.js 同构(喜欢域探针);用途:风控分接口场景 —— 要采什么就探什么,
// 收藏接口被限时其他接口健康检查仍 Ok,验证窗口的"验证通过"必须以收藏接口恢复为准。
// 注意:本文件注释中不得出现带花括号的占位符原文(Replace 误替换 → 语法错误静默死亡,历史事故)。
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
  var url = 'https://www.douyin.com/aweme/v1/web/aweme/listcollection/?' + p.toString();
  // 挂起保护:6 秒超时(黑洞时快速失败;正常响应 <2s)
  var timeout = new Promise(function (res, rej) { setTimeout(function () { rej(new Error('timeout6s')); }, 6000); });
  Promise.race([
    fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: 'cursor=0&count=1'
    }).then(function (resp) { return resp.text(); }),
    timeout
  ]).then(function (text) {
    var c = window.__dsh_classify(text);
    if (c.kind === 'verify') { post({ type: 'coll_resp', id: ID, result: 'blocked' }); return; }
    if (c.kind === 'json') {
      if (c.data && (c.data.aweme_list || c.data.status_code === 0)) { post({ type: 'coll_resp', id: ID, result: 'ok' }); return; }
      if (c.data && c.data.status_code && c.data.status_code !== 0) { post({ type: 'coll_resp', id: ID, result: 'code:' + c.data.status_code }); return; }
    }
    post({ type: 'coll_resp', id: ID, result: 'notready' });
  }).catch(function () {
    post({ type: 'coll_resp', id: ID, result: 'notready' });
  });
})();
