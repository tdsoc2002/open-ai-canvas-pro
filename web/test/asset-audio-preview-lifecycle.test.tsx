import { expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { AudioPlayButton } from "@/components/assets/asset-rich-cover";
import * as resources from "@/services/api/resources";
import type { AudioAsset } from "@/stores/use-asset-store";

test("试听请求未完成时关闭素材预览，后来返回的地址不会启动播放器", async () => {
    const dom = new Window({ url: "http://fixture.invalid/" });
    const play = mock(async () => {});
    class FixtureAudio extends EventTarget {
        paused = true;
        src = "";
        currentTime = 0;
        pause() {}
        play = play;
    }
    const globals = { window: dom, document: dom.document, Audio: FixtureAudio, IS_REACT_ACT_ENVIRONMENT: true };
    const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    const access = Promise.withResolvers<Awaited<ReturnType<typeof resources.getResourceAccess>>>();
    const getAccess = spyOn(resources, "getResourceAccess").mockReturnValue(access.promise);
    const asset: AudioAsset = { id: "voice", kind: "audio", title: "角色声音", coverUrl: "", tags: [], createdAt: "", updatedAt: "", data: { url: "", storageKey: "resource:voice", bytes: 0, mimeType: "audio/wav" } };
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host as unknown as Element);
    try {
        await act(() => root.render(<AudioPlayButton asset={asset} />));
        await act(() => host.querySelector("button")!.click());
        expect(getAccess).toHaveBeenCalledWith("resource:voice", "display", "playback");
        await act(() => root.render(null));
        await act(() => access.resolve({ url: "/api/resources/voice/file" } as Awaited<ReturnType<typeof resources.getResourceAccess>>));
        expect(play).not.toHaveBeenCalled();
    } finally {
        await act(() => root.unmount());
        getAccess.mockRestore();
        await dom.happyDOM.abort();
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
