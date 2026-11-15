package architecture

import (
	"go/token"
	"go/types"
	"testing"
)

func TestEffectFreeClockAcceptsOnlyParameterlessTimeAndDateResults(t *testing.T) {
	t.Parallel()

	timePkg := types.NewPackage("time", "time")
	instant := types.NewNamed(types.NewTypeName(token.NoPos, timePkg, "Time", nil), types.NewStruct(nil, nil), nil)
	calendarPkg := types.NewPackage(calendarPackagePath, "calendar")
	day := types.NewNamed(types.NewTypeName(token.NoPos, calendarPkg, "Date", nil), types.Typ[types.String], nil)
	otherPkg := types.NewPackage("example.com/other", "other")
	otherDate := types.NewNamed(types.NewTypeName(token.NoPos, otherPkg, "Date", nil), types.Typ[types.String], nil)

	results := func(ts ...types.Type) *types.Tuple {
		vars := make([]*types.Var, len(ts))
		for i, typ := range ts {
			vars[i] = types.NewParam(token.NoPos, nil, "", typ)
		}
		return types.NewTuple(vars...)
	}
	signature := func(params, out *types.Tuple) types.Type {
		return types.NewSignatureType(nil, nil, nil, params, out, false)
	}
	alias := types.NewAlias(types.NewTypeName(token.NoPos, calendarPkg, "Day", nil), day)

	for name, tc := range map[string]struct {
		callable types.Type
		want     bool
	}{
		"instant clock":          {signature(nil, results(instant)), true},
		"day clock":              {signature(nil, results(day)), true},
		"aliased day clock":      {signature(nil, results(alias)), true},
		"named clock type":       {types.NewNamed(types.NewTypeName(token.NoPos, otherPkg, "Clock", nil), signature(nil, results(instant)), nil), true},
		"clock with a parameter": {signature(results(types.Typ[types.Int]), results(instant)), false},
		"two results":            {signature(nil, results(instant, types.Universe.Lookup("error").Type())), false},
		"string day":             {signature(nil, results(types.Typ[types.String])), false},
		"foreign Date type":      {signature(nil, results(otherDate)), false},
		"no result":              {signature(nil, nil), false},
		"not a function":         {instant, false},
	} {
		if got := effectFreeClock(tc.callable); got != tc.want {
			t.Errorf("%s: effectFreeClock = %v, want %v", name, got, tc.want)
		}
	}
}
