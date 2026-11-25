import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Input, Select } from "antd";
import { ArrowRight, Building2, Plus, UserPlus, Users } from "lucide-react";
import { Link, Outlet, useNavigate, useParams, useSearchParams } from "react-router";
import { PageHeader } from "@/components/layout/workspace-page";
import { openTeamInvitations } from "@/components/layout/team-invitation-center";
import { StatusBadge } from "@/components/ui/base/badges";
import { AppModal } from "@/components/ui/product/app-modal";
import { EmptyState } from "@/components/ui/product/empty-state";
import { teamKeys } from "@/lib/team-query-keys";
import { createTeam, createTeamGroup, getTeam, listTeams } from "@/services/api/teams";
import { ApiError } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";
import { TeamManagementPage } from "./team-management-page";

export function TeamQueryError({ error, retry }: { error: Error; retry: () => unknown }) {
    return <Alert type="error" showIcon title="读取失败" description={error.message} action={<Button onClick={() => void retry()}>重试</Button>} />;
}

export default function TeamsPage() {
    const userId = useUserStore((state) => state.user?.id) || "";
    const teams = useQuery({ queryKey: teamKeys.list(userId), queryFn: ({ signal }) => listTeams(signal) });
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const { message } = App.useApp();
    const [params, setParams] = useSearchParams();
    const creating = params.has("create");
    const parentId = params.get("parent") || "";
    const roots = teams.data?.filter((team) => !team.parentId) || [];
    const owned = roots.filter((team) => team.role === "owner");
    const empty = teams.isSuccess && teams.data.length === 0;
    const canCreateHere = !parentId || owned.some((team) => team.id === parentId);
    const [name, setName] = useState("");
    const openCreate = (parent?: string) => {
        setName("");
        setParams(parent ? { create: "1", parent } : { create: "1" });
    };
    const create = useMutation({
        mutationFn: () => (parentId ? createTeamGroup(parentId, name.trim()) : createTeam(name.trim())),
        onSuccess: async (team) => {
            await queryClient.invalidateQueries({ queryKey: teamKeys.all(userId) });
            navigate(`/teams/${encodeURIComponent(team.id)}`, { replace: true });
        },
        onError: (error) => message.error(error.message),
    });
    return (
        <TeamManagementPage fill={empty}>
            <PageHeader
                title="公司与团队"
                actions={
                    <>
                        <Button icon={<UserPlus aria-hidden />} onClick={openTeamInvitations}>
                            团队邀请
                        </Button>
                        <Button type="primary" icon={<Plus aria-hidden />} onClick={() => openCreate()}>
                            创建空间
                        </Button>
                    </>
                }
            />
            {teams.isError ? <TeamQueryError error={teams.error} retry={teams.refetch} /> : null}
            {teams.isPending ? (
                <p role="status" className="text-sm text-muted-foreground">
                    正在读取团队…
                </p>
            ) : null}
            {empty ? (
                <EmptyState className="grow rounded-xl border border-border bg-card" icon={Users} title="还没有加入团队" />
            ) : (
                <div className="grid items-start gap-4 @xl:grid-cols-2">
                    {!teams.isError &&
                        roots.map((team) => {
                            const groups = teams.data?.filter((group) => group.parentId === team.id);
                            return (
                                <section key={team.id} className="min-w-0 rounded-xl border border-border bg-card p-3">
                                    <Link to={`/teams/${encodeURIComponent(team.id)}`} className="flex items-center gap-3 rounded-lg p-2 hover:bg-surface-hover">
                                        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-[color:var(--brand,var(--foreground))]">
                                            <Building2 aria-hidden className="size-5" />
                                        </span>
                                        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{team.name}</h2>
                                        <StatusBadge variant="filled" label={team.role === "owner" ? "所有者" : "成员"} />
                                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                                    </Link>
                                    {groups?.length ? (
                                        <ul className="my-2 ml-7 space-y-1 border-l border-border pl-3">
                                            {groups.map((group) => (
                                                <li key={group.id}>
                                                    <Link className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-surface-hover" to={`/teams/${encodeURIComponent(group.id)}`}>
                                                        <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                                                        <span className="truncate">{group.name}</span>
                                                    </Link>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : null}
                                    {team.role === "owner" ? (
                                        <Button type="text" size="small" className="mt-2" icon={<Plus aria-hidden className="size-3.5" />} onClick={() => openCreate(team.id)}>
                                            创建小组
                                        </Button>
                                    ) : null}
                                </section>
                            );
                        })}
                </div>
            )}
            <AppModal
                centered
                title={parentId ? "创建小组" : "创建空间"}
                open={creating}
                onCancel={() => {
                    if (!create.isPending) setParams({}, { replace: true });
                }}
                onOk={() => create.mutate()}
                confirmLoading={create.isPending}
                okText="创建"
                okButtonProps={{ disabled: !name.trim() || !canCreateHere }}
            >
                <label className="workspace-toolbar mb-4 block space-y-2">
                    <span>上级空间</span>
                    <Select
                        aria-label="上级空间"
                        className="w-full"
                        value={parentId}
                        disabled={create.isPending}
                        onChange={(parent: string) => setParams(parent ? { create: "1", parent } : { create: "1" }, { replace: true })}
                        options={[{ value: "", label: "无上级" }, ...owned.map((company) => ({ value: company.id, label: company.name }))]}
                    />
                </label>
                <label className="workspace-toolbar block space-y-2">
                    <span>{parentId ? "小组名称" : "空间名称"}</span>
                    <Input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        maxLength={80}
                        disabled={create.isPending}
                        placeholder={parentId ? "例如：剪辑组" : "例如：星河工作室"}
                        onPressEnter={() => {
                            if (name.trim() && canCreateHere && !create.isPending) create.mutate();
                        }}
                    />
                </label>
                <p className="mt-3 text-sm text-foreground/60">{parentId ? "可邀请公司成员，额度和素材库独立。" : "创建后可邀请成员、添加小组。"}</p>
            </AppModal>
        </TeamManagementPage>
    );
}

export function TeamWorkspacePage() {
    const { teamId = "" } = useParams();
    const userId = useUserStore((state) => state.user?.id) || "";
    const queryClient = useQueryClient();
    const teamQuery = useQuery({
        queryKey: [...teamKeys.space(userId, teamId), "detail"],
        queryFn: ({ signal }) => getTeam(teamId, signal),
        staleTime: 10_000,
        refetchOnWindowFocus: true,
        refetchInterval: () => (document.visibilityState === "visible" ? 30_000 : false),
        retry: false,
    });
    useEffect(() => {
        if (!(teamQuery.error instanceof ApiError) || ![401, 403, 404].includes(teamQuery.error.status || 0)) return;
        void queryClient.cancelQueries({ queryKey: teamKeys.space(userId, teamId) });
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] === "teams" && query.queryKey[1] === userId && query.queryKey[3] === teamId && query.queryKey[4] !== "detail" });
        void queryClient.invalidateQueries({ queryKey: teamKeys.list(userId) });
        void queryClient.invalidateQueries({ queryKey: teamKeys.credits(userId) });
    }, [queryClient, teamId, teamQuery.error, userId]);
    if (teamQuery.isError)
        return (
            <TeamManagementPage>
                <PageHeader title="团队空间无法访问" />
                <TeamQueryError error={teamQuery.error} retry={teamQuery.refetch} />
                <Link className="inline-block text-sm underline underline-offset-4" to="/teams">
                    返回我的团队
                </Link>
            </TeamManagementPage>
        );
    if (!teamQuery.data)
        return (
            <TeamManagementPage>
                <p role="status" className="text-sm text-muted-foreground">
                    正在验证团队身份…
                </p>
            </TeamManagementPage>
        );
    return <Outlet key={`${userId}:${teamId}`} context={teamQuery.data} />;
}
