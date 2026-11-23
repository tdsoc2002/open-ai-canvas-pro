import { expect, test } from "bun:test";
import { formatCreditDisplay, formatCredits } from "@/constant/credits";
import { teamCredits } from "@/lib/team-query-keys";
import { emptyUserGroupForm, formatPoints, userGroupInput } from "@/pages/admin/user-groups/user-group-form";

test("credit display rounds to two decimals and keeps trailing zeros", () => {
    expect(formatCreditDisplay(0)).toBe("0.00");
    expect(formatCreditDisplay(7_000_000)).toBe("7.00");
    expect(formatCreditDisplay(1_234_999)).toBe("1.23");
    expect(formatCreditDisplay(1_235_000)).toBe("1.24");
    expect(formatCreditDisplay(-1_235_000)).toBe("-1.24");
    expect(formatCreditDisplay(-1)).toBe("0.00");
    expect(formatCreditDisplay(1_234_500_000, "de-DE")).toBe("1.234,50");
    expect(formatCredits(1_234_999)).toBe("1.234999");
});

test("space credit display also uses exactly two decimal places", () => {
    expect(teamCredits(83_964_016)).toBe("83.96");
    expect(teamCredits(83_965_000)).toBe("83.97");
    expect(teamCredits(84_000_000)).toBe("84.00");
});

test("conversion rate display does not change the value sent to the server", () => {
    expect(formatPoints(7_235_001)).toBe("7.24");
    expect(userGroupInput({ ...emptyUserGroupForm(), pointsPerUsd: 7.235001 }).pointsPerUsdMicrocredits).toBe(7_235_001);
});
