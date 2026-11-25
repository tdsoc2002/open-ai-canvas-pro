import { Form, Input, InputNumber } from "antd";
import { SegmentedControl, Select } from "@/pages/admin/ui/controls";
import { Moon, Sun, Palette } from "lucide-react";
import { useState } from "react";

import { SKIN_COLOR_GROUPS, SKIN_COMPONENT_NUMBER_FIELDS, SKIN_BUTTON_COLOR_FIELDS, getSkinButtonAppearance, type SkinButtonFill, type SkinComponentTokens, type SkinDefinition, type SkinModeTokens, type SkinThemeMode } from "@/lib/skin-themes";

export function SkinThemeEditor({ skin, disabled, onChange }: { skin: SkinDefinition; disabled: boolean; onChange: (theme: SkinDefinition) => void }) {
    const [mode, setMode] = useState<SkinThemeMode>("light");
    const buttonFill = skin.tokens.buttons[mode];
    const updateButton = (patch: Partial<SkinButtonFill>) => onChange({ ...skin, tokens: { ...skin.tokens, buttons: { ...skin.tokens.buttons, [mode]: { ...buttonFill, ...patch } } } });

    const updateIdentity = (patch: Partial<Pick<SkinDefinition, "name" | "description">>) => onChange({ ...skin, ...patch });
    const updateColor = (key: keyof SkinModeTokens, value: string) =>
        onChange({
            ...skin,
            tokens: { ...skin.tokens, [mode]: { ...skin.tokens[mode], [key]: value.trim().toLowerCase() } },
        });
    const updateComponent = <Key extends keyof SkinComponentTokens>(key: Key, value: SkinComponentTokens[Key]) => onChange({ ...skin, tokens: { ...skin.tokens, components: { ...skin.tokens.components, [key]: value } } });

    return (
        <div className="admin-skin-workspace">
            <div className="admin-skin-editor">
                <Form className="admin-appearance-form admin-skin-identity-form" layout="vertical" requiredMark={false} disabled={disabled}>
                    <div className="admin-appearance-form-grid">
                        <Form.Item label="主题名称" extra="1–40 个字符，可随时更改。">
                            <Input value={skin.name} maxLength={40} showCount onChange={(event) => updateIdentity({ name: event.target.value })} />
                        </Form.Item>
                        <Form.Item label="主题说明" extra="显示在后台皮肤设置中。">
                            <Input value={skin.description} maxLength={100} showCount onChange={(event) => updateIdentity({ description: event.target.value })} />
                        </Form.Item>
                    </div>
                </Form>

                <div className="admin-skin-mode-bar">
                    <div>
                        <strong>颜色体系</strong>
                        <span>同一用途的控件统一消费下列语义颜色</span>
                    </div>
                    <SegmentedControl<SkinThemeMode>
                        ariaLabel="皮肤预览模式"
                        value={mode}
                        options={[
                            {
                                label: (
                                    <span className="admin-skin-mode-label">
                                        <Sun />
                                        浅色
                                    </span>
                                ),
                                value: "light",
                            },
                            {
                                label: (
                                    <span className="admin-skin-mode-label">
                                        <Moon />
                                        深色
                                    </span>
                                ),
                                value: "dark",
                            },
                        ]}
                        onChange={setMode}
                    />
                </div>

                <SkinThemePreview theme={skin} mode={mode} />

                <details className="admin-skin-token-group" open>
                    <summary>
                        <span>主按钮填充</span>
                        <small>{mode === "light" ? "浅色" : "深色"}模式</small>
                    </summary>
                    <div className="admin-skin-component-grid">
                        <label className="admin-skin-number-field">
                            <span>填充方式</span>
                            <Select
                                value={buttonFill.mode}
                                disabled={disabled}
                                options={[
                                    { label: "纯色（使用主操作颜色）", value: "solid" },
                                    { label: "渐变", value: "gradient" },
                                ]}
                                onChange={(value) => updateButton({ mode: value })}
                            />
                        </label>
                        {buttonFill.mode === "gradient" ? (
                            <label className="admin-skin-number-field">
                                <span>渐变角度</span>
                                <InputNumber
                                    aria-label="渐变角度"
                                    value={buttonFill.angle}
                                    min={0}
                                    max={360}
                                    precision={0}
                                    addonAfter="°"
                                    disabled={disabled}
                                    onChange={(value) => {
                                        if (typeof value === "number") updateButton({ angle: value });
                                    }}
                                />
                            </label>
                        ) : null}
                    </div>
                    {buttonFill.mode === "gradient" ? (
                        <div className="admin-skin-color-grid">
                            {SKIN_BUTTON_COLOR_FIELDS.map(({ key, label }) => (
                                <ColorTokenField key={key} label={label} help="仅影响主按钮，不改变选中态、开关和危险操作" value={buttonFill[key]} disabled={disabled} onChange={(value) => updateButton({ [key]: value.trim().toLowerCase() })} />
                            ))}
                        </div>
                    ) : null}
                </details>

                <div className="admin-skin-color-groups">
                    {SKIN_COLOR_GROUPS.map((group, index) => (
                        <details key={group.key} className="admin-skin-token-group" open={index < 2}>
                            <summary>
                                <span>{group.label}</span>
                                <small>{group.fields.length} 项</small>
                            </summary>
                            <div className="admin-skin-color-grid">
                                {group.fields.map((field) => (
                                    <ColorTokenField key={field.key} label={field.label} help={field.help} value={skin.tokens[mode][field.key]} disabled={disabled} onChange={(value) => updateColor(field.key, value)} />
                                ))}
                            </div>
                        </details>
                    ))}
                </div>

                <details className="admin-skin-token-group admin-skin-component-group" open>
                    <summary>
                        <span>控件尺寸、圆角与反馈</span>
                        <small>17 项</small>
                    </summary>
                    <div className="admin-skin-component-grid">
                        {SKIN_COMPONENT_NUMBER_FIELDS.map((field) => (
                            <label key={field.key} className="admin-skin-number-field">
                                <span>{field.label}</span>
                                <InputNumber
                                    value={skin.tokens.components[field.key]}
                                    min={field.min}
                                    max={field.max}
                                    step={field.step || 1}
                                    addonAfter={field.suffix || undefined}
                                    disabled={disabled}
                                    onChange={(value) => {
                                        if (typeof value === "number") updateComponent(field.key, value);
                                    }}
                                />
                            </label>
                        ))}
                        <label className="admin-skin-number-field">
                            <span>阴影风格</span>
                            <Select
                                value={skin.tokens.components.shadowStyle}
                                disabled={disabled}
                                options={[
                                    { label: "无阴影", value: "none" },
                                    { label: "柔和阴影", value: "soft" },
                                    { label: "强层次阴影", value: "strong" },
                                ]}
                                onChange={(value) => updateComponent("shadowStyle", value)}
                            />
                        </label>
                    </div>
                </details>
            </div>
        </div>
    );
}

