package application

import (
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func holidayNames(t *testing.T, region, from, to string) map[string]string {
	t.Helper()
	list, err := HolidaysInRange(region, from, to)
	require.NoError(t, err)
	names := make(map[string]string, len(list))
	for _, holiday := range list {
		names[holiday.Date] = holiday.Name
	}
	return names
}

func TestHolidaysInRangePreservesGermanRegionalRules(t *testing.T) {
	t.Parallel()

	nw, err := HolidaysInRange("DE-NW", "2026-01-01", "2026-12-31")
	require.NoError(t, err)
	assert.Len(t, nw, 11)
	for index := 1; index < len(nw); index++ {
		assert.Less(t, nw[index-1].Date, nw[index].Date)
	}
	nwNames := holidayNames(t, "DE-NW", "2026-01-01", "2026-12-31")
	assert.Equal(t, "Neujahrstag", nwNames["2026-01-01"])
	assert.Equal(t, "Karfreitag", nwNames["2026-04-03"])
	assert.Equal(t, "Ostermontag", nwNames["2026-04-06"])
	assert.Equal(t, "Christi Himmelfahrt", nwNames["2026-05-14"])
	assert.Equal(t, "Pfingstmontag", nwNames["2026-05-25"])
	assert.Equal(t, "Fronleichnam", nwNames["2026-06-04"])
	assert.Equal(t, "Tag der Deutschen Einheit", nwNames["2026-10-03"])
	assert.Equal(t, "Allerheiligen", nwNames["2026-11-01"])
	assert.Equal(t, "Erster Weihnachtsfeiertag", nwNames["2026-12-25"])
	assert.Equal(t, "Zweiter Weihnachtsfeiertag", nwNames["2026-12-26"])

	assert.Equal(t, "Buß- und Bettag", holidayNames(t, "DE-SN", "2026-01-01", "2026-12-31")["2026-11-18"])
	assert.Equal(t, "Internationaler Frauentag", holidayNames(t, "DE-BE", "2026-01-01", "2026-12-31")["2026-03-08"])
	assert.Equal(t, "Weltkindertag", holidayNames(t, "DE-TH", "2026-01-01", "2026-12-31")["2026-09-20"])
	assert.Equal(t, "Mariä Himmelfahrt", holidayNames(t, "DE-SL", "2026-01-01", "2026-12-31")["2026-08-15"])
	assert.Empty(t, holidayNames(t, "DE-BY", "2026-01-01", "2026-12-31")["2026-08-15"])
}

func TestHolidaysInRangePreservesHistoricalValidityWindows(t *testing.T) {
	t.Parallel()

	cases := []struct {
		region, date, want string
	}{
		{"DE-MV", "2022-03-08", ""},
		{"DE-MV", "2023-03-08", "Internationaler Frauentag"},
		{"DE-BE", "2024-05-08", ""},
		{"DE-BE", "2025-05-08", "Tag der Befreiung"},
		{"DE-TH", "2018-09-20", ""},
		{"DE-TH", "2019-09-20", "Weltkindertag"},
	}
	for _, tc := range cases {
		assert.Equal(t, tc.want, holidayNames(t, tc.region, tc.date, tc.date)[tc.date], tc.region+" "+tc.date)
	}
}

func TestHolidayRangesAndDateSet(t *testing.T) {
	t.Parallel()

	list, err := HolidaysInRange("DE-NW", "2026-12-20", "2027-01-10")
	require.NoError(t, err)
	require.Len(t, list, 3)
	assert.Equal(t, []string{"2026-12-25", "2026-12-26", "2027-01-01"}, []string{list[0].Date, list[1].Date, list[2].Date})

	set, err := HolidayDates("DE-BB", "2026-01-01", "2026-12-31")
	require.NoError(t, err)
	assert.True(t, set["2026-04-05"], "Brandenburg includes Easter Sunday")
	assert.True(t, set["2026-05-24"], "Brandenburg includes Pentecost Sunday")
	assert.False(t, set["2026-05-02"])
}

func TestHolidaysInRangeRejectsInvalidInputs(t *testing.T) {
	t.Parallel()

	for _, input := range [][3]string{
		{"DE-XX", "2026-01-01", "2026-12-31"},
		{"DE-NW", "not-a-date", "2026-12-31"},
		{"DE-NW", "2026-01-01", "not-a-date"},
	} {
		_, err := HolidaysInRange(input[0], input[1], input[2])
		assert.Error(t, err)
	}
}

// Every supported region carries the German name the school reads next to
// its holidays (#4775).
func TestEveryHolidayRegionHasAGermanName(t *testing.T) {
	t.Parallel()

	require.Len(t, holidayRegions, 16)
	for code := range holidayRegions {
		assert.NotEmpty(t, HolidayRegionName(code), code)
	}
	assert.Equal(t, "Nordrhein-Westfalen", HolidayRegionName("DE-NW"))
	assert.Equal(t, "Baden-Württemberg", HolidayRegionName("DE-BW"))
	assert.Empty(t, HolidayRegionName("XX"))
}

func TestEpiphanyIsAHolidayInBavariaButNotInNorthRhineWestphalia(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "Heilige Drei Könige", holidayNames(t, "DE-BY", "2027-01-01", "2027-01-31")["2027-01-06"])
	assert.NotContains(t, holidayNames(t, "DE-NW", "2027-01-01", "2027-01-31"), "2027-01-06")
}

