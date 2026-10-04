using Microsoft.Web.WebView2.Core;
using Newtonsoft.Json.Linq;

namespace DouyinShuffle.Win.Capture;

/// <summary>
/// 深度探测报告(先探测再加载的产出物):
/// - DisplayCount:主页显示的累计计数(favoriting_count;收藏字段存在与否以接口为准,-1=未知)
/// - EarliestValue:最早可达游标(like=时间戳秒;collection=offset 字符串原样);"" = 未探测到边界
/// - DepthLimited:是否探测到边界(翻到某深度就空)—— false = 探测范围内全可达
/// - EstTotal:密度外推/游标直读的粗估可采条数(-1=无法估算)
/// - SegmentStarts:建议分段采集的跳坑起点(从新到旧排列;仅 EstTotal 超过单段容量时生成)
/// </summary>
public sealed class DepthReport
{
    public CollectSource Source { get; set; }
    public long DisplayCount { get; set; } = -1;
    public string EarliestValue { get; set; } = "";
    public bool DepthLimited { get; set; }
    public long EstTotal { get; set; } = -1;
    public List<long> SegmentStarts { get; } = new();
    public int ProbeRequests { get; set; }
    public string Note { get; set; } = "";

    public string Summarize()
    {
        var span = Source == CollectSource.Collection ? "offset" : EarliestValue.Length > 0 ? EarliestValue : "?";
        return $"src={Source.Name()} display={DisplayCount} earliest={span} depthLimited={DepthLimited} " +
               $"estTotal={EstTotal} segments={SegmentStarts.Count} reqs={ProbeRequests} note={Note}";
    }
}

/// <summary>
/// 深度探测服务(v1.0.9,「先探测再加载」):用 10-20 条最小开销请求摸清接口可达边界,
/// 把"盲翻 1 万条才发现罢工"变成"采集前先知道能翻多深、粗估能采多少、要不要分段"。
///
/// - like 域:max_cursor 是时间戳 → 从 now 往回倍增步长(7/14/28...天)试探,空响应处二分收口,
///   定位最早可达时间点;三点密度采样外推总条数。
/// - collection 域:cursor 语义未知 → 数字阶梯(offset 假设)试探;若成立,最大可达 offset 即粗估条数;
///   若游标非数字型(全阶梯空/异常),降级为"仅首页可用性",分段计划不可用(如实标注)。
///
/// 节奏:每步间隔 ~800ms+随机(拟人);探测失败绝不阻塞采集(编排器 catch 后按老流程盲翻)。
/// </summary>
internal sealed class DepthProbeService
{
    /// <summary>单段容量(条):实测 1 万左右会卡页,取 3000 留安全边际。</summary>
    public const int SegmentSize = 3000;

    /// <summary>like 域时间跳跃阶梯(天,倍增;约 9.8 年封顶)。</summary>
    private static readonly int[] LikeStepDays = { 7, 14, 28, 56, 112, 224, 448, 896, 1792, 3584 };

    /// <summary>collection 域数字游标阶梯(offset 假设;12.8 万封顶)。</summary>
    private static readonly long[] CollCursorSteps = { 0, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000 };

    private readonly CoreWebView2 _webView;
    private readonly Random _rnd = Random.Shared;

    public DepthProbeService(CoreWebView2 webView) => _webView = webView;

    // ---------- 单次探测请求(与 favorite-probe 同款消息通道:注入 → postMessage → TCS) ----------

