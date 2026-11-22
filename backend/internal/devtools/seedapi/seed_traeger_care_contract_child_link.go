package api

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedChildLinkCandidates are demo children of the seeded school the seed
// tries, in order, to give an imported contract linked to their child record
// (#7760). The first whose contract the import takes and the link finds
// ready is linked; a child with a contract from an application is left out
// by the import or the link. The first children of the list all have a
// contract from an application, so the seed walks the whole list.
var seedChildLinkCandidates = DemoStudents

// seedChildRecord is a child record of the seeded school as the student list
// names it.
type seedChildRecord struct {
	ID        ident.ID `json:"id"`
	FirstName string   `json:"first_name"`
	LastName  string   `json:"last_name"`
	Birthday  string   `json:"birthday"`
}

// seedCareContractChildLink takes over the contract of an existing child of
// the seeded school from a file and links it to the child's record through
// the file preview and the run, as the office does (#7760). The four
// children of the import stay unlinked: they have no child record. A
// repeated seed finds the contract linked and links nothing.
func seedCareContractChildLink(rt *Runtime, auth AuthRef, module seedImportModule) (int, error) {
	if module.module == "" || rt.TenantAuth.Token == "" {
		return 0, nil
	}
	for _, candidate := range seedChildLinkCandidates {
		child, found, err := seedFindChildRecord(rt, candidate)
		if err != nil {
			return 0, err
		}
		if !found || child.Birthday == "" {
			continue
		}
		contractID, err := seedImportChildRecordContract(rt.Client, auth, module, child)
		if err != nil {
			return 0, err
		}
		if contractID == 0 {
			continue
		}
		linked, done, err := seedLinkChildRecord(rt.Client, auth, contractID, int64(child.ID))
		if err != nil || done {
			return linked, err
		}
	}
	return 0, nil
}

// seedFindChildRecord reads the child record of a demo child at the seeded
// school by its names.
func seedFindChildRecord(rt *Runtime, child DemoStudent) (seedChildRecord, bool, error) {
	query := url.Values{"first_name": {child.FirstName}, "last_name": {child.LastName}, "page_size": {"1"}}
	raw, err := rt.Client.GetWithAuth(rt.TenantAuth, "/api/students/?"+query.Encode())
	if err != nil {
		return seedChildRecord{}, false, fmt.Errorf("find the child record to link: %w", err)
	}
	var list struct {
		Data []seedChildRecord `json:"data"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return seedChildRecord{}, false, fmt.Errorf("read the child record to link: %w", err)
	}
	if len(list.Data) == 0 {
		return seedChildRecord{}, false, nil
	}
	return list.Data[0], true, nil
}

type seedImportRows struct {
	Data struct {
		Fingerprint string `json:"fingerprint"`
		Rows        []struct {
			Status     string   `json:"status"`
			ContractID ident.ID `json:"contract_id"`
		} `json:"rows"`
	} `json:"data"`
}

// seedImportChildRecordContract takes over the contract of the child with
// the names and the date of birth of its record and answers the contract,
// also one an earlier seed took over; 0 when the import takes no contract
// for the child.
func seedImportChildRecordContract(client *Client, auth AuthRef, module seedImportModule, child seedChildRecord) (int64, error) {
	born, err := calendar.ParseDate(child.Birthday)
	if err != nil {
		return 0, fmt.Errorf("read the birthday of the child record to link: %w", err)
	}
	csv := []byte(strings.Join([]string{
		"Vorname Kind;Nachname Kind;Geburtsdatum;Schule;Modul;Vertragsbeginn;Vorname Eltern;Nachname Eltern;E-Mail",
		strings.Join([]string{child.FirstName, child.LastName, born.Format("02.01.2006"), module.school, module.module, module.start, "", "", ""}, ";"),
	}, "\r\n") + "\r\n")
	const file = "ogs-connect-kinderakte.csv"
	raw, err := client.PostFileWithAuthFields(auth, "/traeger/contract-imports/preview", "file", file, csv, nil)
	if err != nil {
		return 0, fmt.Errorf("preview the import of the contract to link: %w", err)
	}
	var preview seedImportRows
	if err := json.Unmarshal(raw, &preview); err != nil || len(preview.Data.Rows) != 1 {
		return 0, fmt.Errorf("read the preview of the contract to link: %w", err)
	}
	switch preview.Data.Rows[0].Status {
	case "duplicate":
		return int64(preview.Data.Rows[0].ContractID), nil
	case "ready":
	default:
		return 0, nil
	}
	raw, err = client.PostFileWithAuthFields(auth, "/traeger/contract-imports/", "file", file, csv,
		map[string]string{"fingerprint": preview.Data.Fingerprint})
	if err != nil {
		return 0, fmt.Errorf("import the contract to link: %w", err)
	}
	var applied seedImportRows
	if err := json.Unmarshal(raw, &applied); err != nil || len(applied.Data.Rows) != 1 {
		return 0, fmt.Errorf("read the import of the contract to link: %w", err)
	}
	return int64(applied.Data.Rows[0].ContractID), nil
}

// seedLinkChildRecord links the contract to the child record by a file of
// one row. done reports a contract linked now or before; a row the preview
// holds back leaves the contract unlinked for the next candidate.
func seedLinkChildRecord(client *Client, auth AuthRef, contractID, studentID int64) (int, bool, error) {
	csv := []byte(fmt.Sprintf("Vertrag;Kind\r\n%d;%d\r\n", contractID, studentID))
	const file = "kinderakten-verknuepfen.csv"
	raw, err := client.PostFileWithAuthFields(auth, "/traeger/contract-child-links/preview", "file", file, csv, nil)
	if err != nil {
		return 0, false, fmt.Errorf("preview the link of the contract: %w", err)
	}
	var preview seedImportRows
	if err := json.Unmarshal(raw, &preview); err != nil || len(preview.Data.Rows) != 1 {
		return 0, false, fmt.Errorf("read the preview of the link: %w", err)
	}
	switch preview.Data.Rows[0].Status {
	case "linked":
		return 0, true, nil
	case "ready":
	default:
		return 0, false, nil
	}
	if _, err := client.PostFileWithAuthFields(auth, "/traeger/contract-child-links/", "file", file, csv,
		map[string]string{"fingerprint": preview.Data.Fingerprint}); err != nil {
		return 0, false, fmt.Errorf("link the contract: %w", err)
	}
	return 1, true, nil
}
