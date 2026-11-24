package api

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedHolidayGuestPhotoConsentStep makes one holiday guest of the demo
// school a child of its home school with a photo consent (#4721): Ida Sommer
// is registered from the Demo-Schule Manuell, so her sheet at the demo
// school reads „Foto-Einwilligung liegt vor“. The other guests of that school are
// no children of it and read „Keine Foto-Einwilligung“. Without the second school of the
// Träger the step does nothing.
type seedHolidayGuestPhotoConsentStep struct{}

func (seedHolidayGuestPhotoConsentStep) Name() string {
	return "Seeding a holiday guest with a photo consent of its home school"
}

// seedHomePhotoChild is the holiday guest whose home school holds a photo
// consent; names and date of birth are those of her registration
// (seedTraegerChildDebtorNumbersStep).
var seedHomePhotoChild = struct{ first, last, birth string }{"Ida", "Sommer", "2019-05-14"}

func (seedHolidayGuestPhotoConsentStep) Run(ctx context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.Bootstrap == nil || rt.Adapter == nil {
		return fmt.Errorf("the holiday guest photo consent seed prerequisites are not available")
	}
	manual := rt.AdditionalProfiles[ManualProfileKey]
	if manual == nil || manual.Organization.ID != rt.Bootstrap.OrganizationID {
		fmt.Println("  Foto-Einwilligung: no second school of the Träger; no home school of a holiday guest")
		return nil
	}
	auth, err := rt.Adapter.LoginTenant(ctx, manual.Credentials.SchoolAdmin.Email, manual.Credentials.SchoolAdmin.Password, manual.School.TenantSlug)
	if err != nil {
		return fmt.Errorf("sign in the admin of the home school: %w", err)
	}
	return seedHomePhotoConsent(rt.Client, auth)
}

// seedHomePhotoConsent records a photo consent for the child at its home
// school; a repeated seed finds the child and creates no second one, which
// would leave the registration without a unique child.
func seedHomePhotoConsent(client *Client, auth AuthRef) error {
	studentID, groupID, err := seedHomePhotoChildFind(client, auth)
	if err != nil {
		return err
	}
	if studentID == 0 && groupID == 0 {
		fmt.Println("  Foto-Einwilligung: the home school has no child in a group; no child with a photo consent")
		return nil
	}
	if studentID == 0 {
		if studentID, err = seedHomePhotoChildCreate(client, auth, groupID); err != nil {
			return err
		}
	}
	// A photo consent needs child photos switched on, and switching them off
	// ends every consent (#7208): the home school keeps them on.
	if _, err := client.PutWithAuth(auth, "/api/settings/values/"+profileSettingStudentPhotos, map[string]any{"value": true}); err != nil {
		return fmt.Errorf("switch child photos on at the home school: %w", err)
	}
	path := fmt.Sprintf("/api/students/%d", studentID)
	version, err := readDataVersion(func(path string) ([]byte, error) { return client.GetWithAuth(auth, path) }, path)
	if err != nil {
		return err
	}
	if _, err := client.PutWithAuth(auth, path, map[string]any{"photo_consent_given": true, "expected_version": version}); err != nil {
		return fmt.Errorf("record the photo consent at the home school: %w", err)
	}
	// Her home school also stops room history and mood (#8037): the hosting
	// school reads that stop for its guest. Stopping a stopped child changes
	// nothing, so a repeated seed is safe.
	if _, err := client.PutWithAuth(auth, path+"/room-history-stop", map[string]any{}); err != nil {
		return fmt.Errorf("stop the room history at the home school: %w", err)
	}
	fmt.Printf("  Foto-Einwilligung: %s %s has a photo consent and a room history stop at her home school\n", seedHomePhotoChild.first, seedHomePhotoChild.last)
	return nil
}

// seedHomePhotoChildFind reads the children of the home school: the child,
// zero when the school does not have her yet, and the group of its first
// child, which a new child joins.
func seedHomePhotoChildFind(client *Client, auth AuthRef) (studentID, groupID int64, err error) {
	raw, err := client.GetWithAuth(auth, "/api/students?page=1&page_size=100")
	if err != nil {
		return 0, 0, fmt.Errorf("read the children of the home school: %w", err)
	}
	var students struct {
		Data []struct {
			ID        ident.ID `json:"id"`
			FirstName string   `json:"first_name"`
			LastName  string   `json:"last_name"`
			GroupID   ident.ID `json:"group_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &students); err != nil {
		return 0, 0, fmt.Errorf("decode the children of the home school: %w", err)
	}
	for _, student := range students.Data {
		if student.FirstName == seedHomePhotoChild.first && student.LastName == seedHomePhotoChild.last {
			studentID = int64(student.ID)
		}
		if groupID == 0 {
			groupID = int64(student.GroupID)
		}
	}
	return studentID, groupID, nil
}

// seedHomePhotoChildCreate makes the holiday guest a child of its home school.
func seedHomePhotoChildCreate(client *Client, auth AuthRef, groupID int64) (int64, error) {
	child := seedHomePhotoChild
	raw, err := client.PostWithAuth(auth, "/api/students", map[string]any{
		"first_name": child.first, "last_name": child.last, "school_class": "Klasse 1a",
		"group_id": ident.ID(groupID), "birthday": child.birth, "pickup_status": "pickup",
	})
	if err != nil {
		return 0, fmt.Errorf("create the child with a photo consent at its home school: %w", err)
	}
	studentID, err := decodeSeedEntityID(raw)
	if err != nil {
		return 0, fmt.Errorf("read the child with a photo consent: %w", err)
	}
	return studentID, nil
}
