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

// NavigationResponse is the wire of GET /api/me/navigation (#7563): the
// caller's educational groups, the room sessions they supervise and their
// staff record, as the owners of those rows render them, with the school
// switches. The root loads the rows and names their types. The fields stand
// in the order of their keys: the route rendered a JSON object with sorted
// keys before it had a type, and keeps those bytes.
type NavigationResponse[Staff, Group, Session any] struct {
	CurrentStaff        *Staff         `json:"current_staff"`
	EducationalGroups   []Group        `json:"educational_groups"`
	Incomplete          bool           `json:"incomplete"`
	SchoolSwitches      SchoolSwitches `json:"school_switches"`
	SupervisedGroups    []Session      `json:"supervised_groups"`
	UnavailableSections []string       `json:"unavailable_sections"`
}
