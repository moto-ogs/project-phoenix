package workforce

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The Vertretungspool of the Träger (#4709, ADR 0089 section 9, ADR 0252):
// an Arbeitsvertrag with the Merkmal „Vertretungspool“ makes its person a
// Springer every school of the Träger may block for a day and a time. Two
// live blocks of one Springer never overlap, also when two schools block at
// the same moment: the database keeps them apart and the second school gets
// ErrPoolBlockTaken. A school sees of a Springer only the name, the status
// of the Nachweise and the blocked times, and of another school's block only
// which school holds it. The Personalverwaltung sees every block and may lift
// one.

// TraegerStaffViewPool is the access log view of the pool in the
// Träger-Portal.
const TraegerStaffViewPool = "staff_pool"

// TraegerStaffViewPoolLift is the access log view of the Personalverwaltung
// lifting a block of the school.
const TraegerStaffViewPoolLift = "staff_pool_lift"

// TraegerStaffViewPoolExport is the access log view of the Personalverwaltung
// downloading the week's blocks as PDF, Excel or CSV (#4718).
const TraegerStaffViewPoolExport = "staff_pool_export"

// StaffDataAccessPool is the access log resource of a school reading the
// Springer of its Träger.
const StaffDataAccessPool = "traeger_staff_pool"

var (
	// ErrPoolSpringerNotFound answers a person who is no Springer of the
	// school's Träger on the requested day, or a school whose Träger has no
	// release „Personal beim Träger“.
	ErrPoolSpringerNotFound = errors.New("workforce: no Springer of the Träger on this day")
	// ErrPoolBlockTaken refuses a block that overlaps a live block of the
	// same Springer, by this or another school.
	ErrPoolBlockTaken = errors.New("workforce: the Springer is already blocked at this time")
	// ErrPoolSpringerBusy refuses a block at a time the Springer works a
	// shift at one of its Einsatzorte.
	ErrPoolSpringerBusy = errors.New("workforce: the Springer works a shift at this time")
	// ErrPoolBlockNotFound answers a block that is not a live block of the
	// school or, in the Träger-Portal, of the Träger.
	ErrPoolBlockNotFound = errors.New("workforce: pool block not found")
	// ErrPoolBlockInvalid refuses a block in the past, on a weekend, or
	// with an end before its start; the week view shows Monday to Friday.
	ErrPoolBlockInvalid = errors.New("workforce: the pool block is invalid")
)

// PoolProofStatus is the status of one kind of Nachweis of a Springer:
// "complete", "missing" or "expiring" with the expiry date, nothing of the
// proof itself (ADR 0089 section 7).
type PoolProofStatus struct {
	TypeName  string         `json:"type_name"`
	Status    string         `json:"status"`
	ExpiresOn *calendar.Date `json:"expires_on,omitempty"`
}

// The status values of PoolProofStatus.
const (
	PoolProofComplete = "complete"
	PoolProofMissing  = "missing"
	PoolProofExpiring = "expiring"
)

// PoolBlock is one block of a Springer. ID is set only for a block of the
// reading school (and always in the Träger-Portal); another school's block
// names only that school. Lifted marks a block of the reading school the
// Personalverwaltung lifted.
type PoolBlock struct {
	ID         *int64        `json:"id,omitempty"`
	SchoolID   int64         `json:"school_id"`
	SchoolName string        `json:"school_name"`
	Own        bool          `json:"own"`
	Date       calendar.Date `json:"date"`
	StartTime  string        `json:"start_time"`
	EndTime    string        `json:"end_time"`
	Lifted     bool          `json:"lifted"`
}

// PoolSpringer is one Springer in a week: the days its pool contract
// covers, the status of its Nachweise and its blocks of the week.
type PoolSpringer struct {
	RecordID  int64             `json:"staff_record_id"`
	FirstName string            `json:"first_name"`
	LastName  string            `json:"last_name"`
	PoolFrom  calendar.Date     `json:"pool_from"`
	PoolUntil *calendar.Date    `json:"pool_until"`
	Proofs    []PoolProofStatus `json:"proofs"`
	Blocks    []PoolBlock       `json:"blocks"`
}

// PoolWeek is the pool of the Träger from Monday WeekStart to Sunday.
// Available is false for a school whose Träger keeps no staff in moto; the
// list is then empty.
type PoolWeek struct {
	WeekStart calendar.Date  `json:"week_start"`
	Today     calendar.Date  `json:"today"`
	Available bool           `json:"available"`
	Springers []PoolSpringer `json:"springers"`
}

// PoolBlockInput blocks a Springer on Date from StartTime to EndTime
// (HH:MM wall clock).
type PoolBlockInput struct {
	RecordID  int64
	Date      calendar.Date
	StartTime string
	EndTime   string
}

// SchoolPoolActor is the staff member of the school who reads or blocks.
type SchoolPoolActor struct {
	AccountID int64
	Role      string
}

// SchoolStaffPool is the Vertretungspool as a school sees it. It joins the
// tenant transaction of the request; every read writes its access entry
// into the school's access log first.
type SchoolStaffPool interface {
	SchoolPoolWeek(ctx context.Context, actor SchoolPoolActor, weekStart calendar.Date) (PoolWeek, error)
	BlockSpringer(ctx context.Context, actor SchoolPoolActor, input PoolBlockInput) (PoolBlock, error)
	LiftSchoolBlock(ctx context.Context, actor SchoolPoolActor, blockID int64) error
}

// TraegerStaffPool is the Vertretungspool in the Träger-Portal: every
// Springer with every block of the week, and lifting a block. Reading
// writes an access entry at each school a listed Springer works at or was
// blocked by (ADR 0089 section 6), under view: TraegerStaffViewPool for
// the page, TraegerStaffViewPoolExport for a download.
type TraegerStaffPool interface {
	TraegerPoolWeek(ctx context.Context, actor TraegerStaffActor, weekStart calendar.Date, view string) (PoolWeek, error)
	LiftTraegerBlock(ctx context.Context, actor TraegerStaffActor, blockID int64) error
}

// SpringerEmploymentRequest gives a Springer the employment and the access
// of one block at the school of the caller's tenant transaction (#7173,
// ADR 0251). StartsAt and EndsAt bound the access, the block with its
// margin.
type SpringerEmploymentRequest struct {
	AccountID int64
	FirstName string
	LastName  string
	BlockID   int64
	StartsAt  time.Time
	EndsAt    time.Time
}

// SpringerEmployments creates the employment of a Springer at a blocking
// school and the access of each block, in the caller's tenant transaction.
// The root binds it to Identity & Access.
type SpringerEmployments interface {
	// EmploySpringer creates what is missing and returns the employment.
	EmploySpringer(ctx context.Context, request SpringerEmploymentRequest) (staffID int64, err error)
	// EndSpringerAccess ends the access of a lifted block.
	EndSpringerAccess(ctx context.Context, blockID int64) error
}

// SpringerExit is an employment the pool created at the school of the
// caller's tenant transaction whose last block there is over (#7197, ADR
// 0252): every block of the school lies before today or was lifted.
// LastBlockDay is the day of the last block. The exit runs in the name of
// the most recent blocking Leitung who still works at the school,
// ActorAccountID with their employment ActorStaffID; both are 0 without
// one.
type SpringerExit struct {
	TenantID       int64
	RecordID       int64
	StaffID        int64
	LastBlockDay   calendar.Date
	ActorAccountID int64
	ActorStaffID   int64
}

// SchoolSpringerExits finds the employments of Springer whose last block at
// the school is over and records their end in the record's trail. Each
// method joins the caller's tenant transaction of one school.
type SchoolSpringerExits interface {
	// DueSpringerExits lists the exits due at the school on today.
	DueSpringerExits(ctx context.Context, today calendar.Date) ([]SpringerExit, error)
	// LockSpringerExit locks the record, as a block of it does, and reads
	// its exit again; due is false when a new block keeps it.
	LockSpringerExit(ctx context.Context, recordID int64, today calendar.Date) (exit SpringerExit, due bool, err error)
	// RecordSpringerExit writes the end of the Einsatzort into the
	// record's trail, in the name of the exit's actor.
	RecordSpringerExit(ctx context.Context, exit SpringerExit) error
}
