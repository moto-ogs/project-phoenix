package test

import (
	"encoding/json"
	"testing"
)

func TestIDReadsANumberOrADecimalStringAndWritesANumber(t *testing.T) {
	t.Parallel()

	var got struct {
		A ID   `json:"a"`
		B ID   `json:"b"`
		C []ID `json:"c"`
	}
	if err := json.Unmarshal([]byte(`{"a":5,"b":"9007199254740993","c":[1,"2"]}`), &got); err != nil {
		t.Fatal(err)
	}
	if got.A != 5 || got.B != 9007199254740993 || len(got.C) != 2 || got.C[1] != 2 {
		t.Fatalf("got %+v", got)
	}
	for _, input := range []string{`{"a":"x"}`, `{"a":""}`, `{"a":1.5}`} {
		if err := json.Unmarshal([]byte(input), &got); err == nil {
			t.Errorf("%s: no error", input)
		}
	}
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"a":5,"b":9007199254740993,"c":[1,2]}` {
		t.Errorf("got %s", raw)
	}
}

func TestJSONIDReadsAnyDecodedIdentifier(t *testing.T) {
	t.Parallel()

	var decoded map[string]any
	if err := json.Unmarshal([]byte(`{"n":12,"s":"9007199254740993","l":[3,"4"]}`), &decoded); err != nil {
		t.Fatal(err)
	}
	if got := JSONID(t, decoded["n"]); got != 12 {
		t.Errorf("number: %d", got)
	}
	if got := JSONID(t, decoded["s"]); got != 9007199254740993 {
		t.Errorf("string: %d", got)
	}
	if got := JSONIDs(t, decoded["l"]); len(got) != 2 || got[0] != 3 || got[1] != 4 {
		t.Errorf("list: %v", got)
	}
	if got := JSONID(t, json.Number("77")); got != 77 {
		t.Errorf("json.Number: %d", got)
	}
}
