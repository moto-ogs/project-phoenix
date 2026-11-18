package carecontracthttp

// schoolFilterLabel names the schools of an export in its head (#4718).
func schoolFilterLabel(schoolID int64, schoolName string) string {
	switch {
	case schoolID == 0:
		return "Alle Schulen"
	case schoolName == "":
		return "Schule: ausgewählte Schule"
	default:
		return "Schule: " + schoolName
	}
}
