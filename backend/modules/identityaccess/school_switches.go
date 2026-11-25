package identityaccess

// SchoolSwitches are the school's settings the signed-in app shell reads
// outside the settings page (#4996): the navigation, the Elternzugänge page
// and the Betreuungsplan read them from GET /api/me/navigation instead of
// loading the whole settings schema. They are signed-in context only; the
// public tenant resolve never carries them. The root renders them inside the
// navigation response, so the type is public (#7563).
type SchoolSwitches struct {
	ParentNewsEnabled     bool   `json:"parent_news_enabled"`
	ParentInviteMode      string `json:"parent_invite_mode"`
	TimetableDayStartTime string `json:"timetable_day_start_time"`
	TimetableDayEndTime   string `json:"timetable_day_end_time"`
}

// NavigationResponse carries the staff record and school switches read by
// the shell. The staff record is absent for a caller without a staff profile.
type NavigationResponse[Staff any] struct {
	CurrentStaff   Staff          `json:"current_staff"`
	SchoolSwitches SchoolSwitches `json:"school_switches"`
}
