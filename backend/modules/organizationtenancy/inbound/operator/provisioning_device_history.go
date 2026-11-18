package operator

import (
	"net/http"
	"strconv"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
)

// deviceHistoryChange is one value before and after; null where it did not
// exist.
type deviceHistoryChange struct {
	Before *string `json:"before"`
	After  *string `json:"after"`
}

// deviceHistoryResponse is one change of a device for the operator (#2321).
type deviceHistoryResponse struct {
	ID         string                         `json:"id"`
	Action     string                         `json:"action"`
	ActorKind  string                         `json:"actor_kind"`
	Changes    map[string]deviceHistoryChange `json:"changes"`
	OccurredAt time.Time                      `json:"occurred_at"`
	SchoolID   string                         `json:"school_id"`
	SchoolName string                         `json:"school_name"`
}

// DeviceHistory answers the history of one device across the schools it
// went through, newest first (#2321).
func (rs *ProvisioningResource) DeviceHistory(w http.ResponseWriter, r *http.Request) {
	deviceID, ok := common.ParseInt64IDWithError(w, r, "id", invalidDeviceIDMessage)
	if !ok {
		return
	}
	if rs.deviceHistory == nil {
		common.RenderError(w, r, common.OperatorInternal(internalErrorMessage))
		return
	}
	entries, err := rs.deviceHistory.DeviceHistory(r.Context(), deviceID)
	if err != nil {
		common.RenderError(w, r, ProvisioningErrorRenderer(err))
		return
	}
	response := make([]deviceHistoryResponse, 0, len(entries))
	for _, entry := range entries {
		response = append(response, newDeviceHistoryResponse(entry))
	}
	common.Respond(w, r, http.StatusOK, response, "Device history retrieved successfully")
}

func newDeviceHistoryResponse(entry organizationtenancy.DeviceHistoryEntry) deviceHistoryResponse {
	changes := make(map[string]deviceHistoryChange, len(entry.Changes))
	for field, change := range entry.Changes {
		changes[field] = deviceHistoryChange{Before: change.Before, After: change.After}
	}
	return deviceHistoryResponse{
		ID: strconv.FormatInt(entry.ID, 10), Action: entry.Action, ActorKind: entry.ActorKind,
		Changes: changes, OccurredAt: entry.OccurredAt,
		SchoolID: strconv.FormatInt(entry.SchoolID, 10), SchoolName: entry.SchoolName,
	}
}
