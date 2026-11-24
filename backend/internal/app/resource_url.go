package app

import (
	"net/url"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

func resourceFileURL(id string) string {
	return assets.FileURL(id)
}

func workspaceResourceFileURL(ownerID, id string) string {
	if teamID, team := model.TeamIDFromContentKey(ownerID); team {
		return "/api/teams/" + url.PathEscape(teamID) + "/workspace/resources/" + url.PathEscape(id) + "/file"
	}
	return resourceFileURL(id)
}

func isResourceFileURL(value string) bool {
	return assets.IsFileURL(value)
}

func resourceIDFromFileURL(value string) string {
	return assets.IDFromFileURL(value)
}

func canvasResourceID(value string) string {
	return assets.ResourceID(value)
}

func validCanvasResourceID(value string) string {
	return assets.ValidID(value)
}
