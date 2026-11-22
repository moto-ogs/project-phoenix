// Package contract turns the typed route registrations into the model of the
// frontend/backend contract and writes the TypeScript side from it (ADR 0270).
package contract

import "github.com/moto-ogs/project-phoenix/api/common/contractmodel"

// Kinds of a value on the wire.
const (
	KindString  = contractmodel.KindString
	KindBool    = contractmodel.KindBool
	KindInt     = contractmodel.KindInt
	KindNumber  = contractmodel.KindNumber
	KindID      = contractmodel.KindID
	KindDate    = contractmodel.KindDate
	KindInstant = contractmodel.KindInstant
	KindClock   = contractmodel.KindClock
	KindEnum    = contractmodel.KindEnum
	KindArray   = contractmodel.KindArray
	KindMap     = contractmodel.KindMap
	KindRef     = contractmodel.KindRef
	KindJSON    = contractmodel.KindJSON
)

// The model lives in contractmodel so that the request runtime's test build
// can read it; this package builds and renders it.
type (
	Schema     = contractmodel.Schema
	Field      = contractmodel.Field
	Object     = contractmodel.Object
	Enum       = contractmodel.Enum
	QueryParam = contractmodel.QueryParam
	Variants   = contractmodel.Variants
	Route      = contractmodel.Route
	Document   = contractmodel.Document
	Answer     = contractmodel.Answer
	Outside    = contractmodel.OutsideRoute
)
