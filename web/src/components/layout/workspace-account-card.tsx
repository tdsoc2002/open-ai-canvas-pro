import { Button } from "antd";
import { ArrowUpRight, Gift, LogOut, RefreshCw, Settings, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { currentLocale } from "@/i18n";
import { formatCreditDisplay } from "@/constant/credits";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { useWorkspaceLogout } from "@/hooks/use-workspace-logout";
import { useUserStore } from "@/stores/use-user-store";
import { UserAvatar } from "./user-avatar";
import { UserGroupAvatarRing, UserGroupBadge } from "./user-group-badge";
import { WorkspaceCreditGiftMark } from "./workspace-credit-gift-mark";
import { WorkspaceSidebarStorageMeter } from "./workspace-sidebar-storage-meter";
import "./workspace-account-card.css";

/** 同一账户卡片用于顶部和侧栏；余额与退出均复用真实服务。 */
export function WorkspaceAccountCard({ children, onWallet, onNavigate }: { children?: ReactNode; onWallet: () => void; onNavigate: () => void }) {
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const referralAvailable = useUserStore((state) => state.referralAvailable);
    const { availableMicrocredits, refreshing, refresh } = useWalletBalance(user?.id, creditsEnabled);
    const { handleLogout, loggingOut } = useWorkspaceLogout();
    const { t } = useTranslation();
    if (!user) return null;
    return (
        <section className="workspace-account-card" aria-label={t("shell.account.region")}>
            <header className="workspace-account-card-identity">
                <UserGroupAvatarRing>
                    <UserAvatar user={user} className="workspace-account-card-avatar" />
                </UserGroupAvatarRing>
                <div className="workspace-account-card-profile">
                    <strong className="workspace-account-card-name">
                        <span title={user.displayName || user.username}>{user.displayName || user.username}</span>
                        <UserGroupBadge />
                    </strong>
                    <span className="workspace-account-card-handle" title={`@${user.username}`}>
                        @{user.username}
                    </span>
                </div>
                <span className="workspace-account-card-role">{user.role === "admin" ? t("shell.account.admin") : t("shell.account.creator")}</span>
            </header>
            {creditsEnabled ? (
                <div className="workspace-account-card-wallet">
                    <div className="workspace-account-card-balance">
                        <span>
                            <WorkspaceCreditGiftMark />
                            {t("shell.account.availableCredits")}
                        </span>
                        <strong>{availableMicrocredits === null ? "—" : formatCreditDisplay(availableMicrocredits, currentLocale())}</strong>
                    </div>
                    {availableMicrocredits === null ? (
                        <Button className="workspace-account-card-wallet-action" loading={refreshing} icon={<RefreshCw aria-hidden />} onClick={() => void refresh()}>
                            {t("shell.account.refreshBalance")}
                        </Button>
                    ) : (
                        <button type="button" className="workspace-account-card-wallet-action" onClick={onWallet}>
                            {t("shell.account.topup")}
                            <ArrowUpRight aria-hidden />
                        </button>
                    )}
                </div>
            ) : null}
            <div className="workspace-account-card-storage">
                <WorkspaceSidebarStorageMeter collapsed={false} onOpen={onNavigate} />
            </div>
            <div>
                <nav className="workspace-account-card-actions" aria-label={t("shell.account.actions")}>
                    <Link to="/settings?section=profile" onClick={onNavigate}>
                        <Settings />
                        <span>{t("shell.account.settings")}</span>
                        <ArrowUpRight />
                    </Link>
                    {referralAvailable ? (
                        <Link to="/referral" onClick={onNavigate}>
                            <Gift />
                            <span>{t("shell.account.referral")}</span>
                            <ArrowUpRight />
                        </Link>
                    ) : null}
                    {user.role === "admin" ? (
                        <Link to="/admin" onClick={onNavigate}>
                            <ShieldCheck />
                            <span>{t("shell.account.adminConsole")}</span>
                            <ArrowUpRight />
                        </Link>
                    ) : null}
                </nav>
                {children}
            </div>
            <div className="workspace-account-card-logout">
                <Button danger type="text" icon={<LogOut aria-hidden />} loading={loggingOut} onClick={() => void handleLogout()}>
                    {t("shell.account.logout")}
                </Button>
            </div>
        </section>
    );
}
