package app

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"reflect"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

//go:embed appearance_theme_packs.json
var appearanceThemePackDefinitions []byte

var (
	appearanceColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$`)
	defaultAppearanceSkin  = loadDefaultAppearanceSkin()
)

// AppearanceSkinModeTokens is deliberately an allowlist instead of arbitrary CSS.
// Every value is validated as a six- or eight-digit hex color before it is exposed
// by the public appearance endpoint.
type AppearanceSkinModeTokens struct {
	Canvas                    string `json:"canvas"`
	Surface                   string `json:"surface"`
	SurfaceSubtle             string `json:"surfaceSubtle"`
	SurfaceRaised             string `json:"surfaceRaised"`
	Overlay                   string `json:"overlay"`
	Text                      string `json:"text"`
	TextMuted                 string `json:"textMuted"`
	Border                    string `json:"border"`
	Control                   string `json:"control"`
	ControlHover              string `json:"controlHover"`
	ControlActive             string `json:"controlActive"`
	ControlBorder             string `json:"controlBorder"`
	ControlFocus              string `json:"controlFocus"`
	ControlDisabledBackground string `json:"controlDisabledBackground"`
	ControlDisabledForeground string `json:"controlDisabledForeground"`
	SwitchChecked             string `json:"switchChecked"`
	SwitchCheckedHover        string `json:"switchCheckedHover"`
	SwitchCheckedHandle       string `json:"switchCheckedHandle"`
	SwitchUnchecked           string `json:"switchUnchecked"`
	SwitchUncheckedHover      string `json:"switchUncheckedHover"`
	SwitchUncheckedHandle     string `json:"switchUncheckedHandle"`
	Primary                   string `json:"primary"`
	PrimaryHover              string `json:"primaryHover"`
	PrimaryActive             string `json:"primaryActive"`
	PrimaryForeground         string `json:"primaryForeground"`
	Selected                  string `json:"selected"`
	SelectedHover             string `json:"selectedHover"`
	SelectedActive            string `json:"selectedActive"`
	SelectedForeground        string `json:"selectedForeground"`
	Icon                      string `json:"icon"`
	IconMuted                 string `json:"iconMuted"`
	IconActive                string `json:"iconActive"`
	Success                   string `json:"success"`
	Warning                   string `json:"warning"`
	Danger                    string `json:"danger"`
	DangerHover               string `json:"dangerHover"`
	DangerActive              string `json:"dangerActive"`
	DangerForeground          string `json:"dangerForeground"`
	Info                      string `json:"info"`
	Workspace                 string `json:"workspace"`
	WorkspaceGrid             string `json:"workspaceGrid"`
	AdminBackground           string `json:"adminBackground"`
	AdminSurface              string `json:"adminSurface"`
	AdminSubtle               string `json:"adminSubtle"`
	AdminStrong               string `json:"adminStrong"`
	AuthBackground            string `json:"authBackground"`
	AuthPanel                 string `json:"authPanel"`
	AuthCard                  string `json:"authCard"`
	AuthAccent                string `json:"authAccent"`
	AuthMuted                 string `json:"authMuted"`
}

type AppearanceSkinComponentTokens struct {
	ButtonRadius       int    `json:"buttonRadius"`
	InputRadius        int    `json:"inputRadius"`
	CardRadius         int    `json:"cardRadius"`
	OverlayRadius      int    `json:"overlayRadius"`
	MenuRadius         int    `json:"menuRadius"`
	CheckboxRadius     int    `json:"checkboxRadius"`
	ControlHeight      int    `json:"controlHeight"`
	ControlHeightSmall int    `json:"controlHeightSmall"`
	ControlHeightLarge int    `json:"controlHeightLarge"`
	BorderWidth        int    `json:"borderWidth"`
	FocusRingWidth     int    `json:"focusRingWidth"`
	IconSize           int    `json:"iconSize"`
	ButtonFontWeight   int    `json:"buttonFontWeight"`
	HoverLift          int    `json:"hoverLift"`
	MotionFast         int    `json:"motionFast"`
	MotionNormal       int    `json:"motionNormal"`
	ShadowStyle        string `json:"shadowStyle"`
}

type AppearanceSkinTokens struct {
	Light      AppearanceSkinModeTokens      `json:"light"`
	Dark       AppearanceSkinModeTokens      `json:"dark"`
	Components AppearanceSkinComponentTokens `json:"components"`
	Buttons    AppearanceSkinButtons         `json:"buttons"`
}

type AppearanceSkinButtons struct {
	Light AppearanceSkinButtonFill `json:"light"`
	Dark  AppearanceSkinButtonFill `json:"dark"`
}

type AppearanceSkinButtonFill struct {
	Mode        string `json:"mode"`
	Angle       int    `json:"angle"`
	Start       string `json:"start"`
	End         string `json:"end"`
	HoverStart  string `json:"hoverStart"`
	HoverEnd    string `json:"hoverEnd"`
	ActiveStart string `json:"activeStart"`
	ActiveEnd   string `json:"activeEnd"`
	Foreground  string `json:"foreground"`
}

type AppearanceSkinTheme struct {
	ID          string               `json:"id"`
	Name        string               `json:"name"`
	Description string               `json:"description"`
	Locked      bool                 `json:"locked"`
	Tokens      AppearanceSkinTokens `json:"tokens"`
}

func loadDefaultAppearanceSkin() AppearanceSkinTheme {
	var definitions struct {
		JoyseeMinimal AppearanceSkinTheme `json:"joyseeMinimal"`
	}
	if err := json.Unmarshal(appearanceThemePackDefinitions, &definitions); err != nil {
		panic(fmt.Sprintf("invalid embedded appearance skin: %v", err))
	}
	if definitions.JoyseeMinimal.ID != defaultAppearanceSkinID {
		panic("missing embedded Joysee appearance skin")
	}
	return definitions.JoyseeMinimal
}

func defaultAppearanceSkinThemes() []AppearanceSkinTheme {
	return []AppearanceSkinTheme{defaultAppearanceSkin}
}

func normalizeAppearanceSkinThemes(themes []AppearanceSkinTheme) []AppearanceSkinTheme {
	for _, theme := range themes {
		if strings.ToLower(strings.TrimSpace(theme.ID)) != defaultAppearanceSkinID {
			continue
		}
		theme.ID = defaultAppearanceSkinID
		theme.Name = strings.TrimSpace(theme.Name)
		theme.Description = strings.TrimSpace(theme.Description)
		theme.Locked = false
		if theme.Tokens.Buttons == (AppearanceSkinButtons{}) {
			theme.Tokens.Buttons = defaultAppearanceSkin.Tokens.Buttons
		}
		backfillAppearanceSkinModeColors(&theme.Tokens.Light, defaultAppearanceSkin.Tokens.Light)
		backfillAppearanceSkinModeColors(&theme.Tokens.Dark, defaultAppearanceSkin.Tokens.Dark)
		normalizeAppearanceSkinModeColors(&theme.Tokens.Light)
		normalizeAppearanceSkinModeColors(&theme.Tokens.Dark)
		theme.Tokens.Components.ShadowStyle = strings.ToLower(strings.TrimSpace(theme.Tokens.Components.ShadowStyle))
		return []AppearanceSkinTheme{theme}
	}
	return defaultAppearanceSkinThemes()
}

func backfillAppearanceSkinModeColors(mode *AppearanceSkinModeTokens, fallback AppearanceSkinModeTokens) {
	for _, field := range []struct {
		value    *string
		fallback string
	}{
		{&mode.SwitchChecked, fallback.SwitchChecked},
		{&mode.SwitchCheckedHover, fallback.SwitchCheckedHover},
		{&mode.SwitchCheckedHandle, fallback.SwitchCheckedHandle},
		{&mode.SwitchUnchecked, fallback.SwitchUnchecked},
		{&mode.SwitchUncheckedHover, fallback.SwitchUncheckedHover},
		{&mode.SwitchUncheckedHandle, fallback.SwitchUncheckedHandle},
		{&mode.DangerHover, fallback.DangerHover},
		{&mode.DangerActive, fallback.DangerActive},
		{&mode.DangerForeground, fallback.DangerForeground},
	} {
		if strings.TrimSpace(*field.value) == "" {
			*field.value = field.fallback
		}
	}
}

func normalizeAppearanceSkinModeColors(mode *AppearanceSkinModeTokens) {
	value := reflect.ValueOf(mode).Elem()
	for index := 0; index < value.NumField(); index++ {
		field := value.Field(index)
		field.SetString(strings.ToLower(strings.TrimSpace(field.String())))
	}
}

func validateAppearanceSkinThemes(themes []AppearanceSkinTheme) error {
	if len(themes) != 1 || themes[0].ID != defaultAppearanceSkinID {
		return BadAuthRequest("皮肤主题必须为乐见极简")
	}
	skin := themes[0]
	if err := validateAppearanceSkinText(skin.Name, "皮肤主题名称", 40, true); err != nil {
		return err
	}
	if err := validateAppearanceSkinText(skin.Description, "皮肤主题说明", 100, false); err != nil {
		return err
	}
	if err := validateAppearanceSkinMode(skin.Tokens.Light); err != nil {
		return err
	}
	if err := validateAppearanceSkinMode(skin.Tokens.Dark); err != nil {
		return err
	}
	if err := validateAppearanceSkinComponents(skin.Tokens.Components); err != nil {
		return err
	}
	for _, fill := range []AppearanceSkinButtonFill{skin.Tokens.Buttons.Light, skin.Tokens.Buttons.Dark} {
		if err := validateAppearanceSkinButtonFill(fill); err != nil {
			return err
		}
	}
	return nil
}

func validateAppearanceSkinMode(mode AppearanceSkinModeTokens) error {
	value := reflect.ValueOf(mode)
	for index := 0; index < value.NumField(); index++ {
		if !appearanceColorPattern.MatchString(value.Field(index).String()) {
			return BadAuthRequest("皮肤颜色必须使用 6 或 8 位十六进制颜色")
		}
	}
	return nil
}

func validateAppearanceSkinButtonFill(fill AppearanceSkinButtonFill) error {
	if fill.Mode != "solid" && fill.Mode != "gradient" {
		return BadAuthRequest("主按钮填充模式无效")
	}
	if fill.Angle < 0 || fill.Angle > 360 {
		return BadAuthRequest("主按钮渐变角度必须在 0 到 360 之间")
	}
	for _, color := range []string{fill.Start, fill.End, fill.HoverStart, fill.HoverEnd, fill.ActiveStart, fill.ActiveEnd, fill.Foreground} {
		if !appearanceColorPattern.MatchString(color) {
			return BadAuthRequest("主按钮颜色必须使用 6 或 8 位十六进制颜色")
		}
	}
	return nil
}

func validateAppearanceSkinComponents(value AppearanceSkinComponentTokens) error {
	for _, candidate := range []struct {
		value, min, max int
		label           string
	}{
		{value.ButtonRadius, 0, 32, "按钮圆角"}, {value.InputRadius, 0, 32, "输入框圆角"}, {value.CardRadius, 0, 40, "卡片圆角"}, {value.OverlayRadius, 0, 40, "弹层圆角"}, {value.MenuRadius, 0, 32, "菜单圆角"}, {value.CheckboxRadius, 0, 12, "勾选框圆角"},
		{value.ControlHeight, 30, 48, "控件高度"}, {value.ControlHeightSmall, 24, 40, "小控件高度"}, {value.ControlHeightLarge, 36, 56, "大控件高度"}, {value.BorderWidth, 1, 3, "描边宽度"}, {value.FocusRingWidth, 1, 4, "焦点环宽度"},
		{value.IconSize, 12, 24, "图标尺寸"}, {value.ButtonFontWeight, 400, 700, "按钮字重"}, {value.HoverLift, 0, 4, "悬停抬升"}, {value.MotionFast, 0, 400, "快速动效时长"}, {value.MotionNormal, 0, 800, "常规动效时长"},
	} {
		if candidate.value < candidate.min || candidate.value > candidate.max {
			return BadAuthRequest(fmt.Sprintf("%s必须在 %d 到 %d 之间", candidate.label, candidate.min, candidate.max))
		}
	}
	if value.ControlHeightSmall > value.ControlHeight || value.ControlHeight > value.ControlHeightLarge {
		return BadAuthRequest("控件高度须满足小号不大于标准、标准不大于大号")
	}
	if value.MotionFast > value.MotionNormal {
		return BadAuthRequest("快速动效时长不能大于常规动效时长")
	}
	if value.ShadowStyle != "none" && value.ShadowStyle != "soft" && value.ShadowStyle != "strong" {
		return BadAuthRequest("阴影风格无效")
	}
	return nil
}

func validateAppearanceSkinText(value, label string, maxRunes int, required bool) error {
	if required && value == "" {
		return BadAuthRequest(label + "不能为空")
	}
	if utf8.RuneCountInString(value) > maxRunes {
		return BadAuthRequest(fmt.Sprintf("%s不能超过 %d 个字符", label, maxRunes))
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return BadAuthRequest(label + "不能包含控制字符")
		}
	}
	return nil
}
