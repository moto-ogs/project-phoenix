package records

// What the child cards show besides name and status (Betrieb › Kinderkarte
// und Fotos).
//
//   - KeyStudentPhotosEnabled: the child's photo on the card.
//   - KeyStudentCardActivitiesEnabled: the day's planned offerings on the
//     child cards under "Gruppen", "Alle Kinder" and "Aktuelle Aufsicht"
//     (#6487, #8194).
const (
	KeyStudentPhotosEnabled         = "operations.student_photos_enabled"
	KeyStudentCardActivitiesEnabled = "operations.student_card_activities_enabled"
)
