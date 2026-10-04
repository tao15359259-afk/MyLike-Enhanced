// 收藏列表翻页脚本(与 paged-loop.js 同构的单一通道:直连裸 fetch,webmssdk 自动补签名)。
// 与喜欢(favorite)接口的差异:
// - 接口:listcollection(POST,游标与页大小在表单体里,query 只放结构性参数 + msToken);
// - 无需 sec_user_id(收藏是"自己的"数据,登录态即可);
// - 响应游标字段为 cursor(字符串,兼容读 max_cursor)。
// 宿主模板替换 3 个占位符(起始游标/已知 ID 表/硬续开关)。
// 注意:本文件注释中不得出现带花括号的占位符原文,否则会被 Replace 误替换导致语法错误(历史事故)。
// - 循环:buildUrl() → send() → 解析 cursor/has_more → 回传 body → 下一页
// - 终止(五重):has_more=false / 增量整页已知 / cursor 停滞(3次) / 安全页数上限(200) / 停止标志
// - 消息协议与喜欢域完全一致:direct_started / direct_resp / direct_progress / direct_fail / direct_done
//   reason ∈ complete/incremental/stalled/safety/stopped/blocked/notready
(function () {
  var CURSOR = String({{START_CURSOR}});
  // 模式开关(宿主显式传入):硬续模式禁用"整页已知→incremental"停 —— 硬续区都该是未采内容,
  // 出现整页已知只可能是接口卡页;停成增量会清断点、重演"卡在几千条再采无新增"。
  var IS_RESUME = '{{RESUME_MODE}}' === '1';
  var KNOWN = {{KNOWN_IDS}};   // 增量模式:已知 aweme_id 查找表(对象字面量,O(1) 命中判断)
  function post(d) {
    try { window.chrome.webview.postMessage(d); } catch (e) {}
  }
  // query 只放结构性参数(不伪造指纹:不传 webid/screen_*/browser_* 等可能与环境不一致的值,
  // 不传 msToken 之外的签名参数 —— 全部交给页面拦截器按真实环境现补)。
  function buildUrl() {
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
    // msToken 从 cookie 现取(没有就空着,拦截器会补)
    try {
      var m = document.cookie.match(/(?:^|;\s*)msToken=([^;]+)/);
      if (m && m[1]) u += '&msToken=' + encodeURIComponent(m[1]);
    } catch (e) {}
    return u;
  }
  // 裸 fetch POST:直接调 window.fetch 即当前最外层(webmssdk 包装层),
  // 拦截器自动补 a_bogus/X-Bogus/msToken;游标与页大小走表单体(Web 端收藏页同款形态)。
  function send(url) {
    var body = 'cursor=' + encodeURIComponent(CURSOR) + '&count=18';
    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: body
    }).then(function (r) { return r.text().then(function (t) { return { s: r.status, b: t }; }); });
  }
  window.__dsh_direct_stop__ = false;
  var fetched = 0, empty = 0, emptyDelay = 1200, totalItems = 0, emptyPages = 0;
  var lastCursor = '', lastFirst = '', stallCount = 0;
  var finished = false;
  function done(reason) {
    if (finished) return;
    finished = true;
    post({ type: 'direct_done', reason: reason, fetched: fetched, totalItems: totalItems });
  }
  // 同步心跳
  post({ type: 'direct_started', cursor: CURSOR });
  // 响应游标统一转字符串比较(收藏接口 cursor 为字符串,兼容 max_cursor 数值字段)。
  function nextCursorOf(data) {
    if (!data) return '';
    var c = data.cursor;
    if (c === undefined || c === null || c === '') c = data.max_cursor;
    if (c === undefined || c === null) return '';
    return String(c);
  }
  function step() {
    if (finished) return;
    if (window.__dsh_direct_stop__) { done('stopped'); return; }
    // 安全上限:200 页 ≈ 3600 条,防异常无限翻页(宿主分轮续采)
    if (fetched >= 200) { done('safety'); return; }
    var url = buildUrl();
    // 挂起保护:Promise.race 6 秒超时(黑洞时快速失败;正常接口响应 <2s,余量充足)
    var timeout = new Promise(function (res, rej) { setTimeout(function () { rej(new Error('timeout6s')); }, 6000); });
    Promise.race([send(url), timeout]).then(function (res) {
      var c = window.__dsh_classify(res.b, res.s);
      if (c.kind !== 'json' || !Array.isArray(c.list)) {
        // 非成功响应(验证页 / HTTP 或业务错误 / 结构异常)→ 空响应计数,统一分流
        empty++;
        post({ type: 'direct_fail', fetched: fetched, empty: empty, status: res.s, body: (res.b || '').slice(0, 150) });
        // 首页即不可用 → notready,让宿主分流(网络抖动重试 / 限流弹验证)
        if (fetched === 0 && empty >= 2) { done('notready'); return; }
        if (empty >= 3) { done('blocked'); return; }   // 连续 3 次空响应即判定风控(缩短黑洞空转)
        setTimeout(step, emptyDelay);
        emptyDelay = Math.min(8000, emptyDelay * 2);
        return;
      }
      // 合法 JSON:直接复用分类器解析结果(aweme_list/hasMore),游标按收藏接口字段取
      empty = 0;
      emptyDelay = 1200;
      var data = c.data;
      post({ type: 'direct_resp', url: url, status: res.s, body: res.b });
      fetched++;
      var pFirst = c.list && c.list[0] ? c.list[0].aweme_id : '';
      var pCount = c.list.length;
      totalItems += pCount;
      post({ type: 'direct_progress', fetched: fetched, cursor: CURSOR, first: pFirst, items: pCount, totalItems: totalItems });
      var hasMore = c.hasMore;
      var next = nextCursorOf(data);
      var curFirst = pFirst;
      // 增量模式:整页全为已知 ID = 已到断点(收藏列表倒序,旧内容无需重翻)。
      // 单页混有新旧 → 继续,后续页会全旧而停。
      // ★硬续模式整轮禁用此判断:硬续起点指向上轮停滞/中断处,往更早翻的方向理论上都是
      //   未采内容 —— 若出现整页已知,只可能是接口重放停滞页(卡页),停成增量会清掉断点
      //   标志,重演"卡在几千条再采无新增"。正确做法:放它继续翻,由 stallCount 收口。
      if (KNOWN && !IS_RESUME && pCount > 0) {
        var knownHits = 0;
        try {
          for (var ki = 0; ki < c.list.length; ki++) {
            if (KNOWN[c.list[ki].aweme_id]) knownHits++;
          }
        } catch (e) {}
        if (knownHits === pCount) {
          post({ type: 'direct_progress', fetched: fetched, cursor: CURSOR, first: pFirst, items: 0, totalItems: totalItems });
          done('incremental');
          return;
        }
      }
      // 空数据页检测:接口返回 JSON 但列表为空且 has_more=true = 风控"假数据"响应。
      // 连续 3 页空说明被风控喂空列表,立即判定 blocked 交给宿主分流。
      if (pCount === 0 && hasMore) {
        emptyPages++;
        if (emptyPages >= 3) { done('blocked'); return; }
      } else {
        emptyPages = 0;
      }
      // 游标停滞判定:连续 3 次游标不前进 / 首条与上页相同 = 接口卡页(疑似限流喂假数据)。
      if (next !== '' && (next === lastCursor || (curFirst && curFirst === lastFirst))) {
        stallCount++;
        if (stallCount >= 3) { done('stalled'); return; }
      } else {
        stallCount = 0;
      }
      lastCursor = next;
      lastFirst = curFirst;
      // 完成判定只用真信号:has_more=false,或接口不再给游标。
      // ★游标原地不动不判完成 —— 那是"卡页被当成采完"的来源(会清断点,重演"再采永远无新增")。
      if (!hasMore || !next) { done('complete'); return; }
      if (next === CURSOR) {
        setTimeout(step, 400 + Math.random() * 400);
        return;
      }
      CURSOR = next;
      setTimeout(step, 200 + Math.random() * 300);   // 拟人间隔
    }).catch(function (e) {
      empty++;
      post({ type: 'direct_fail', fetched: fetched, empty: empty, status: 0, body: 'err:' + String(e && e.message || e) });
      if (fetched === 0 && empty >= 2) { done('notready'); return; }
      if (empty >= 3) { done('blocked'); return; }
      setTimeout(step, emptyDelay);
      emptyDelay = Math.min(8000, emptyDelay * 2);
    });
  }
  step();
})();
