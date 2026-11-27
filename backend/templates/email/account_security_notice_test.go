package email_test

import (
	"bytes"
	"html/template"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAccountSecurityNoticeTemplates_Render verifies the mail that tells an
// account holder about an administrator's reset of their second factor
// (#6862): who reset it and when, and whom to turn to if it was not asked
// for. It carries no link: it names "Passwort vergessen?", which every
// portal's login page offers.
func TestAccountSecurityNoticeTemplates_Render(t *testing.T) {
	t.Parallel()

	templatesDir, err := filepath.Abs(".")
	require.NoError(t, err)
	tpl, err := template.ParseGlob(filepath.Join(templatesDir, "*.html"))
	require.NoError(t, err, "parse all email templates")

	for _, tc := range []struct {
		name, template string
		data           map[string]any
		mustContain    []string
		mustNotContain []string
	}{
		{
			name: "second factor reset by the school", template: "account-mfa-reset.html",
			data:           map[string]any{"LogoURL": "https://example.com/logo.png", "ResetAt": "12.11.2026 09:42", "Actor": "Die Verwaltung Ihrer Schule", "ByOperator": false},
			mustContain:    []string{"Die Verwaltung Ihrer Schule hat am 12.11.2026 09:42", "gemerkten Geräte", "„Passwort vergessen?“", "bei der Verwaltung Ihrer Schule", `alt="moto"`},
			mustNotContain: []string{"beim moto-Team", "href=\"http"},
		},
		{
			name: "second factor reset by the moto team", template: "account-mfa-reset.html",
			data:           map[string]any{"LogoURL": "https://example.com/logo.png", "ResetAt": "12.11.2026 09:42", "Actor": "Das moto-Team", "ByOperator": true},
			mustContain:    []string{"Das moto-Team hat am 12.11.2026 09:42", "„Passwort vergessen?“", "beim moto-Team"},
			mustNotContain: []string{"bei der Verwaltung Ihrer Schule"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			require.NoError(t, tpl.ExecuteTemplate(&buf, tc.template, tc.data))
			html := buf.String()
			for _, want := range tc.mustContain {
				assert.Contains(t, html, want)
			}
			for _, unwanted := range tc.mustNotContain {
				assert.NotContains(t, html, unwanted)
			}
		})
	}
}
