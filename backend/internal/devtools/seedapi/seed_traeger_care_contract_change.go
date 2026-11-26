package api

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedCareContractChange lets the parents of the first active contract
// whose party has a parents-app account ask to give up the last weekday of
// one module they choose the days of (#5979) and keep the others (#6334). The Träger-Büro then finds an open change on the contract
// page that it can approve or reject itself. It answers whether it asked;
// a seed without such a contract asks nothing.
func seedCareContractChange(rt *Runtime, auth AuthRef) (bool, error) {
	raw, err := rt.Client.GetWithAuth(auth, "/traeger/contracts/?status=aktiv")
	if err != nil {
		return false, fmt.Errorf("list the active care contracts: %w", err)
	}
	var list struct {
		Data struct {
			Contracts []struct {
				ID         ident.ID  `json:"id"`
				PartyEmail string    `json:"party_email"`
				StudentID  *ident.ID `json:"student_id"`
			} `json:"contracts"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &list); err != nil {
		return false, err
	}
	for _, contract := range list.Data.Contracts {
		parent, ok := seedParentByEmail(rt, contract.PartyEmail)
		if !ok || contract.StudentID == nil || !slices.Contains(parent.StudentIDs, int64(*contract.StudentID)) {
			continue
		}
		parentAuth, err := rt.Client.adapter.LoginParent(context.Background(), parent.Email, parent.Password)
		if err != nil {
			return false, fmt.Errorf("sign in the parents of contract %d: %w", contract.ID, err)
		}
		return seedOneDayLess(rt, parentAuth, int64(*contract.StudentID))
	}
	return false, nil
}

func seedParentByEmail(rt *Runtime, email string) (ParentCredentials, bool) {
	for _, parent := range slices.Concat(rt.FamilyAccounts, rt.Parents) {
		if email != "" && strings.EqualFold(parent.Email, email) {
			return parent, true
		}
	}
	return ParentCredentials{}, false
}

// seedOneDayLess asks for the child's booked modules without the last
// weekday of the first module whose days the parents choose, from the
// earliest day the school allows. Every other module stays as it is, so the
// office sees a change next to modules that stay booked.
func seedOneDayLess(rt *Runtime, parentAuth AuthRef, studentID int64) (bool, error) {
	raw, err := rt.Client.GetWithAuth(parentAuth, fmt.Sprintf("/parent/me/children/%d/care-offerings/catalog", studentID))
	if err != nil {
		return false, fmt.Errorf("read the care offerings of child %d: %w", studentID, err)
	}
	var catalog struct {
		Data struct {
			EarliestEffectiveFrom string `json:"earliest_effective_from"`
			Items                 []struct {
				ID             string   `json:"id"`
				DaysOfWeekMode string   `json:"days_of_week_mode"`
				Selected       bool     `json:"selected"`
				SelectedDays   []string `json:"selected_days"`
				Automatic      bool     `json:"automatic"`
			} `json:"items"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &catalog); err != nil {
		return false, err
	}
	selections := []map[string]any{}
	changed := false
	for _, item := range catalog.Data.Items {
		if !item.Selected || item.Automatic {
			continue
		}
		days := slices.Clone(item.SelectedDays)
		if !changed && item.DaysOfWeekMode == "parent_choice" && len(days) > 1 {
			days, changed = days[:len(days)-1], true
		}
		selections = append(selections, map[string]any{"offering_id": item.ID, "selected_days": days})
	}
	if !changed || catalog.Data.EarliestEffectiveFrom == "" {
		return false, nil
	}
	if _, err := rt.Client.PostWithAuth(parentAuth, fmt.Sprintf("/parent/me/children/%d/care-offerings/requests", studentID), map[string]any{
		"offerings": selections, "effective_from": catalog.Data.EarliestEffectiveFrom,
		"note": "An diesem Tag holen wir unser Kind künftig mittags ab.",
	}); err != nil {
		return false, fmt.Errorf("ask for one day less for child %d: %w", studentID, err)
	}
	return true, nil
}

// seedCareContractSchoolChange lets the school take one weekday off a module
// of a child whose contract is active, without a request of the parents
// (#4816). The Worker then gives the contract a version that waits for the
// parents' signature: the Träger-Büro finds „Änderung wartet auf
// Unterschrift“ in its list, and the parents the change to sign under
// „Dokumente“. It answers whether it changed a booking; a seed with a
// contract whose change waits already, or without a fitting contract,
// changes nothing.
func seedCareContractSchoolChange(rt *Runtime, auth AuthRef) (bool, error) {
	raw, err := rt.Client.GetWithAuth(auth, "/traeger/contracts/?status=aktiv")
	if err != nil {
		return false, fmt.Errorf("list the active care contracts: %w", err)
	}
	var list struct {
		Data struct {
			Contracts []struct {
				RequestChildID        *ident.ID `json:"request_child_id"`
				ChangeAwaitsSignature bool      `json:"change_awaits_signature"`
			} `json:"contracts"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &list); err != nil {
		return false, err
	}
	children := []int64{}
	for _, contract := range list.Data.Contracts {
		if contract.ChangeAwaitsSignature {
			return false, nil
		}
		if contract.RequestChildID != nil {
			children = append(children, int64(*contract.RequestChildID))
		}
	}
	for _, request := range rt.Enrollment.Requests {
		for _, childID := range request.ChildIDs {
			if !slices.Contains(children, childID) {
				continue
			}
			changed, err := seedSchoolTakesOneDay(rt, request.RequestID, childID)
			if err != nil || changed {
				return changed, err
			}
		}
	}
	return false, nil
}

// seedSchoolTakesOneDay books the child's offerings again from in two weeks
// without the last weekday of the first offering with at least two chosen
// days, as the school's correction editor does. It answers false for a
// child without such an offering.
func seedSchoolTakesOneDay(rt *Runtime, requestID, childID int64) (bool, error) {
	raw, err := rt.Client.GetWithAuth(rt.TenantAuth, fmt.Sprintf("/api/enrollment/admin/requests/%d", requestID))
	if err != nil {
		return false, fmt.Errorf("read enrollment request %d: %w", requestID, err)
	}
	var detail struct {
		Data struct {
			Children []struct {
				ID        ident.ID `json:"id"`
				Offerings []struct {
					OfferingID   string   `json:"offering_id"`
					SelectedDays []string `json:"selected_days"`
				} `json:"offerings"`
			} `json:"children"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &detail); err != nil {
		return false, err
	}
	for _, child := range detail.Data.Children {
		if int64(child.ID) != childID {
			continue
		}
		offerings, changed := []map[string]any{}, false
		for _, offering := range child.Offerings {
			days := slices.Clone(offering.SelectedDays)
			if !changed && len(days) > 1 {
				days, changed = days[:len(days)-1], true
			}
			booked := map[string]any{"offering_id": offering.OfferingID}
			if len(days) > 0 {
				booked["selected_days"] = days
			}
			offerings = append(offerings, booked)
		}
		if !changed {
			return false, nil
		}
		if _, err := putReadChildOfferings(rt, rt.TenantAuth, requestID, childID, map[string]any{
			"offerings": offerings, "reason": "Die Gruppe ist an diesem Tag voll",
			"effective_from": todaySeedDate().AddDays(14).String(),
		}); err != nil {
			return false, fmt.Errorf("take one day off the care of child %d: %w", childID, err)
		}
		return true, nil
	}
	return false, nil
}
