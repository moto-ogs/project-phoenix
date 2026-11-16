package application

import (
	"context"
	"errors"
	"maps"
	"slices"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The Vertretungspool (#4709, ADR 0089 section 9, ADR 0250). A school reads
// and blocks in the tenant transaction of its request; the functions behind
// the store answer only that school. The Träger reads in its own
// transaction and writes the access entry at each school a listed Springer
// works at or was blocked by, each in that school's tenant transaction.

var (
	_ workforce.TraegerStaffPool = (*TraegerStaff)(nil)
	_ workforce.SchoolStaffPool  = (*TraegerStaff)(nil)
)

// SchoolPoolWeek lists the Springer of the week of weekStart (empty: this
// week) with their Nachweise and blocks. The access entry is written before
// anything leaves.
func (t *TraegerStaff) SchoolPoolWeek(ctx context.Context, actor workforce.SchoolPoolActor, weekStart calendar.Date) (workforce.PoolWeek, error) {
	today := t.today()
	monday := poolMonday(weekStart, today)
	week := workforce.PoolWeek{WeekStart: monday, Today: today, Springers: []workforce.PoolSpringer{}}
	available, err := t.store.SchoolPoolAvailable(ctx)
	if err != nil || !available {
		return week, err
	}
	week.Available = true
	springers, err := t.store.SchoolPoolSpringers(ctx, monday, monday.AddDays(6))
	if err != nil || len(springers) == 0 {
		return week, err
	}
	recordIDs := springerIDs(springers)
	if err := t.audit.RecordDataAccess(ctx, domain.DataAccess{
		ActorAccountID: actor.AccountID, ActorRole: domain.ActorRoleOrUnknown(actor.Role), Resource: workforce.StaffDataAccessPool,
		RecordIDs: recordIDs, At: t.clock.Now(),
	}); err != nil {
		return workforce.PoolWeek{}, err
	}
	blocks, err := t.store.SchoolPoolBlocks(ctx, recordIDs, monday, monday.AddDays(6))
	if err != nil {
		return workforce.PoolWeek{}, err
	}
	proofs, err := t.store.SchoolPoolProofs(ctx, recordIDs)
	if err != nil {
		return workforce.PoolWeek{}, err
	}
	week.Springers = poolSpringers(springers, blocks, proofs, today)
	return week, nil
}

// BlockSpringer blocks a Springer for the school from today on.
func (t *TraegerStaff) BlockSpringer(ctx context.Context, actor workforce.SchoolPoolActor, input workforce.PoolBlockInput) (workforce.PoolBlock, error) {
	block, err := poolBlockOf(input, t.today())
	if err != nil {
		return workforce.PoolBlock{}, err
	}
	if err := t.schoolPoolOpen(ctx); err != nil {
		return workforce.PoolBlock{}, err
	}
	block.ID, err = t.store.BlockPoolSpringer(ctx, block, actor.AccountID)
	if err != nil {
		return workforce.PoolBlock{}, err
	}
	if err := t.employSpringer(ctx, block, actor); err != nil {
		return workforce.PoolBlock{}, err
	}
	block.Own = true
	return publicPoolBlock(block), nil
}

// LiftSchoolBlock lifts one of the school's own live blocks.
func (t *TraegerStaff) LiftSchoolBlock(ctx context.Context, actor workforce.SchoolPoolActor, blockID int64) error {
	if blockID <= 0 {
		return workforce.ErrPoolBlockNotFound
	}
	// A school whose Träger keeps no staff in moto (any more) learns why.
	available, err := t.store.SchoolPoolAvailable(ctx)
	if err != nil {
		return err
	}
	if !available {
		return workforce.ErrTraegerStaffNotReleased
	}
	if err := t.store.LiftSchoolPoolBlock(ctx, blockID, actor.AccountID); err != nil {
		return err
	}
	return t.endSpringerAccess(ctx, blockID)
}

// schoolPoolOpen refuses a write of a school whose Träger keeps no staff in
// moto (any more), so the school learns why instead of a missing Springer.
func (t *TraegerStaff) schoolPoolOpen(ctx context.Context) error {
	available, err := t.store.SchoolPoolAvailable(ctx)
	if err != nil {
		return err
	}
	if !available {
		return workforce.ErrTraegerStaffNotReleased
	}
	return nil
}

// TraegerPoolWeek lists every Springer of the Träger in the week with every
// live block. Before it answers, each school a listed Springer works at or
// was ever blocked by gets an access entry under view; a school that cannot
// take it fails the read.
func (t *TraegerStaff) TraegerPoolWeek(ctx context.Context, actor workforce.TraegerStaffActor, weekStart calendar.Date, view string) (workforce.PoolWeek, error) {
	today := t.today()
	monday := poolMonday(weekStart, today)
	week := workforce.PoolWeek{WeekStart: monday, Today: today, Available: true, Springers: []workforce.PoolSpringer{}}
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return workforce.PoolWeek{}, err
	}
	var (
		springers []domain.PoolSpringer
		blocks    []domain.PoolBlock
		proofs    []domain.PoolProof
		sites     map[int64][]int64
	)
	err = t.released(ctx, actor, func(ctx context.Context) error {
		springers, err = t.store.TraegerPoolSpringers(ctx, actor.OrganizationID, monday, monday.AddDays(6))
		if err != nil || len(springers) == 0 {
			return err
		}
		ids := springerIDs(springers)
		if sites, err = t.poolAccessSites(ctx, actor.OrganizationID, ids); err != nil {
			return err
		}
		if blocks, err = t.store.TraegerPoolBlocks(ctx, actor.OrganizationID, ids, monday, monday.AddDays(6)); err != nil {
			return err
		}
		proofs, err = t.store.TraegerPoolProofs(ctx, actor.OrganizationID, ids)
		return err
	})
	if err != nil || len(springers) == 0 {
		return week, err
	}
	if err := t.recordPoolAccess(ctx, actor, view, sites); err != nil {
		return workforce.PoolWeek{}, err
	}
	names := schoolNames(schools)
	for i := range blocks {
		blocks[i].SchoolName = names[blocks[i].SchoolID]
	}
	week.Springers = poolSpringers(springers, blocks, proofs, today)
	return week, nil
}

// poolAccessSites maps each school a Springer works at or was blocked by to
// the Springer it shows, in two statements.
func (t *TraegerStaff) poolAccessSites(ctx context.Context, organizationID int64, recordIDs []int64) (map[int64][]int64, error) {
	listed := make(map[int64]bool, len(recordIDs))
	for _, id := range recordIDs {
		listed[id] = true
	}
	records, err := t.store.ListStaffRecords(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	sites := map[int64][]int64{}
	for _, record := range records {
		if !listed[record.ID] {
			continue
		}
		for _, link := range record.Links {
			sites[link.SchoolID] = append(sites[link.SchoolID], record.ID)
		}
	}
	blocked, err := t.store.TraegerPoolBlockSites(ctx, organizationID, recordIDs)
	if err != nil {
		return nil, err
	}
	for _, site := range blocked {
		if !slices.Contains(sites[site.SchoolID], site.RecordID) {
			sites[site.SchoolID] = append(sites[site.SchoolID], site.RecordID)
		}
	}
	return sites, nil
}

// recordPoolAccess writes one access entry per school, in its tenant
// transaction (ADR 0084 section 7, ADR 0089 section 6).
func (t *TraegerStaff) recordPoolAccess(ctx context.Context, actor workforce.TraegerStaffActor, view string, sites map[int64][]int64) error {
	for _, schoolID := range slices.Sorted(maps.Keys(sites)) {
		recordIDs := slices.Sorted(slices.Values(sites[schoolID]))
		err := t.ports.Runtime.WithinSchool(ctx, schoolID, func(ctx context.Context) error {
			return t.ports.Access.RecordTraegerStaffAccess(ctx, workforce.TraegerStaffAccess{
				OrganizationID: actor.OrganizationID, AccountID: actor.AccountID, View: view,
				Rows: len(recordIDs), RecordIDs: recordIDs,
			})
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// LiftTraegerBlock lifts a live block of any school of the Träger; the
// school then sees it as lifted by the Personalverwaltung. The school's own
// tenant transaction after the lift committed ends the Springer's access of
// the block (ADR 0251) and names the lift and the Springer in the access
// log; a failure there fails the request, the lift stays (ADR 0105: no
// transaction carries both).
func (t *TraegerStaff) LiftTraegerBlock(ctx context.Context, actor workforce.TraegerStaffActor, blockID int64) error {
	if blockID <= 0 {
		return workforce.ErrPoolBlockNotFound
	}
	var lifted domain.PoolBlockSite
	err := t.released(ctx, actor, func(ctx context.Context) error {
		var err error
		lifted, err = t.store.LiftTraegerPoolBlock(ctx, actor.OrganizationID, blockID, actor.AccountID)
		return err
	})
	if err != nil {
		return err
	}
	return t.ports.Runtime.WithinSchool(ctx, lifted.SchoolID, func(ctx context.Context) error {
		if err := t.endSpringerAccess(ctx, blockID); err != nil {
			return err
		}
		return t.ports.Access.RecordTraegerStaffAccess(ctx, workforce.TraegerStaffAccess{
			OrganizationID: actor.OrganizationID, AccountID: actor.AccountID, View: workforce.TraegerStaffViewPoolLift,
			Rows: 1, RecordID: lifted.RecordID,
		})
	})
}

// poolMonday is the Monday of weekStart, or of today's week when empty.
func poolMonday(weekStart, today calendar.Date) calendar.Date {
	if weekStart.IsZero() {
		weekStart = today
	}
	return weekStart.StartOfISOWeek()
}

// poolBlockOf checks a block: a school day (Monday to Friday) from today
// on, two HH:MM wall clocks and an end after the start. The clocks are
// text bound as TIME, never an instant, so no wall-clock normalization
// applies.
func poolBlockOf(input workforce.PoolBlockInput, today calendar.Date) (domain.PoolBlock, error) {
	if input.RecordID <= 0 || input.Date.IsZero() {
		return domain.PoolBlock{}, workforce.ErrPoolBlockInvalid
	}
	if input.Date.Before(today) {
		return domain.PoolBlock{}, errors.Join(workforce.ErrPoolBlockInvalid, errors.New("the day lies in the past"))
	}
	if weekday := input.Date.Weekday(); weekday == time.Saturday || weekday == time.Sunday {
		return domain.PoolBlock{}, errors.Join(workforce.ErrPoolBlockInvalid, errors.New("a Springer is blocked Monday to Friday"))
	}
	start, startErr := time.Parse("15:04", strings.TrimSpace(input.StartTime))
	end, endErr := time.Parse("15:04", strings.TrimSpace(input.EndTime))
	if startErr != nil || endErr != nil || !end.After(start) {
		return domain.PoolBlock{}, errors.Join(workforce.ErrPoolBlockInvalid, errors.New("start and end must be HH:MM with the end after the start"))
	}
	return domain.PoolBlock{RecordID: input.RecordID, Date: input.Date, Start: start.Format("15:04"), End: end.Format("15:04")}, nil
}

func springerIDs(springers []domain.PoolSpringer) []int64 {
	ids := make([]int64, 0, len(springers))
	for _, springer := range springers {
		ids = append(ids, springer.RecordID)
	}
	return ids
}

// poolSpringers orders the Springer by name and adds their Nachweise and
// blocks.
func poolSpringers(springers []domain.PoolSpringer, blocks []domain.PoolBlock, proofs []domain.PoolProof, today calendar.Date) []workforce.PoolSpringer {
	result := make([]workforce.PoolSpringer, 0, len(springers))
	index := make(map[int64]int, len(springers))
	slices.SortFunc(springers, func(a, b domain.PoolSpringer) int {
		if order := strings.Compare(strings.ToLower(a.LastName), strings.ToLower(b.LastName)); order != 0 {
			return order
		}
		if order := strings.Compare(strings.ToLower(a.FirstName), strings.ToLower(b.FirstName)); order != 0 {
			return order
		}
		return int(a.RecordID - b.RecordID)
	})
	for _, springer := range springers {
		public := workforce.PoolSpringer{RecordID: springer.RecordID, FirstName: springer.FirstName, LastName: springer.LastName,
			PoolFrom: springer.PoolFrom, Proofs: []workforce.PoolProofStatus{}, Blocks: []workforce.PoolBlock{}}
		if !springer.PoolUntil.IsZero() {
			public.PoolUntil = new(springer.PoolUntil)
		}
		index[springer.RecordID] = len(result)
		result = append(result, public)
	}
	for _, proof := range proofs {
		if i, ok := index[proof.RecordID]; ok {
			result[i].Proofs = append(result[i].Proofs, publicPoolProof(proof, today))
		}
	}
	for _, block := range blocks {
		if i, ok := index[block.RecordID]; ok {
			result[i].Blocks = append(result[i].Blocks, publicPoolBlock(block))
		}
	}
	return result
}

func publicPoolProof(proof domain.PoolProof, today calendar.Date) workforce.PoolProofStatus {
	status := workforce.PoolProofStatus{TypeName: proof.TypeName, Status: domain.PoolProofState(proof, today)}
	if !proof.ExpiresOn.IsZero() {
		status.ExpiresOn = new(proof.ExpiresOn)
	}
	return status
}

func publicPoolBlock(block domain.PoolBlock) workforce.PoolBlock {
	public := workforce.PoolBlock{SchoolID: block.SchoolID, SchoolName: block.SchoolName, Own: block.Own, Date: block.Date,
		StartTime: block.Start, EndTime: block.End, Lifted: block.Lifted}
	if block.ID > 0 {
		public.ID = new(block.ID)
	}
	return public
}