// Every federal state a school can choose has its statutory holidays
// (#7174): the complete 2027 list per state, checked against the state laws
// and cross-checked with the OpenHolidays API for 2026 to 2030. Holidays of
// single municipalities stay out: Mariä Himmelfahrt in Bavaria's Catholic
// communities, the Augsburger Friedensfest, Fronleichnam in parts of Saxony
// and Thuringia.
func TestHolidaysInRangeCoverEveryFederalState(t *testing.T) {
	t.Parallel()

	nationwide := []string{"01-01", "03-26", "03-29", "05-01", "05-06", "05-17", "10-03", "12-25", "12-26"}
	extra := map[string][]string{
		"DE-BW": {"01-06", "05-27", "11-01"},
		"DE-BY": {"01-06", "05-27", "11-01"},
		"DE-BE": {"03-08"},
		"DE-BB": {"03-28", "05-16", "10-31"},
		"DE-HB": {"10-31"},
		"DE-HH": {"10-31"},
		"DE-HE": {"05-27"},
		"DE-MV": {"03-08", "10-31"},
		"DE-NI": {"10-31"},
		"DE-NW": {"05-27", "11-01"},
		"DE-RP": {"05-27", "11-01"},
		"DE-SL": {"05-27", "08-15", "11-01"},
		"DE-SN": {"10-31", "11-17"},
		"DE-ST": {"01-06", "10-31"},
		"DE-SH": {"10-31"},
		"DE-TH": {"09-20", "10-31"},
	}
	require.Len(t, extra, len(holidayRegions), "every supported state has an expectation")
	for region := range holidayRegions {
		want := make([]string, 0, len(nationwide)+3)
		for _, day := range append(slices.Clone(nationwide), extra[region]...) {
			want = append(want, "2027-"+day)
		}
		slices.Sort(want)
		list, err := HolidaysInRange(region, "2027-01-01", "2027-12-31")
		require.NoError(t, err, region)
		got := make([]string, 0, len(list))
		for _, holiday := range list {
			got = append(got, holiday.Date)
			assert.NotEmpty(t, holiday.Name, "%s %s", region, holiday.Date)
		}
		assert.Equal(t, want, got, region)
		assert.NotEmpty(t, HolidayRegionName(region), region)
		assert.True(t, ValidHolidayRegion(region), region)
	}
	assert.False(t, ValidHolidayRegion(""), "there is no default state")
	_, err := HolidaysInRange("", "2027-01-01", "2027-12-31")
	assert.Error(t, err, "an unset state has no holidays")
}
