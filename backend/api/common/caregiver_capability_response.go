package common

import (
	"errors"
	"net/http"
)

// CaregiverCapabilityDetails names the People Directory blockers without
// making the HTTP adapters depend on the owner's rows (#2736).
type CaregiverCapabilityDetails struct {
	Blockers []string `json:"blockers"`
}

func NewCaregiverCapabilityBlockedResponse(errorText string, blockers []string) *ErrResponse {
	return &ErrResponse{
		Err: errors.New(errorText), HTTPStatusCode: http.StatusConflict,
		Detail: errorText, Code: CodeProvisioningCaregiverCapabilityBlocked,
		Details: CaregiverCapabilityDetails{Blockers: blockers},
	}
}
