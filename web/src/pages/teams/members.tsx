import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Input, Popconfirm, Table } from "antd";
import { Mail, UserPlus, UserRound, Users } from "lucide-react";
import { useNavigate, useOutletContext } from "react-router";
import { PageHeader } from "@/components/layout/workspace-page";
import { StatusBadge } from "@/components/ui/base/badges";
import { AppModal } from "@/components/ui/product/app-modal";
import { teamKeys } from "@/lib/team-query-keys";
import { inviteTeamUser, leaveTeam, listTeamInvitations, listTeamMembers, removeTeamMember, revokeTeamInvitation, searchTeamInviteCandidates, type TeamSummary } from "@/services/api/teams";
import { useUserStore } from "@/stores/use-user-store";
import { TeamManagementPage, TeamTableSection, TeamTableTabs } from "./team-management-page";

const invitationStatuses = {
    pending: { label: "等待接受", tone: "warning" },
    accepted: { label: "已接受", tone: "success" },
    rejected: { label: "已拒绝", tone: "error" },
    revoked: { label: "已撤回", tone: "neutral" },
    expired: { label: "已过期", tone: "neutral" },
} as const;

const tablePagination = { className: "px-4", pageSize: 10, hideOnSinglePage: true, showSizeChanger: false };

export function TeamMembersPane() {
    const team = useOutletContext<TeamSummary>();
    const userId = useUserStore((state) => state.user?.id) || "";
    const owner = team.role === "owner";
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const { message } = App.useApp();
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [query, setQuery] = useState("");
    useEffect(() => {
        const timer = setTimeout(() => setQuery(search.trim()), 250);
        return () => clearTimeout(timer);
    }, [search]);
    const prefix = teamKeys.space(userId, team.id);
    const members = useQuery({ queryKey: [...prefix, "members"], queryFn: ({ signal }) => listTeamMembers(team.id, signal) });
    const invitations = useQuery({ queryKey: [...prefix, "invitations"], queryFn: ({ signal }) => listTeamInvitations(team.id, signal), enabled: owner });
    const candidates = useQuery({ queryKey: [...prefix, "candidates", query], queryFn: ({ signal }) => searchTeamInviteCandidates(team.id, query, signal), enabled: owner && open && Boolean(query) });
    const action = useMutation({
        mutationFn: async (input: { kind: "invite" | "revoke" | "remove" | "leave"; id?: string }) => {
            if (input.kind === "invite") return inviteTeamUser(team.id, input.id!);
            if (input.kind === "revoke") return revokeTeamInvitation(team.id, input.id!);
            if (input.kind === "remove") return removeTeamMember(team.id, input.id!);
            return leaveTeam(team.id);
        },
        onSuccess: async (_, input) => {
            if (input.kind === "leave") {
                queryClient.removeQueries({ queryKey: prefix });
                navigate("/teams");
            }
            await queryClient.invalidateQueries({ queryKey: teamKeys.all(userId) });
            message.success(input.kind === "invite" ? "邀请已发送" : "操作成功");
        },
        onError: (error) => message.error(error.message),
    });
    const membersTable = (
        <TeamTableSection title={owner ? undefined : "团队成员"} className="grow" emptyState={members.isSuccess && members.data.length === 0 ? { icon: Users, title: "暂无成员" } : undefined}>
            {members.isError ? <Alert className="mx-5 my-4" type="error" title="成员读取失败" description={members.error.message} action={<Button onClick={() => void members.refetch()}>重试</Button>} /> : null}
            <Table
                size="middle"
                rowKey="id"
                loading={members.isPending}
                dataSource={members.data}
                pagination={tablePagination}
                scroll={{ x: 400 }}
                locale={{ emptyText: null }}
                columns={[
                    {
                        title: "成员",
                        key: "name",
                        render: (_, member) => (
                            <div className="flex items-center gap-3">
                                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                                    <UserRound aria-hidden className="size-4" />
                                </span>
                                <div className="min-w-0 wrap-anywhere">
                                    <div className="font-medium">{member.displayName || member.username}</div>
                                    <div className="text-xs text-muted-foreground">@{member.username}</div>
                                </div>
                            </div>
                        ),
                    },
                    { title: "角色", dataIndex: "role", width: 112, render: (role) => <StatusBadge variant="filled" label={role === "owner" ? "所有者" : "成员"} /> },
                    {
                        title: "操作",
                        key: "actions",
                        align: "right",
                        width: 104,
                        render: (_, member) =>
                            owner && member.role !== "owner" ? (
                                <Popconfirm
                                    title={`移除 ${member.displayName || member.username}？`}
                                    description={team.parentId ? "可用额度退回小组，已有小组素材保留。" : "同时移出该公司下的所有小组，每个空间分别回收该成员的可用额度。"}
                                    onConfirm={() => action.mutateAsync({ kind: "remove", id: member.id })}
                                >
                                    <Button danger size="small" disabled={action.isPending}>
                                        移除
                                    </Button>
                                </Popconfirm>
                            ) : (
                                <span className="text-foreground/40">—</span>
                            ),
                    },
                ]}
            />
        </TeamTableSection>
    );
    const invitationsTable = (
        <TeamTableSection emptyState={invitations.isSuccess && invitations.data.length === 0 ? { icon: Mail, title: "暂无邀请记录" } : undefined}>
            {invitations.isError ? <Alert className="mx-5 my-4" type="error" title={invitations.error.message} /> : null}
            <Table
                size="middle"
                rowKey="id"
                loading={invitations.isPending}
                dataSource={invitations.data}
                pagination={tablePagination}
                scroll={{ x: 520 }}
                locale={{ emptyText: null }}
                columns={[
                    { title: "被邀请人", dataIndex: "inviteeName" },
                    { title: "状态", dataIndex: "status", width: 112, render: (status: keyof typeof invitationStatuses) => <StatusBadge {...invitationStatuses[status]} /> },
                    { title: "有效期", dataIndex: "expiresAt", width: 168, className: "tabular-nums", render: (value: string) => new Date(value).toLocaleString() },
                    {
                        title: "操作",
                        key: "actions",
                        align: "right",
                        width: 104,
                        render: (_, invitation) =>
                            invitation.status === "pending" ? (
                                <Button size="small" disabled={action.isPending} onClick={() => action.mutate({ kind: "revoke", id: invitation.id })}>
                                    撤回
                                </Button>
                            ) : null,
                    },
                ]}
            />
        </TeamTableSection>
    );
    return (
        <TeamManagementPage fill>
            <PageHeader
                title="成员与邀请"
                description="成员共享团队内容，个人账号与个人积分保持独立。"
                actions={
                    owner ? (
                        <Button type="primary" icon={<UserPlus aria-hidden />} onClick={() => setOpen(true)}>
                            邀请成员
                        </Button>
                    ) : (
                        <Popconfirm title="退出当前空间？" description={team.parentId ? "小组会收回你的可用额度，你仍是公司成员。" : "同时退出该公司下的所有小组，各空间分别收回你的可用额度。"} onConfirm={() => action.mutateAsync({ kind: "leave" })}>
                            <Button danger loading={action.isPending}>
                                退出团队
                            </Button>
                        </Popconfirm>
                    )
                }
            />
            {owner ? (
                <TeamTableTabs
                    items={[
                        { key: "members", label: "团队成员", children: membersTable },
                        { key: "invitations", label: "邀请记录", children: invitationsTable },
                    ]}
                />
            ) : (
                membersTable
            )}
            <AppModal centered title={team.parentId ? "邀请公司成员加入小组" : "邀请平台用户"} open={open} onCancel={() => setOpen(false)} footer={null}>
                <div className="space-y-4">
                    <Input.Search value={search} onChange={(event) => setSearch(event.target.value)} placeholder="输入账号或名称" aria-label="查找平台用户" />
                    <p className="text-xs text-foreground/60">{team.parentId ? `可邀请已加入「${team.parentName}」的成员。` : "对方接受后才会加入团队。"}同名用户请核对账号。</p>
                    {candidates.isError ? <Alert type="error" title={candidates.error.message} /> : null}
                    {query && candidates.isFetching ? <p role="status">正在搜索…</p> : null}
                    {query && candidates.data?.length === 0 ? <p>未找到可匹配的用户</p> : null}
                    {candidates.data?.map((candidate) => (
                        <div key={candidate.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                            <div>
                                <strong>{candidate.displayName || candidate.username}</strong>
                                <p className="text-xs text-foreground/60">@{candidate.username}</p>
                            </div>
                            <Button size="small" disabled={candidate.status !== "available" || action.isPending} onClick={() => action.mutate({ kind: "invite", id: candidate.id })}>
                                {candidate.status === "member" ? "已加入" : candidate.status === "pending" ? "待接受" : "邀请"}
                            </Button>
                        </div>
                    ))}
                </div>
            </AppModal>
        </TeamManagementPage>
    );
}
