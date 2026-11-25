package handler

import (
	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func registerCanvasFolderRoutes(r *gin.RouterGroup, svc *service.Service) {
	endpoint := func(run func(c *gin.Context, ownerKey string) (any, error)) gin.HandlerFunc {
		return func(c *gin.Context) {
			ownerKey, err := currentContentKey(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			data, err := run(c, ownerKey)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, data)
		}
	}
	type folderName struct {
		Name string `json:"name"`
	}
	r.GET("/canvas-folders", endpoint(func(_ *gin.Context, ownerKey string) (any, error) {
		folders, err := svc.CanvasFolders(ownerKey)
		return gin.H{"folders": folders}, err
	}))
	r.POST("/canvas-folders", endpoint(func(c *gin.Context, ownerKey string) (any, error) {
		var req folderName
		if err := teamBody(c, &req, 4<<10); err != nil {
			return nil, err
		}
		folder, err := svc.CreateCanvasFolder(ownerKey, req.Name)
		return gin.H{"folder": folder}, err
	}))
	r.PATCH("/canvas-folders/:id", endpoint(func(c *gin.Context, ownerKey string) (any, error) {
		var req folderName
		if err := teamBody(c, &req, 4<<10); err != nil {
			return nil, err
		}
		id := c.Param("id")
		return gin.H{"id": id}, svc.RenameCanvasFolder(ownerKey, id, req.Name)
	}))
	r.DELETE("/canvas-folders/:id", endpoint(func(c *gin.Context, ownerKey string) (any, error) {
		id := c.Param("id")
		return gin.H{"id": id}, svc.DeleteCanvasFolder(ownerKey, id)
	}))
	r.POST("/canvas-folders/move", endpoint(func(c *gin.Context, ownerKey string) (any, error) {
		var req struct {
			FolderID  *string  `json:"folderId"`
			CanvasIDs []string `json:"canvasIds"`
		}
		if err := teamBody(c, &req, 128<<10); err != nil {
			return nil, err
		}
		if req.FolderID == nil {
			return nil, service.BadAuthRequest("请选择目标文件夹")
		}
		return gin.H{"folderId": *req.FolderID}, svc.MoveCanvasProjectsToFolder(ownerKey, *req.FolderID, req.CanvasIDs)
	}))
}