    private async Task<(string result, long firstTime, string nextCursor, bool hasMore)> ProbeOnceAsync(
        CollectSource src, string secUserId, string cursorValue, int count, CancellationToken ct)
    {
        var id = Guid.NewGuid().ToString("N");
        var tcs = new TaskCompletionSource<(string, long, string, bool)>(TaskCreationOptions.RunContinuationsAsynchronously);
        void Handler(object? s, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var jo = JObject.Parse(e.WebMessageAsJson);
                if (jo?["type"]?.Value<string>() != "depth_resp" || jo["id"]?.Value<string>() != id) return;
                tcs.TrySetResult((
                    jo["result"]?.Value<string>() ?? "notready",
                    jo["firstTime"]?.Value<long>() ?? 0,
                    jo["nextCursor"]?.Value<string>() ?? "",
                    jo["hasMore"]?.Value<bool>() ?? false));
            }
            catch { }
        }
        _webView.WebMessageReceived += Handler;
        try
        {
            var js = ScriptLoader.Get("depth-probe.js")
                .Replace("{{ID}}", id)
                .Replace("{{SRC}}", src.Name())
                .Replace("{{SEC_USER_ID}}", src == CollectSource.Like ? secUserId : "")
                .Replace("{{CURSOR_VALUE}}", cursorValue)
                .Replace("{{COUNT}}", count.ToString());
            await _webView.ExecuteScriptAsync(js);
            var v = await tcs.Task.WaitAsync(TimeSpan.FromSeconds(9), ct);   // JS 6s 超时 + 余量
            return v;
        }
        finally { _webView.WebMessageReceived -= Handler; }
    }

    private async Task<(string result, long favoriting, long collect)> ProbeStatsAsync(CancellationToken ct)
    {
        var id = Guid.NewGuid().ToString("N");
        var tcs = new TaskCompletionSource<(string, long, long)>(TaskCreationOptions.RunContinuationsAsynchronously);
        void Handler(object? s, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var jo = JObject.Parse(e.WebMessageAsJson);
                if (jo?["type"]?.Value<string>() != "stats_resp" || jo["id"]?.Value<string>() != id) return;
                tcs.TrySetResult((
                    jo["result"]?.Value<string>() ?? "notready",
                    jo["favoritingCount"]?.Value<long>() ?? 0,
                    jo["collectCount"]?.Value<long>() ?? -1));
            }
            catch { }
        }
        _webView.WebMessageReceived += Handler;
        try
        {
            var js = ScriptLoader.Get("profile-stats.js").Replace("{{ID}}", id);
            await _webView.ExecuteScriptAsync(js);
            return await tcs.Task.WaitAsync(TimeSpan.FromSeconds(9), ct);
        }
        finally { _webView.WebMessageReceived -= Handler; }
    }

    private Task HumanDelay(CancellationToken ct)
        => Task.Delay(800 + _rnd.Next(0, 400), ct);

    // ---------- profile 显示数 ----------

    /// <summary>拿主页显示计数(历史累计口径,含已删除)。失败返回 -1(不阻塞)。</summary>
    public async Task<(long likeDisplay, long collDisplay)> GetDisplayCountsAsync(CancellationToken ct)
    {
        try
        {
            var (result, fav, coll) = await ProbeStatsAsync(ct);
            if (result != "ok") return (-1, -1);
            return (fav, coll);
        }
        catch { return (-1, -1); }
    }

    // ---------- 主探测流程 ----------

    public async Task<DepthReport> ProbeAsync(CollectSource src, string secUid, CancellationToken ct, Action<string>? progress = null)
    {
        var report = new DepthReport { Source = src };
        var notify = (string m) => { progress?.Invoke(m); AppLog.Write("DEPTH " + m); };

        try
        {
            if (src == CollectSource.Like)
                await ProbeLikeAsync(report, secUid, ct, notify);
            else
                await ProbeCollectionAsync(report, secUid, ct, notify);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            report.Note = "probe error: " + ex.Message;
            notify("探测中断(" + ex.Message + "),按常规流程采集");
        }
        return report;
    }

    /// <summary>like 域:时间戳倍增跳跃 + 二分收口 + 三点密度外推。</summary>
    private async Task ProbeLikeAsync(DepthReport report, string secUserId, CancellationToken ct, Action<string> notify)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        long reachHi = now;          // 最新可达点(时间戳,大=新)
        long? reachLo = null;        // 最深可达点(第一个仍可达的旧端)
        long? unreachable = null;    // 第一个不可达点(旧端)

        // 1) 倍增跳跃
        foreach (var days in LikeStepDays)
        {
            ct.ThrowIfCancellationRequested();
            var ts = now - days * 86400L;
            notify($"正在探测可采范围…({days} 天前)");
            var (r, _, _, _) = await ProbeOnceAsync(CollectSource.Like, secUserId, ts.ToString(), 1, ct);
            report.ProbeRequests++;
            await HumanDelay(ct);
            if (r == "ok") { reachLo = ts; continue; }
            if (r is "empty" or "code:0") { unreachable = ts; break; }   // 空列表 = 边界(或该时段无内容)
            // blocked/notready:接口抖动,不急着判边界,放宽一步再试一次
            await Task.Delay(2000, ct);
            var (r2, _, _, _) = await ProbeOnceAsync(CollectSource.Like, secUserId, ts.ToString(), 1, ct);
            report.ProbeRequests++;
            if (r2 == "ok") { reachLo = ts; continue; }
            unreachable = ts;
            break;
        }

        if (unreachable == null)
        {
            // 探测范围(约 9.8 年)内全可达 → 未触边
            report.DepthLimited = false;
            report.EarliestValue = (now - LikeStepDays[^1] * 86400L).ToString();
            report.Note = "no boundary within range";
        }
        else if (reachLo == null)
        {
            // 第一步就不可达:近期即空(账号喜欢极少或接口异常)——如实报告,不外推
            report.DepthLimited = true;
            report.EarliestValue = "";
            report.Note = "empty near head";
            return;
        }
        else
        {
            // 2) 二分收口(6 轮,精度 ≈ 天级)
            var lo = reachLo.Value;            // 可达
            var hi = unreachable.Value;        // 不可达
            for (var i = 0; i < 6 && hi - lo > 3600; i++)
            {
                ct.ThrowIfCancellationRequested();
                var mid = (lo + hi) / 2;
                notify($"正在定位可采边界…(二分 {i + 1}/6)");
                var (r, _, _, _) = await ProbeOnceAsync(CollectSource.Like, secUserId, mid.ToString(), 1, ct);
                report.ProbeRequests++;
                await HumanDelay(ct);
                if (r == "ok") lo = mid; else if (r == "empty" || r.StartsWith("code:")) hi = mid;
                else break;   // 抖动:停在当前精度
            }
            report.DepthLimited = true;
            report.EarliestValue = lo.ToString();
        }

        // 3) 三点密度采样(count=18)→ 外推总条数
        var earliest = report.EarliestValue.Length > 0 ? long.Parse(report.EarliestValue) : now - LikeStepDays[^1] * 86400L;
        var span = Math.Max(86400L, now - earliest);
        var densities = new List<double>();
        foreach (var frac in new[] { 0.25, 0.5, 0.75 })
        {
            ct.ThrowIfCancellationRequested();
            var ts = (long)(now - span * frac);
            notify($"正在估算可采数量…({(int)(frac * 100)}%)");
            var (r, firstTime, _, hasMore) = await ProbeOnceAsync(CollectSource.Like, secUserId, ts.ToString(), 18, ct);
            report.ProbeRequests++;
            await HumanDelay(ct);
            if (r != "ok" || firstTime == 0) continue;
            // 页内首尾时间差(firstTime 是最新一条;最旧一条拿不到 → 用"该页 count=18 的起止游标差"近似:
            // 页起点 ts 到 firstTime 的差代表 18 条覆盖的时间跨度(ts=页起点,firstTime=页内最新)
            var pageSpan = Math.Max(1.0, Math.Abs(firstTime - ts));
            densities.Add(18.0 / pageSpan);
        }
        if (densities.Count > 0)
        {
            densities.Sort();
            var d = densities[densities.Count / 2];   // 中位数密度(条/秒)
            report.EstTotal = (long)(d * span);
        }
        else report.EstTotal = -1;

        // 4) 分段计划(从新到旧的时间均分点;超出单段容量才生成)
        if (report.EstTotal > SegmentSize * 1.3)
        {
            var n = (int)Math.Ceiling((double)report.EstTotal / SegmentSize);
            for (var i = n - 1; i >= 1; i--)
                report.SegmentStarts.Add(earliest + span * i / n);
            report.Note += $" segments by density({n}×{SegmentSize})";
        }
        notify(report.DepthLimited
            ? $"探测完成:最早可翻到 {DateTimeOffset.FromUnixTimeSeconds(earliest):yyyy-MM-dd},预计可采约 {Fmt(report.EstTotal)} 条"
            : $"探测完成:探测范围内均可翻,预计可采约 {Fmt(report.EstTotal)} 条");
    }

    /// <summary>collection 域:数字游标阶梯试探(offset 假设);成立则最大可达 offset ≈ 可采条数。</summary>
    private async Task ProbeCollectionAsync(DepthReport report, string secUserId, CancellationToken ct, Action<string> notify)
    {
        long reachHi = -1;    // 最大可达 offset
        long? unreachable = null;

        foreach (var v in CollCursorSteps)
        {
            ct.ThrowIfCancellationRequested();
            notify(v == 0 ? "正在探测收藏接口…" : $"正在探测收藏可采范围…(offset {v})");
            var (r, firstTime, _, _) = await ProbeOnceAsync(CollectSource.Collection, secUserId, v.ToString(), 1, ct);
            report.ProbeRequests++;
            await HumanDelay(ct);
            if (r == "ok") { reachHi = v; continue; }
            if (r is "empty" or "code:0") { unreachable = v; break; }
            await Task.Delay(2000, ct);
            var (r2, _, _, _) = await ProbeOnceAsync(CollectSource.Collection, secUserId, v.ToString(), 1, ct);
            report.ProbeRequests++;
            if (r2 == "ok") { reachHi = v; continue; }
            unreachable = v;
            break;
        }

        if (reachHi < 0)
        {
            // 连 cursor=0 都不可达:游标非数字型(可能性高)或接口异常 → 降级,不生成段计划
            report.Note = "cursor semantics unknown (all steps failed); segmented plan disabled";
            report.EstTotal = -1;
            report.DepthLimited = false;
            return;
        }

        if (unreachable != null)
        {
            // 二分收口(4 轮,粗粒度)
            var lo = reachHi;
            var hi = unreachable.Value;
            for (var i = 0; i < 4 && hi - lo > 100; i++)
            {
                ct.ThrowIfCancellationRequested();
                var mid = (lo + hi) / 2;
                notify($"正在定位收藏可采边界…(二分 {i + 1}/4)");
                var (r, _, _, _) = await ProbeOnceAsync(CollectSource.Collection, secUserId, mid.ToString(), 1, ct);
                report.ProbeRequests++;
                await HumanDelay(ct);
                if (r == "ok") lo = mid; else if (r == "empty" || r.StartsWith("code:")) hi = mid;
                else break;
            }
            reachHi = lo;
            report.DepthLimited = true;
        }
        else report.DepthLimited = false;

        // offset 语义成立:最大可达 offset 就是粗估条数(直接读,无需密度外推)
        report.EarliestValue = reachHi.ToString();
        report.EstTotal = reachHi;

        if (report.EstTotal > SegmentSize * 1.3)
        {
            var n = (int)Math.Ceiling((double)report.EstTotal / SegmentSize);
            for (var i = n - 1; i >= 1; i--)
                report.SegmentStarts.Add(reachHi * i / n);
            report.Note += $" segments by offset({n}×{SegmentSize})";
        }
        notify(report.DepthLimited
            ? $"探测完成:收藏可翻到第 {Fmt(reachHi)} 条附近,预计可采约 {Fmt(report.EstTotal)} 条"
            : $"探测完成:offset {Fmt(CollCursorSteps[^1])} 内均可翻,预计可采超过 {Fmt(reachHi)} 条");
    }

    private static string Fmt(long v) => v < 0 ? "未知" : v.ToString("#,0");
}
