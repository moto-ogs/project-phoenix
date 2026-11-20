package api

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
)

// familiesWithoutApp are the demo children whose families stay without the
// parents app: the re-enrollment overview (#3379) shows a family that can
// only be reached by phone, and "Neue Nachricht" shows the hint that a child
// has no parent access. Both need a real example, not a whole school of them.
var familiesWithoutApp = map[int]bool{24: true, 48: true}

// openInvitationsKept is how many parents of approved online enrollments keep
// their invitation open: the school still sees one waiting for an answer.
const openInvitationsKept = 2

// seedFamilyAppAccountsStep gives one parent of every other demo child an
// account in the parents app, and lets the parents of approved online
// enrollments accept an invitation. Before, only the six
// scripted parents had one, so "Neue Nachricht" offered no recipient for
// almost every child (#3894). The accounts only exist; the scripted parents
// stay the ones who act.
type seedFamilyAppAccountsStep struct {
	seeder *Seeder
}

func (seedFamilyAppAccountsStep) Name() string { return "Seeding parent app accounts" }

func (s seedFamilyAppAccountsStep) Run(ctx context.Context, rt *Runtime) error {
	if rt.FixedSeeder == nil {
		return fmt.Errorf("demo guardians not available")
	}
	adminAuth, err := rt.Adapter.LoginTenant(ctx, rt.Bootstrap.AdminEmail, rt.Bootstrap.AdminPassword, rt.Bootstrap.TenantSlug)
	if err != nil {
		return fmt.Errorf("login seed school admin: %w", err)
	}
	rt.SetTenantAuth(adminAuth)
	step := parentEnrollmentSeedStep(s)
	password, err := step.parentPassword()
	if err != nil {
		return err
	}
	guardians, err := familyAppGuardianIndexes(rt.FixedSeeder.guardianIDs, rt.Parents)
	if err != nil {
		return err
	}
	invitations, err := enrollmentInvitationsToAccept(rt, adminAuth)
	if err != nil {
		return err
	}
	if err := createFamilyAccounts(rt, step, adminAuth, guardians, password); err != nil {
		return err
	}
	// The approval's own link is stored as hash only (#4902) and reaches
	// nobody but the parent's mailbox: the seeder accepts a fresh invitation
	// of the same guardian, issued through the seed-only token exposure.
	if err := forEachParallel(rt, invitations, func(worker *Runtime, _ int, guardianID int64) error {
		token, err := step.inviteGuardian(worker, adminAuth, guardianID)
		if err != nil {
			return fmt.Errorf("invite guardian %d: %w", guardianID, err)
		}
		if _, err := step.acceptGuardianInvitation(worker, token, password); err != nil {
			return fmt.Errorf("accept guardian invitation %d: %w", guardianID, err)
		}
		return nil
	}); err != nil {
		return err
	}
	if err := seedFurtherWaitlistedCourseRequests(ctx, rt, password); err != nil {
		return err
	}
	fmt.Printf("  %d parent app accounts created\n", len(guardians)+len(invitations))
	return nil
}

// createFamilyAccounts invites and accepts an account for each guardian, in
// parallel, and keeps the credentials of those with full parent rights in
// the runtime, in guardian order.
func createFamilyAccounts(rt *Runtime, step parentEnrollmentSeedStep, adminAuth AuthRef, guardians []int, password string) error {
	rt.FamilyAccounts = rt.FamilyAccounts[:0]
	accounts := make([]ParentCredentials, len(guardians))
	withRights := make([]bool, len(guardians))
	err := forEachParallel(rt, guardians, func(worker *Runtime, position, index int) error {
		guardianID := rt.FixedSeeder.guardianIDs[demoGuardianKey(DemoGuardians[index])]
		token, err := step.inviteGuardian(worker, adminAuth, guardianID)
		if err != nil {
			return fmt.Errorf("invite guardian %d: %w", guardianID, err)
		}
		accountID, err := step.acceptGuardianInvitation(worker, token, password)
		if err != nil {
			return fmt.Errorf("accept guardian invitation %d: %w", guardianID, err)
		}
		accounts[position], withRights[position] = familyAccount(worker, index, guardianID, accountID, password)
		return nil
	})
	for position, account := range accounts {
		if withRights[position] {
			rt.FamilyAccounts = append(rt.FamilyAccounts, account)
		}
	}
	return err
}

