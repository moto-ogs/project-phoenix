package enrollmenthttp

import "github.com/moto-ogs/project-phoenix/sharedkernel/ident"

type UploadContentDetails struct {
	Filename string `json:"filename"`
}

type UploadRefusalDetails struct {
	MaxMB        int       `json:"max_mb"`
	AllowedTypes *[]string `json:"allowed_types,omitempty"`
}

type HolidayProofLimitDetails struct {
	MaxFiles int `json:"max_files"`
}

type HolidayAllocationDetails struct {
	WeekID ident.ID `json:"week_id"`
}
