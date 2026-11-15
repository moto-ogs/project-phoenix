package api

import "fmt"

// possiblyEnrolledStudentIndex is the demo child (Lena Hofmann, Klasse 1b)
// whose family submits the public form again (#6053). No other seed step
// enrolls her, so her request stays open and the office sees that she may
// already be enrolled.
const possiblyEnrolledStudentIndex = 13

// laterSeedSubmissions are the requests submitted after the public demo
// requests: the third demo parent's request through the parent portal, the
// public request for a child the school already cares for, and the same new
// child enrolled by both parents.
func (s parentEnrollmentSeedStep) laterSeedSubmissions(
	rt *Runtime, phaseID int64, offerings map[string]int64,
	parents []ParentCredentials, parentAuths map[string]AuthRef,
) ([]enrollmentSubmission, error) {
	var submissions []enrollmentSubmission
	if len(parents) > 2 {
		parent := parents[2]
		submissions = append(submissions, enrollmentSubmission{
			source: "parent",
			auth:   parentAuths[parent.Email],
			path:   "/parent/enrollments/" + rt.Bootstrap.TenantSlug + "/submit",
			body: withDemoCoGuardian(s.enrollmentSubmissionWithDays(phaseID, offerings, "Lina", "Amini", "2019-02-14", 1,
				"Shirin", "Amini", parent.Email, "parent-authenticated",
				[]int64{offerings["ogs-ganztag"], offerings["mittagessen"]}, map[int64][]string{
					offerings["ogs-ganztag"]: {"mon", "tue", "wed", "thu"},
					offerings["mittagessen"]: {"mon", "tue", "wed", "thu"},
				},
			), scopedEmail("reza.amini@email.de", rt.FixedSeeder.accountScope)),
			status: "approved",
			reason: "Zusage: vier Betreuungstage",
		})
	}
	possiblyEnrolled, err := s.possiblyEnrolledSubmission(rt, phaseID, offerings)
	if err != nil {
		return nil, err
	}
	submissions = append(submissions, possiblyEnrolled)
	return append(submissions, s.enrolledTwiceSubmissions(rt, phaseID, offerings)...), nil
}

// enrolledTwiceSubmissions are two public requests for the same new child
// from its mother and its father, each with an own address (#6247). The
// first is approved and creates the child. The second stays open: the office
// sees that the phase already holds the child through the first request.
func (s parentEnrollmentSeedStep) enrolledTwiceSubmissions(rt *Runtime, phaseID int64, offerings map[string]int64) []enrollmentSubmission {
	submission := func(guardianFirstName, email, key, status, reason string) enrollmentSubmission {
		return enrollmentSubmission{
			source: "public",
			key:    key,
			path:   "/api/enrollment/" + rt.Bootstrap.TenantSlug + "/submit",
			body: s.enrollmentSubmissionWithDays(phaseID, offerings, "Mia", "Kaya", "2020-05-09", 1,
				guardianFirstName, "Kaya", scopedEmail(email, rt.FixedSeeder.accountScope), key,
				[]int64{offerings["ogs-ganztag"], offerings["mittagessen"]}, map[int64][]string{
					offerings["ogs-ganztag"]: {"mon", "tue", "wed", "thu", "fri"},
					offerings["mittagessen"]: {"mon", "tue", "wed", "thu", "fri"},
				},
			),
			status: status,
			reason: reason,
		}
	}
	return []enrollmentSubmission{
		submission("Derya", "derya.kaya@example.test", "enrolled-twice-first", "approved", "Zusage: Ganztag an fünf Tagen"),
		submission("Emre", "emre.kaya@example.test", "enrolled-twice-second", "", ""),
	}
}

// possiblyEnrolledSubmission is the public request of a child the school
// already cares for, with the child's name and birthday (#6053). It stays
// open: before approving, the office chooses the enrolled child or a new one.
func (s parentEnrollmentSeedStep) possiblyEnrolledSubmission(rt *Runtime, phaseID int64, offerings map[string]int64) (enrollmentSubmission, error) {
	if possiblyEnrolledStudentIndex >= len(DemoStudents) {
		return enrollmentSubmission{}, fmt.Errorf("demo child %d does not exist", possiblyEnrolledStudentIndex)
	}
	student := DemoStudents[possiblyEnrolledStudentIndex]
	grade, err := demoClassGrade(student.Class)
	if err != nil {
		return enrollmentSubmission{}, fmt.Errorf("demo child %s %s has no grade in class %q", student.FirstName, student.LastName, student.Class)
	}
	birthday := demoStudentBirthday(possiblyEnrolledStudentIndex, student, rt.FixedSeeder.seedDay)
	return enrollmentSubmission{
		source: "public",
		key:    "possibly-enrolled",
		path:   "/api/enrollment/" + rt.Bootstrap.TenantSlug + "/submit",
		body: s.enrollmentSubmissionWithDays(phaseID, offerings, student.FirstName, student.LastName, birthday, int16(grade),
			"Sabine", student.LastName, scopedEmail("sabine.wiederanmeldung@example.test", rt.FixedSeeder.accountScope), "possibly-enrolled",
			[]int64{offerings["ogs-kurz"], offerings["mittagessen"]}, map[int64][]string{
				offerings["ogs-kurz"]:    {"mon", "wed"},
				offerings["mittagessen"]: {"mon", "wed"},
			},
		),
	}, nil
}