// familyAccount returns the credentials of a family app account, so later
// steps can act as the family. A guardian of siblings reaches all of them.
// Guardians with a limited role (pickup only, custom) have an account but no
// full parent rights; they stay out.
func familyAccount(rt *Runtime, guardianIndex int, guardianID, accountID int64, password string) (ParentCredentials, bool) {
	guardian := DemoGuardians[guardianIndex]
	studentIDs, err := demoGuardianStudentIDs(rt.FixedSeeder.studentIDByIndex, guardianIndex)
	if demoGuardianHasLimitedRole(guardianIndex) || err != nil || len(studentIDs) == 0 {
		return ParentCredentials{}, false
	}
	return ParentCredentials{
		Email:      scopedEmail(guardian.Email, rt.FixedSeeder.accountScope),
		Password:   password,
		Name:       guardian.FirstName + " " + guardian.LastName,
		AccountID:  accountID,
		GuardianID: guardianID,
		StudentIDs: studentIDs,
	}, true
}

// familyAppGuardianIndexes returns the DemoGuardians index of the primary
// guardian of each demo child whose family has no app account yet, in
// DemoStudents order, leaving out familiesWithoutApp. A guardian of siblings
// is listed once, with the index of their first child.
func familyAppGuardianIndexes(guardianIDs map[string]int64, parents []ParentCredentials) ([]int, error) {
	withAccount := make(map[int64]bool, len(parents))
	for _, parent := range parents {
		withAccount[parent.GuardianID] = true
	}
	covered := map[int]bool{}
	for _, guardian := range DemoGuardians {
		if withAccount[guardianIDs[guardian.FirstName+" "+guardian.LastName]] {
			covered[guardian.StudentIndex] = true
		}
	}
	result := make([]int, 0, len(DemoStudents))
	listed := map[int64]bool{}
	for index, guardian := range DemoGuardians {
		if !guardian.IsPrimary || covered[guardian.StudentIndex] || familiesWithoutApp[guardian.StudentIndex] {
			continue
		}
		key := demoGuardianKey(guardian)
		guardianID, ok := guardianIDs[key]
		if !ok || guardianID == 0 {
			return nil, fmt.Errorf("guardian %s was not created", key)
		}
		if !listed[guardianID] {
			listed[guardianID] = true
			result = append(result, index)
		}
		covered[guardian.StudentIndex] = true
	}
	return result, nil
}

// enrollmentInvitationsToAccept returns the guardians with a redeemable
// invitation who get an account, keeping two guardians' invitations open for
// the demo overview. It reads them where the school sees them: the guardian
// list of each child marks an open invitation as "pending".
func enrollmentInvitationsToAccept(rt *Runtime, auth AuthRef) ([]int64, error) {
	studentIDs, err := listSchoolStudentIDs(rt, auth)
	if err != nil {
		return nil, err
	}
	pending := map[int64]bool{}
	for _, studentID := range studentIDs {
		raw, err := rt.Client.GetWithAuth(auth, fmt.Sprintf("/api/guardians/students/%d/guardians", studentID))
		if err != nil {
			return nil, fmt.Errorf("list guardians of student %d: %w", studentID, err)
		}
		var resp struct {
			Data []struct {
				Guardian struct {
					ID json.Number `json:"id"`
				} `json:"guardian"`
				AccountStatus string `json:"account_status"`
			} `json:"data"`
		}
		if err := parseJSON(raw, &resp); err != nil {
			return nil, fmt.Errorf("parse guardians of student %d: %w", studentID, err)
		}
		for _, row := range resp.Data {
			if row.AccountStatus != "pending" {
				continue
			}
			guardianID, err := row.Guardian.ID.Int64()
			if err != nil {
				return nil, fmt.Errorf("parse guardian of student %d: %w", studentID, err)
			}
			pending[guardianID] = true
		}
	}
	guardianIDs := slices.Sorted(maps.Keys(pending))
	if len(guardianIDs) <= openInvitationsKept {
		return []int64{}, nil
	}
	return guardianIDs[openInvitationsKept:], nil
}

// listSchoolStudentIDs reads the school's administrative child list, including
// children whose care has not started yet.
func listSchoolStudentIDs(rt *Runtime, auth AuthRef) ([]int64, error) {
	var ids []int64
	for page := 1; ; page++ {
		raw, err := rt.Client.GetWithAuth(auth, fmt.Sprintf("/api/students?page=%d&page_size=500&include_pending_withdrawals=true", page))
		if err != nil {
			return nil, fmt.Errorf("list students: %w", err)
		}
		var resp struct {
			Data []struct {
				ID json.Number `json:"id"`
			} `json:"data"`
			Pagination struct {
				TotalPages int `json:"total_pages"`
			} `json:"pagination"`
		}
		if err := parseJSON(raw, &resp); err != nil {
			return nil, fmt.Errorf("parse students: %w", err)
		}
		for _, row := range resp.Data {
			id, err := row.ID.Int64()
			if err != nil {
				return nil, fmt.Errorf("parse student id %q: %w", row.ID, err)
			}
			ids = append(ids, id)
		}
		if len(resp.Data) == 0 || page >= resp.Pagination.TotalPages {
			return ids, nil
		}
	}
}
