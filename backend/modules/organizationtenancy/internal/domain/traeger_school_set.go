package domain

// TraegerSchoolSet is a Träger as one statement reads it (#8146): whether it
// exists, whether it is active and undeleted, and its undeleted schools.
type TraegerSchoolSet struct {
	Found   bool
	Live    bool
	Schools []TraegerSchool
}

// TraegerSchool is one undeleted school of the set with its names.
type TraegerSchool struct {
	ID        int64
	Name      string
	Slug      string
	Subdomain string
	City      string
}
