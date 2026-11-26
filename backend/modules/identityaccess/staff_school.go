package identityaccess

// PersonStaffRecord is the school of one staff record of a person.
type PersonStaffRecord struct {
	PersonID int64
	SchoolID int64
}

// StaffSchoolByPerson is the school of each person's staff record. When a
// read lists several records for one person, the first one counts.
func StaffSchoolByPerson(records []PersonStaffRecord) map[int64]int64 {
	schools := make(map[int64]int64, len(records))
	for _, record := range records {
		if _, found := schools[record.PersonID]; !found {
			schools[record.PersonID] = record.SchoolID
		}
	}
	return schools
}

// StaffRecordCountsAtSchool reports whether a person's staff record backs the
// account at school: a found record counts only at the school it belongs
// to, so a record of another school never lends the account staff or
// caregiver facts here.
func StaffRecordCountsAtSchool(found bool, recordSchoolID, schoolID int64) bool {
	return found && recordSchoolID == schoolID
}
