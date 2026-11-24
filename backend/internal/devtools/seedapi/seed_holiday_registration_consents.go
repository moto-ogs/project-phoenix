package api

import (
	"context"
	"fmt"
)

// seedHolidayPhotoConsentKey is the voluntary photo consent of the seeded
// holiday form (seedHolidayLegalForm).
const seedHolidayPhotoConsentKey = "fotos_ferien"

// seedHolidayConsentParent links the registration to the first seeded
// parent's account with the prefill's proof (ADR 0216 point 2), so the
// parents portal lists it with its consents (#8038). Without a seeded parent
// the registration stays without an account and nil comes back.
func seedHolidayConsentParent(ctx context.Context, rt *Runtime, token string, body map[string]any) (*AuthRef, error) {
	if len(rt.Parents) == 0 || rt.Adapter == nil {
		return nil, nil
	}
	parent := rt.Parents[0]
	auth, err := rt.Adapter.LoginParent(ctx, parent.Email, parent.Password)
	if err != nil {
		return nil, fmt.Errorf("sign in the parent of the holiday consent: %w", err)
	}
	proof, err := seedHolidayAccountProof(rt, auth, token)
	if err != nil {
		return nil, err
	}
	body["parent_account_proof"] = proof
	return &auth, nil
}

// seedHolidayConsentChange withdraws the photo consent in the parents
// portal and gives it again (ADR 0321): the registration's history names
// both changes, and the consent holds again for the hosting school.
func seedHolidayConsentChange(rt *Runtime, auth AuthRef, registration int64) error {
	path := fmt.Sprintf("/parent/me/holiday-registration-entries/%d/consents/%s", registration, seedHolidayPhotoConsentKey)
	for _, given := range []bool{false, true} {
		if _, err := rt.Client.PutWithAuth(auth, path, map[string]any{"given": given}); err != nil {
			return fmt.Errorf("change the holiday photo consent to %t in the parents portal: %w", given, err)
		}
	}
	fmt.Println("  Ferienanmeldung: the parents withdrew the photo consent and gave it again")
	return nil
}
