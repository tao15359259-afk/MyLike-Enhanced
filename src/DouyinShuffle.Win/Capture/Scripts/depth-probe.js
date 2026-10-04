// 深度探测脚本:参数化游标与页大小的最小开销请求,用于时间跳跃/二分定位接口可达边界 + 密度采样。
// 与翻页脚本同款原则:裸 fetch 由页面签名层自动补签名,不伪造指纹,6 秒挂起保护。
// 双源:like(favorite,GET,max_cursor=时间戳秒) / collection(listcollection,POST,游标在表单体)。
// 宿主模板替换 5 个占位符(请求标识/源/目标用户/探测游标值/页大小),注释中不得出现带花括号的占位符原文。
// 回传消息:depth_resp { id, result: ok|empty|blocked|notready|code:N, firstTime, nextCursor, hasMore }
//   ok 时 firstTime=列表首条的 create_time(秒),nextCursor=响应游标(字符串),hasMore=是否还有更多。
(function () {
  var ID = '{{ID}}';
  var SRC = '{{SRC}}';
  var SEC = '{{SEC_USER_ID}}';
  var CURSOR_VALUE = '{{CURSOR_VALUE}}';   // like=时间戳秒(字符串);collection=原样透传的游标字符串
  function post(d) {
    try { window.chrome.webview.postMessage(d); } catch (e) {}
  }
  var timeout = new Promise(function (res, rej) { setTimeout(function () { rej(new Error('timeout6s')); }, 6000); });

  function sendLike() {
    var p = new URLSearchParams();
    p.set('device_platform', 'webapp');
    p.set('aid', '6383');
    p.set('channel', 'channel_pc_web');
    p.set('sec_user_id', SEC);
    p.set('max_cursor', CURSOR_VALUE);
    p.set('min_cursor', '0');
    p.set('count', '{{COUNT}}');
    p.set('publish_video_strategy_type', '2');
    p.set('pc_client_type', '1');
    p.set('version_code', '290100');
    p.set('version_name', '29.1.0');
    p.set('update_version_code', '170400');
    p.set('cookie_enabled', 'true');
    p.set('platform', 'PC');
    var u = 'https://www.douyin.com/aweme/v1/web/aweme/favorite/?' + p.toString();
    try {
      var m = document.cookie.match(/(?:^|;\s*)msToken=([^;]+)/);
      if (m && m[1]) u += '&msToken=' + encodeURIComponent(m[1]);
    } catch (e) {}
    return fetch(u, { method: 'GET', credentials: 'include', headers: { 'accept': 'application/json, text/plain, */*' } });
  }
  function sendCollection() {
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
    var u = 'https://www.douyin.com/aweme/v1/web/aweme/listcollection/?' + p.toString();
    try {
      var m = document.cookie.match(/(?:^|;\s*)msToken=([^;]+)/);
      if (m && m[1]) u += '&msToken=' + encodeURIComponent(m[1]);
    } catch (e) {}
    return fetch(u, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: 'cursor=' + encodeURIComponent(CURSOR_VALUE) + '&count={{COUNT}}'
    });
  }

  Promise.race([
    (SRC === 'collection' ? sendCollection() : sendLike())
      .then(function (r) { return r.text().then(function (t) { return { s: r.status, b: t }; }); }),
    timeout
  ]).then(function (res) {
    var c = window.__dsh_classify(res.b, res.s);
    if (c.kind === 'verify') { post({ type: 'depth_resp', id: ID, result: 'blocked' }); return; }
    if (c.kind === 'json') {
      if (c.data && c.data.status_code && c.data.status_code !== 0) {
        post({ type: 'depth_resp', id: ID, result: 'code:' + c.data.status_code }); return;
      }
      var list = c.list || [];
      if (list.length === 0) { post({ type: 'depth_resp', id: ID, result: 'empty', hasMore: !!c.hasMore }); return; }
      // 首条 create_time(秒):该深度确实有内容的实证;响应游标原样回传(字符串化)
      var first = list[0] || {};
      var next = c.data ? (c.data.cursor !== undefined && c.data.cursor !== null && c.data.cursor !== ''
        ? c.data.cursor : c.data.max_cursor) : '';
      post({
        type: 'depth_resp', id: ID, result: 'ok',
        firstTime: first.create_time || 0,
        nextCursor: next === undefined || next === null ? '' : String(next),
        hasMore: !!c.hasMore
      });
      return;
    }
    post({ type: 'depth_resp', id: ID, result: 'notready' });
  }).catch(function () {
    post({ type: 'depth_resp', id: ID, result: 'notready' });
  });
})();
