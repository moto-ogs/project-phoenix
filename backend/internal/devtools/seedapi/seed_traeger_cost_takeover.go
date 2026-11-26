package api

import (
	"fmt"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedCostBearerKey keeps the ID of the seeded cost bearer for the list of
// the billing run (#5627).
const seedCostBearerKey = "traeger.cost_bearer_id"

// seedHolidayCostTakeover lets the Abrechnung keep an invented youth office
// as cost bearer (#5627). The Träger-Büro confirms the second parent's
// registration, which states benefits, as paid by the family, and changes
// the payer to that office once the notice is there (#8158): the family
// pays 0 €, the office pays the rest, and the history names the change.
func seedHolidayCostTakeover(rt *Runtime, auth AuthRef, periodID, registrationID int64) error {
	raw, err := rt.Client.PostWithAuth(auth, "/traeger/cost-bearers/", map[string]any{
		"name": "Fachdienst Jugend des Landkreises Musterstadt", "address": "Am Kreishaus 1\n12345 Musterstadt",
		"file_reference": "FJ 51-2027", "active": true,
	})
	if err != nil {
		return fmt.Errorf("keep the cost bearer: %w", err)
	}
	costBearerID, err := decodeSeedEntityID(raw)
	if err != nil {
		return fmt.Errorf("read the cost bearer: %w", err)
	}
	rt.Values[seedCostBearerKey] = costBearerID
	if err := postReadHolidayConfirmation(rt, auth, periodID, registrationID, map[string]any{
		"benefits_exemption": false, "debtor_number": seedCostTakeoverDebtorNumber,
	}); err != nil {
		return fmt.Errorf("confirm the holiday registration before its cost takeover: %w", err)
	}
	if err := putReadHolidayPayer(rt, auth, periodID, registrationID, costBearerID, "Bescheid über Grundsicherung nachgereicht"); err != nil {
		return err
	}
	fmt.Println("  Träger-Büro: second registration confirmed, then the cost bearer took over its contribution")
	return nil
}

// putReadHolidayPayer lets the cost bearer pay a confirmed registration
// over the preview it reads first, as the registration page does (#8158,
// ADR 0311).
func putReadHolidayPayer(rt *Runtime, auth AuthRef, periodID, registrationID, costBearerID int64, reason string) error {
	path := fmt.Sprintf("/traeger/holiday-contributions/%d/registrations/%d/payer", periodID, registrationID)
	raw, err := rt.Client.GetWithAuth(auth, fmt.Sprintf("%s?cost_bearer_id=%d", path, costBearerID))
	if err != nil {
		return fmt.Errorf("preview the payer of registration %d: %w", registrationID, err)
	}
	fingerprint, err := seedReadToken(raw, "fingerprint")
	if err != nil {
		return err
	}
	if _, err := rt.Client.PutWithAuth(auth, path, map[string]any{
		"cost_bearer_id": ident.ID(costBearerID), "reason": reason, "expected_fingerprint": fingerprint,
	}); err != nil {
		return fmt.Errorf("change the payer of registration %d: %w", registrationID, err)
	}
	return nil
}

// seedCostTakeoverDebtorNumber is the invented debtor number of the family
// whose contribution the cost bearer pays.
const seedCostTakeoverDebtorNumber = "10472"
