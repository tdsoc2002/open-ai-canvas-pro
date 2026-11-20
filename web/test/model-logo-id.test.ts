import { expect, test } from "bun:test";
import { createModelLogoResolver } from "../src/lib/model-logo-id";

test("logo IDs resolve irrespective of case without changing stored IDs", () => {
    const resolve = createModelLogoResolver(["Minimax", "OpenAI"]);
    expect(resolve("minimax")).toBe("Minimax");
    expect(resolve(" Minimax ")).toBe("Minimax");
    expect(resolve("unknown")).toBeUndefined();
});
