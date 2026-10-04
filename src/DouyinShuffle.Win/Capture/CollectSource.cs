namespace DouyinShuffle.Win.Capture;

/// <summary>
/// 采集数据源:v1.0.8 新增收藏域(listcollection 接口),与既有喜欢域(favorite 接口)平行。
/// 设计原则:Like 为默认值 —— 所有既有调用点不传源时行为与升级前完全一致(零回归);
/// Collection 走独立的注入脚本/探针/本地文件(collection.dylist)/断点游标,互不污染。
/// </summary>
public enum CollectSource
{
    /// <summary>喜欢列表(点赞过的视频;favorite 接口;items.dylist)。</summary>
    Like = 0,

    /// <summary>收藏列表(收藏的视频;listcollection 接口;collection.dylist)。</summary>
    Collection = 1
}

/// <summary>CollectSource 工具:前端协议字符串 ↔ 枚举(容错:未知值一律回落 Like,旧前端/旧参数零影响)。</summary>
public static class CollectSourceExt
{
    public const string LikeName = "like";
    public const string CollectionName = "collection";

    /// <summary>解析前端传参(不区分大小写);null/空/未知 → Like。</summary>
    public static CollectSource Parse(string? name)
        => string.Equals(name, CollectionName, StringComparison.OrdinalIgnoreCase)
            ? CollectSource.Collection
            : CollectSource.Like;

    /// <summary>转前端协议字符串(小写,进日志/命令参数)。</summary>
    public static string Name(this CollectSource src)
        => src == CollectSource.Collection ? CollectionName : LikeName;
}
