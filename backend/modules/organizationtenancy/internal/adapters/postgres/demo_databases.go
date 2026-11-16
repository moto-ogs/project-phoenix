package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/uptrace/bun"
)

// DemoSchoolDatabaseStore calls the database erasure of retired demo schools
// (#5559, migration 1.15.869) on the demo process's phoenix_demo connection.
// The functions check due-ness themselves; the store adds no SQL of its own.
type DemoSchoolDatabaseStore struct{ db *bun.DB }

func NewDemoSchoolDatabaseStore(db *bun.DB) *DemoSchoolDatabaseStore {
	return &DemoSchoolDatabaseStore{db: db}
}

func (s *DemoSchoolDatabaseStore) DueDemoSchoolDatabases(ctx context.Context, limit int) ([]int64, error) {
	ids := []int64{}
	if err := s.db.NewRaw(`SELECT id FROM platform.retired_demo_schools_due_for_database_erasure(?) AS id`, limit).Scan(ctx, &ids); err != nil {
		return nil, fmt.Errorf("list retired demo schools due for database erasure: %w", err)
	}
	return ids, nil
}

func (s *DemoSchoolDatabaseStore) EraseDemoSchoolDatabase(ctx context.Context, schoolID int64) (string, string, error) {
	var data string
	if err := s.db.NewRaw(`SELECT platform.erase_retired_demo_school(?)::text`, schoolID).Scan(ctx, &data); err != nil {
		return "", "", fmt.Errorf("erase retired demo school: %w", err)
	}
	return decodeDemoErasureResult(data)
}

// DueDemoTraegers lists the Demo-Träger whose last school is erased (ADR
// 0271); platform.retired_demo_traegers_due_for_erasure checks due-ness.
func (s *DemoSchoolDatabaseStore) DueDemoTraegers(ctx context.Context, limit int) ([]int64, error) {
	ids := []int64{}
	if err := s.db.NewRaw(`SELECT id FROM platform.retired_demo_traegers_due_for_erasure(?) AS id`, limit).Scan(ctx, &ids); err != nil {
		return nil, fmt.Errorf("list retired demo Träger due for erasure: %w", err)
	}
	return ids, nil
}

// EraseDemoTraeger erases one Demo-Träger with its Träger tables.
func (s *DemoSchoolDatabaseStore) EraseDemoTraeger(ctx context.Context, organizationID int64) (string, string, error) {
	var data string
	if err := s.db.NewRaw(`SELECT platform.erase_retired_demo_traeger(?)::text`, organizationID).Scan(ctx, &data); err != nil {
		return "", "", fmt.Errorf("erase retired demo Träger: %w", err)
	}
	return decodeDemoErasureResult(data)
}

func decodeDemoErasureResult(data string) (string, string, error) {
	var result struct {
		Status    string `json:"status"`
		ErrorCode string `json:"error_code"`
	}
	if err := json.Unmarshal([]byte(data), &result); err != nil {
		return "", "", fmt.Errorf("decode demo erasure result: %w", err)
	}
	return result.Status, result.ErrorCode, nil
}
