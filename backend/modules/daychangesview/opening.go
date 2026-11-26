package daychangesview

// The opening changes of the day in the overview (#8170).

// DayOpening is an opening change of the day (#8170). Name is the school's
// own name for it ("Zeugnistag"), OpensAt and ClosesAt the school's wall
// clock ("15:04").
type DayOpening struct {
	Name     string `json:"name"`
	OpensAt  string `json:"opens_at"`
	ClosesAt string `json:"closes_at"`
	// RegularPickupAfterClosing is the child's weekly pickup time ("15:04")
	// when it lies after ClosesAt (#8173), set by the child's day only. The
	// projection drops it when the child's day has its own pickup or absence.
	// Not on the staff wire: the staff portal is #8172.
	RegularPickupAfterClosing *string `json:"-"`
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
	dropRegularPickupsBesideDayChanges(entries)
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

// dropRegularPickupsBesideDayChanges keeps the weekly pickup conflict only
// on a day without a pickup change, absence or going-home-alone entry of the
// child (#8173): those replace the weekly pickup.
func dropRegularPickupsBesideDayChanges(entries []Entry) {
	for _, entry := range entries {
		if entry.Kind != KindChildPickupChanged && entry.Kind != KindChildAbsent &&
			entry.Kind != KindChildGoesAlone {
			continue
		}
		for i := range entries {
			if entries[i].Opening != nil {
				entries[i].Opening.RegularPickupAfterClosing = nil
			}
		}
		return
	}
}
