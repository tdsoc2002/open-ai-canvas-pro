import { App, Button, Card, Space, Tag } from "antd";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getAdminAigcQuotas, refreshAdminAigcQuotas, type AdminChannelAigcQuota } from "@/services/api/auth";
import { EmptyState } from "@/components/ui/product/empty-state";

const labels: Record<string, string> = { Image: "生图", Video: "生视频", Text: "生文" };

export function AigcQuotaPanel() {
    const { message } = App.useApp();
    const [items, setItems] = useState<AdminChannelAigcQuota[]>([]);
    const [loading, setLoading] = useState(false);
    const load = useCallback(async () => {
        try {
            setItems((await getAdminAigcQuotas()).items);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取 VOD 额度失败");
        }
    }, [message]);
    useEffect(() => {
        void load();
    }, [load]);
    const refresh = async () => {
        setLoading(true);
        try {
            setItems((await refreshAdminAigcQuotas()).items);
            message.success("VOD 额度已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "刷新 VOD 额度失败");
        } finally {
            setLoading(false);
        }
    };
    return (
        <section className="mb-5" aria-label="VOD 额度">
            <div className="mb-3 flex items-center justify-between">
                <div>
                    <h2 className="text-base font-semibold">VOD 渠道额度</h2>
                    <p className="mt-1 text-xs text-foreground/45">每日凌晨 3 点自动同步，也可手动刷新全部渠道</p>
                </div>
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void refresh()}>
                    刷新全部
                </Button>
            </div>
            {items.length === 0 ? (
                <Card>
                    <EmptyState description="暂无已配置的腾讯云 VOD 渠道" />
                </Card>
            ) : (
                <div className="grid gap-3 md:grid-cols-2">
                    {items.map((item) => (
                        <Card
                            key={item.channelId}
                            title={item.channelName}
                            extra={<Tag color={item.status === "ok" ? "green" : item.status === "error" ? "red" : "default"}>{item.status === "ok" ? "正常" : item.status === "error" ? "查询失败" : "未同步"}</Tag>}
                        >
                            {(item.quotas ?? []).length ? (
                                <Space direction="vertical" className="w-full">
                                    {(item.quotas ?? []).map((quota) => (
                                        <div key={quota.quotaType} className="flex items-center justify-between">
                                            <span>{labels[quota.quotaType] || quota.quotaType}</span>
                                            <strong>
                                                {quota.remaining.toLocaleString()} / {quota.quotaLimit.toLocaleString()} {quota.unit}
                                            </strong>
                                        </div>
                                    ))}
                                </Space>
                            ) : (
                                <div className="text-sm text-foreground/50">{item.errorMessage || "尚未同步额度"}</div>
                            )}
                            {item.updatedAt ? <div className="mt-3 text-xs text-foreground/40">更新于 {new Date(item.updatedAt).toLocaleString()}</div> : null}
                        </Card>
                    ))}
                </div>
            )}
        </section>
    );
}
