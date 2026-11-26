package records

// Regular opening hours of a school (#7654): one opening and one closing
// clock time per school day, Monday to Friday. Empty means the school has
// not entered that time. A day with other hours (schedule.opening_changes,
// School Calendar) replaces them on that day.
//
// Ten optional time settings instead of a list: the registry has no list
// type, and the school week has five days.
const (
	OpeningHoursOpen  = "open"
	OpeningHoursClose = "close"
)

// OpeningHoursWeekdays are the school days that carry opening hours, in
// week order; the value is the key segment.
var OpeningHoursWeekdays = []string{"monday", "tuesday", "wednesday", "thursday", "friday"}

// OpeningHoursKey returns the setting key of one weekday's opening or
// closing time, e.g. "opening_hours.monday_open". weekday is a value of
// OpeningHoursWeekdays and edge OpeningHoursOpen or OpeningHoursClose;
// other values have no definition.
func OpeningHoursKey(weekday, edge string) string {
	return "opening_hours." + weekday + "_" + edge
}
