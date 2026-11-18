package api

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/api/contract"
	"github.com/moto-ogs/project-phoenix/modules/appointments"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// renderShape says how a rendered value fills what may be nil.
type renderShape int

const (
	// shapeNil leaves every pointer, slice, map and day unset.
	shapeNil renderShape = iota
	// shapeEmpty allocates slices and maps without a member.
	shapeEmpty
	// shapeFilled gives every slice and map one member and sets every pointer.
	shapeFilled
)

var renderShapes = map[string]renderShape{"nil": shapeNil, "empty": shapeEmpty, "filled": shapeFilled}

// The contract is derived from the Go types by reflection, the answer by
// encoding/json. This test renders every registered response type in three
// shapes, as a handler would write them, and holds the bytes against the
// contract: a null or an absent key the decoder refuses shows here and not
// as a 502 in the BFF.
//
// It proves that the generator and encoding/json agree. That a handler
// answers with the registered type is the answer check's part
// (common.ObserveAnswers).
func TestRegisteredResponseTypesRenderWithinTheContract(t *testing.T) {
	t.Parallel()
	registrations, err := contractRegistrations()
	require.NoError(t, err)
	doc, err := ContractDocument()
	require.NoError(t, err)
	routes := map[string]contract.Route{}
	for _, route := range doc.Routes {
		routes[route.Key()] = route
	}
	rendered := 0
	for _, registration := range registrations {
		route := routes[registration.Method+" "+registration.Pattern]
		responses := map[string]any{"": registration.Response}
		if registration.Variants != nil {
			responses = registration.Variants.ByValue
		}
		for variant, zero := range responses {
			if zero == nil {
				continue
			}
			for name, shape := range renderShapes {
				body := renderedAnswer(t, route, reflect.TypeOf(zero), shape)
				violations := doc.Violations(route, contract.Answer{Status: 200, Body: body, Variant: variant})
				assert.Emptyf(t, violations, "%s (variant %q, shape %s) renders outside its contract:\n%s", route.Key(), variant, name, body)
				rendered++
			}
		}
	}
	require.NotZero(t, rendered)
}

func renderedAnswer(t *testing.T, route contract.Route, responseType reflect.Type, shape renderShape) []byte {
	t.Helper()
	data := reflect.New(responseType).Elem()
	// The envelope's data is never a nil list: builder.top registers it so,
	// and the answer check holds the handlers to it.
	top := shape
	if responseType.Kind() == reflect.Slice && shape == shapeNil {
		top = shapeEmpty
	}
	fillRendered(data, top, shape, "", 0)
	var envelope any = common.NewResponse(data.Interface(), "ok")
	if route.Paginated {
		envelope = common.NewPaginatedResponse(data.Interface(), 1, 50, 1, "ok")
	}
	body, err := json.Marshal(envelope)
	require.NoError(t, err)
	return body
}

var renderedInstant = time.Date(2026, 9, 9, 12, 0, 0, 0, calendar.Berlin)

// fillRendered sets v the way a handler's value looks in shape. own is the
// shape of v itself, shape the one of everything below it. format is the
// field's `contract` tag.
func fillRendered(v reflect.Value, own, shape renderShape, format string, depth int) {
	if depth > 8 {
		return
	}
	switch v.Type() {
	case reflect.TypeFor[time.Time]():
		v.Set(reflect.ValueOf(renderedInstant))
		return
	case reflect.TypeFor[calendar.Date](), reflect.TypeFor[appointments.Date]():
		if own != shapeNil {
			v.SetString("2026-09-09")
		}
		return
	}
	switch v.Kind() {
	case reflect.Pointer:
		if own == shapeNil {
			return
		}
		v.Set(reflect.New(v.Type().Elem()))
		fillRendered(v.Elem(), shapeFilled, shape, format, depth+1)
	case reflect.Slice:
		if own == shapeNil {
			return
		}
		members := 0
		if own == shapeFilled {
			members = 1
		}
		v.Set(reflect.MakeSlice(v.Type(), members, members))
		for i := range members {
			fillRendered(v.Index(i), shapeFilled, shape, format, depth+1)
		}
	case reflect.Map:
		if own == shapeNil {
			return
		}
		v.Set(reflect.MakeMap(v.Type()))
		if own == shapeFilled {
			member := reflect.New(v.Type().Elem()).Elem()
			fillRendered(member, shapeFilled, shape, format, depth+1)
			v.SetMapIndex(reflect.ValueOf("key").Convert(v.Type().Key()), member)
		}
	case reflect.Struct:
		for i := range v.NumField() {
			field, own := v.Field(i), shape
			if v.Type().Field(i).Anonymous {
				// The contract flattens an embedded row into its holder: a
				// handler never renders the holder without it.
				own = shapeFilled
			}
			if field.CanSet() {
				fillRendered(field, own, shape, v.Type().Field(i).Tag.Get("contract"), depth+1)
			}
		}
	case reflect.String:
		v.SetString(map[string]string{"date": "2026-09-09", "clock": "12:00"}[format])
		if format == "" {
			v.SetString("text")
		}
	case reflect.Bool:
		v.SetBool(true)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		v.SetInt(7)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		v.SetUint(7)
	case reflect.Float32, reflect.Float64:
		v.SetFloat(1.5)
	}
}
