import { afterEach, expect, test } from "bun:test";
import { useTaskHistoryUnreadStore } from "@/stores/use-task-history-unread-store";

afterEach(() => useTaskHistoryUnreadStore.setState({ byUser: {} }));

test("successful task receipts are deduplicated and isolated to the submitting account", () => {
    const { mark } = useTaskHistoryUnreadStore.getState();
    mark(undefined, "guest");
    mark("first-user", "canvas-task");
    mark("first-user", "canvas-task");
    mark("first-user", "workbench-task");
    mark("second-user", "another-task");
    expect(useTaskHistoryUnreadStore.getState().byUser).toEqual({
        "first-user": ["canvas-task", "workbench-task"],
        "second-user": ["another-task"],
    });
});

test("acknowledging a fetched snapshot leaves submissions accepted during the fetch unread", () => {
    const { mark, acknowledge } = useTaskHistoryUnreadStore.getState();
    mark("user", "first");
    const snapshot = useTaskHistoryUnreadStore.getState().byUser.user;
    mark("user", "during-fetch");
    acknowledge("user", snapshot);
    expect(useTaskHistoryUnreadStore.getState().byUser.user).toEqual(["during-fetch"]);
});
