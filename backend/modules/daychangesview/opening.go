package daychangesview

// The opening changes of the day in the overview (#8170).

// DayOpening is an opening change of the day (#8170). Name is the school's
// own name for it ("Zeugnistag"), OpensAt and ClosesAt the school's wall
// clock ("15:04").
type DayOpening struct {
	Name     string `json:"name"`
	OpensAt  string `json:"opens_at"`
	ClosesAt string `json:"closes_at"`
}

// markPickupsAfterClosing marks the changed pickups of the day after the
// earliest changed closing time (#8170). It reads nothing: both come from
// the answer, so a caller who does not see the opening change gets no mark.
// The wall-clock texts "15:04" compare as strings.
func markPickupsAfterClosing(entries []Entry) {
	closesAt := ""
	for _, entry := range entries {
		if entry.Kind == KindOpeningChanged && entry.Opening != nil && entry.Opening.ClosesAt != "" &&
			(closesAt == "" || entry.Opening.ClosesAt < closesAt) {
			closesAt = entry.Opening.ClosesAt
		}
	}
	if closesAt == "" {
		return
	}
	mark := func(kind Kind, child *Child) {
		if kind == KindChildPickupChanged && child != nil && child.PickupTime != nil && *child.PickupTime > closesAt {
			child.AfterClosing = true
		}
	}
	for i := range entries {
		mark(entries[i].Kind, entries[i].Child)
		if summary := entries[i].ChildSummary; summary != nil {
			for j := range summary.Items {
				mark(summary.Items[j].Kind, &summary.Items[j].Child)
			}
		}
	}
}
