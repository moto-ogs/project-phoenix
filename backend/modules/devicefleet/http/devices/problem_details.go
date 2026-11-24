package devices

import "github.com/moto-ogs/project-phoenix/sharedkernel/ident"

type SchoolDeviceSlotsDetails struct {
	Slots int `json:"device_slots"`
}

type DeviceInActiveSessionDetails struct {
	SessionID ident.ID `json:"session_id"`
	RoomID    ident.ID `json:"room_id"`
	StartedAt string   `json:"started_at"`
}
