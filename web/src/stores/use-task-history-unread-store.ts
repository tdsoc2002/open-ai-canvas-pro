import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type TaskHistoryUnreadStore = {
    byUser: Record<string, readonly string[]>;
    mark: (userId: string | undefined, taskId: string) => void;
    acknowledge: (userId: string, snapshot: readonly string[]) => void;
};

export const useTaskHistoryUnreadStore = create<TaskHistoryUnreadStore>()(
    persist(
        (set) => ({
            byUser: {},
            mark: (userId, taskId) => {
                if (!userId || !taskId) return;
                set((state) => {
                    const ids = state.byUser[userId] ?? [];
                    if (ids.includes(taskId)) return state;
                    return { byUser: { ...state.byUser, [userId]: [...ids.slice(-99), taskId] } };
                });
            },
            acknowledge: (userId, snapshot) => {
                if (!snapshot.length) return;
                const seen = new Set(snapshot);
                set((state) => {
                    const remaining = (state.byUser[userId] ?? []).filter((id) => !seen.has(id));
                    const byUser = { ...state.byUser };
                    if (remaining.length) byUser[userId] = remaining;
                    else delete byUser[userId];
                    return { byUser };
                });
            },
        }),
        {
            name: "yingce:task-history-unread",
            partialize: (state) => ({ byUser: state.byUser }),
            storage: createJSONStorage(() => ({
                getItem: (key) => (typeof window === "undefined" ? null : window.localStorage.getItem(key)),
                setItem: (key, value) => {
                    try {
                        if (typeof window !== "undefined") window.localStorage.setItem(key, value);
                    } catch (error) {
                        // 浏览器禁用存储时标记仍在内存里，不能让成功提交变成失败。
                        console.warn("创作历史未读标记未能持久化", error);
                    }
                },
                removeItem: (key) => {
                    if (typeof window !== "undefined") window.localStorage.removeItem(key);
                },
            })),
        },
    ),
);
