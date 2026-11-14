package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/protocol"
)

func TestPluginRuntimePreservesCompactManifestThroughLifecycle(t *testing.T) {
	items := make([]any, 5000)
	for index := range items {
		items[index] = map[string]any{"value": map[string]any{"$ref": "request.prompt"}}
	}
	manifest, err := json.Marshal(map[string]any{
		"apiVersion": "yingce.plugin/v1", "id": "compact-runtime", "version": "1.0.0",
		"name": "Compact Runtime", "author": "Test", "documentation": "# Compact Runtime",
		"contributes": map[string]any{"providers": []any{map[string]any{
			"id": "compact-runtime", "label": "Compact Runtime", "capabilities": []string{"video"}, "scopes": []string{"canvas"},
			"create":   map[string]any{"method": "POST", "path": "/tasks", "body": map[string]any{"items": items}},
			"response": map[string]any{"statusPaths": []string{"status"}},
		}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	var expanded any
	if err := json.Unmarshal(manifest, &expanded); err != nil {
		t.Fatal(err)
	}
	pretty, err := json.MarshalIndent(expanded, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest) >= protocol.PluginManifestMaxBytes || len(pretty) <= protocol.PluginManifestMaxBytes {
		t.Fatalf("fixture must only exceed limit after indentation: compact=%d, pretty=%d", len(manifest), len(pretty))
	}
	dataDir := t.TempDir()
	center, err := newPluginRuntime(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	pkg := testPluginPackage(t, manifest)
	for attempt := 0; attempt < 2; attempt++ {
		plugin, err := center.install(pkg, "compact-runtime.yingce-plugin")
		if err != nil {
			t.Fatal(err)
		}
		if plugin.Status != "enabled" || !center.registrySnapshot().IsCapability("compact-runtime", protocol.CapabilityVideo) {
			t.Fatalf("installed plugin unavailable: %#v", plugin)
		}
	}
	if _, err := center.setEnabled("compact-runtime", false); err != nil {
		t.Fatal(err)
	}
	center, err = newPluginRuntime(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if center.registrySnapshot().IsCapability("compact-runtime", protocol.CapabilityVideo) {
		t.Fatal("disabled state lost after restart")
	}
	if _, err := center.setEnabled("compact-runtime", true); err != nil {
		t.Fatal(err)
	}
	if !center.registrySnapshot().IsCapability("compact-runtime", protocol.CapabilityVideo) {
		t.Fatal("re-enabled plugin unavailable")
	}
	if err := center.uninstall("compact-runtime"); err != nil {
		t.Fatal(err)
	}
}