function ColorTokenField({ label, help, value, disabled, onChange }: { label: string; help: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
    const pickerValue = /^#[0-9a-f]{6}$/i.test(value) ? value : /^#[0-9a-f]{8}$/i.test(value) ? value.slice(0, 7) : "#000000";
    return (
        <div className="admin-skin-color-field">
            <span>
                <strong>{label}</strong>
                <small>{help}</small>
            </span>
            <span className="admin-skin-color-control">
                <input type="color" value={pickerValue} disabled={disabled} aria-label={`${label}取色器`} title={`选择${label}`} onChange={(event) => onChange(event.target.value)} />
                <Input value={value} maxLength={9} disabled={disabled} spellCheck={false} status={/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? undefined : "error"} onChange={(event) => onChange(event.target.value)} />
            </span>
        </div>
    );
}

function SkinThemePreview({ theme, mode }: { theme: SkinDefinition; mode: SkinThemeMode }) {
    const color = theme.tokens[mode];
    const button = getSkinButtonAppearance(theme, mode);
    const component = theme.tokens.components;
    const shadow = component.shadowStyle === "none" ? "none" : component.shadowStyle === "strong" ? "0 18px 44px #0000003d" : "0 10px 28px #00000024";
    return (
        <div className="admin-skin-live-preview" style={{ background: color.canvas, color: color.text, borderColor: color.border, borderRadius: component.cardRadius }}>
            <div className="admin-skin-live-preview-card" style={{ background: color.surface, borderColor: color.border, borderRadius: component.cardRadius, boxShadow: shadow }}>
                <span className="admin-skin-live-preview-icon" style={{ background: color.surfaceSubtle, color: color.iconActive, borderRadius: component.inputRadius }}>
                    <Palette />
                </span>
                <div>
                    <strong>控件组合预览</strong>
                    <small style={{ color: color.textMuted }}>按钮、输入、选中与状态均来自同一套主题参数</small>
                </div>
                <span className="admin-skin-live-preview-status" style={{ background: color.selected, color: color.selectedForeground, borderRadius: component.menuRadius }}>
                    已选中
                </span>
                <span className="admin-skin-live-preview-menu" style={{ background: color.selected, color: color.selectedForeground, borderRadius: component.menuRadius }}>
                    后台菜单
                </span>
                <span
                    className="admin-skin-live-preview-input"
                    style={{ height: component.controlHeight, background: color.control, borderColor: color.controlBorder, borderWidth: component.borderWidth, borderRadius: component.inputRadius, color: color.textMuted }}
                >
                    输入框状态
                </span>
                <span className="admin-skin-live-preview-button" style={{ height: component.controlHeight, background: button.background, color: button.foreground, borderRadius: component.buttonRadius, fontWeight: component.buttonFontWeight }}>
                    主要操作
                </span>
                <span className="admin-skin-live-preview-switches" aria-label="开关开启与关闭状态预览">
                    <i className="is-on" style={{ background: color.switchChecked }}>
                        <b style={{ background: color.switchCheckedHandle }} />
                    </i>
                    <i style={{ background: color.switchUnchecked }}>
                        <b style={{ background: color.switchUncheckedHandle }} />
                    </i>
                </span>
                <span className="admin-skin-live-preview-danger" style={{ background: color.danger, color: color.dangerForeground, borderRadius: component.buttonRadius }}>
                    删除
                </span>
                <span className="admin-skin-live-preview-signals">
                    <i style={{ background: color.success }} />
                    <i style={{ background: color.warning }} />
                    <i style={{ background: color.danger }} />
                    <i style={{ background: color.info }} />
                </span>
            </div>
        </div>
    );
}
