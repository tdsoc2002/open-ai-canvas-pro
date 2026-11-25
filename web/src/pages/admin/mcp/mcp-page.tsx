import MCPManager from "@/components/mcp/mcp-manager";
import { AdminPageFrame } from "../components/admin-shell";

export default function AdminMCPPage() {
    return (
        <AdminPageFrame title="MCP 管理">
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-background p-4 sm:p-5">
                <MCPManager scope="platform" />
            </section>
        </AdminPageFrame>
    );
}
