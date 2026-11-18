export function formatCreditPoints(value: number, locale = "zh-CN") {
    return value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "negative" });
}

export function formatCreditDisplay(microcredits: number, locale = "zh-CN") {
    return formatCreditPoints(microcredits / 1_000_000, locale);
}
