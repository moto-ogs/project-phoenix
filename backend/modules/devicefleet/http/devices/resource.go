package devices

import (
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/moto-ogs/project-phoenix/modules/devicefleet"
)

// Resource defines the Devices API resource
type Resource struct {
	IoTService devicefleet.Administration
	runtime    Runtime
}

// NewResource creates a new Devices resource
func NewResource(iotService devicefleet.Administration, runtime Runtime) *Resource {
	if runtime.Now == nil {
		panic("device routes: the clock is required")
	}
	if runtime.ActiveSession == nil || runtime.ConflictWithDetails == nil || runtime.AuditRemoval == nil {
		panic("device routes: the removal guard, its conflict answer and its audit are required")
	}
	if runtime.AuditStatusChange == nil {
		panic("device routes: the status change audit is required")
	}
	if runtime.History == nil || runtime.Actor == nil || runtime.ActorNames == nil {
		panic("device routes: the device history and the acting account are required")
	}
	return &Resource{
		IoTService: iotService,
		runtime:    runtime,
	}
}

// Router returns a configured router for device management endpoints
// This router is mounted under /iot/ and handles all device CRUD operations
// All routes require JWT authentication with appropriate IOT permissions
func (rs *Resource) Router() chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))

	// Reading the devices and the Geräteplätze requires devices:read; every
	// device-management action requires devices:manage (#2312).
	r.With(rs.runtime.Permission(permissionDevicesRead)).Get("/", rs.listDevices)
	r.With(rs.runtime.Permission(permissionDevicesRead)).Get("/{id}", rs.getDevice)
	r.With(rs.runtime.Permission(permissionDevicesRead)).Get("/{id}/history", rs.getDeviceHistory)
	r.With(rs.runtime.Permission(permissionDevicesRead)).Get("/device/{deviceId}", rs.getDeviceByDeviceID)
	r.With(rs.runtime.Permission(permissionDevicesRead)).Get("/type/{type}", rs.getDevicesByType)
	r.With(rs.runtime.Permission(permissionDevicesRead)).Get("/status/{status}", rs.getDevicesByStatus)
	r.With(rs.runtime.Permission(permissionDevicesRead)).Get("/registered-by/{personId}", rs.getDevicesByRegisteredBy)
	r.With(rs.runtime.Permission(permissionDevicesRead)).Get("/active", rs.getActiveDevices)
	r.With(rs.runtime.Permission(permissionDevicesRead)).Get("/maintenance", rs.getDevicesRequiringMaintenance)
	r.With(rs.runtime.Permission(permissionDevicesRead)).Get("/offline", rs.getOfflineDevices)
	r.With(rs.runtime.Permission(permissionDevicesRead)).Get("/statistics", rs.getDeviceStatistics)
	r.With(rs.runtime.Permission(permissionDevicesRead)).Get("/device-slots", rs.getDeviceSlots)

	r.With(rs.runtime.Permission(permissionDevicesManage)).Post("/", rs.createDevice)
	r.With(rs.runtime.Permission(permissionDevicesManage)).Put("/{id}", rs.updateDevice)
	r.With(rs.runtime.Permission(permissionDevicesManage)).Delete("/{id}", rs.deleteDevice)
	r.With(rs.runtime.Permission(permissionDevicesManage)).Patch("/{deviceId}/status", rs.updateDeviceStatus)
	r.With(rs.runtime.Permission(permissionDevicesManage)).Post("/{deviceId}/ping", rs.pingDevice)

	r.With(rs.runtime.Permission(permissionDevicesManage)).Post("/detect-new", rs.detectNewDevices)
	r.With(rs.runtime.Permission(permissionDevicesManage)).Post("/scan-network", rs.scanNetwork)

	return r
}
