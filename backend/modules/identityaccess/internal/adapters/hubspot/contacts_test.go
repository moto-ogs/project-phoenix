package hubspot

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}

func prospect() Contact {
	return Contact{
		Email: "visitor@example.invalid", FirstName: "New", LastName: "Visitor", Phone: "+49 123",
		SchoolName: "Test OGS", Source: "direkt", AccessID: "demo-test-access", ContactOptIn: true,
		RequestedAt: time.Date(2026, time.November, 20, 16, 0, 0, 0, time.UTC),
	}
}

func TestSyncPreservesMaintainedNamesAndStartedStatus(t *testing.T) {
	t.Parallel()
	calls := 0
	client, err := New("test-only", transportFunc(func(request *http.Request) (*http.Response, error) {
		calls++
		if request.URL.Host != "api.hubapi.com" || request.Header.Get("Authorization") != "Bearer test-only" {
			t.Fatal("wrong destination or authorization")
		}
		if request.Method == http.MethodGet {
			return response(http.StatusOK, `{"id":"contact-record","properties":{"firstname":"Maintained","lastname":"Name","moto_demo_status":"gestartet"}}`), nil
		}
		if request.Method != http.MethodPatch || request.URL.Path != "/crm/v3/objects/contacts/contact-record" {
			t.Fatal("expected update of existing record")
		}
		var body struct {
			Properties map[string]string `json:"properties"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		for _, field := range []string{"firstname", "lastname", "moto_demo_status"} {
			if _, exists := body.Properties[field]; exists {
				t.Fatalf("overwrites maintained %s", field)
			}
		}
		if body.Properties["phone"] != prospect().Phone || body.Properties["moto_demo_contact_opt_in"] != "true" {
			t.Fatal("missing consent or phone")
		}
		return response(http.StatusOK, `{}`), nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Sync(context.Background(), prospect()); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("got %d requests", calls)
	}
}

func TestSyncUpsertsNewContactAndFillsOnlyEmptyNames(t *testing.T) {
	t.Parallel()
	calls := 0
	client, err := New("test-only", transportFunc(func(request *http.Request) (*http.Response, error) {
		calls++
		switch calls {
		case 1:
			return response(http.StatusNotFound, `{}`), nil
		case 2:
			if request.Method != http.MethodPost || request.URL.Path != "/crm/v3/objects/contacts/batch/upsert" {
				t.Fatal("wrong upsert")
			}
			var body struct {
				Inputs []struct {
					ID, IDProperty string
					Properties     map[string]string
				}
			}
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if len(body.Inputs) != 1 || body.Inputs[0].IDProperty != "email" || body.Inputs[0].ID != prospect().Email {
				t.Fatal("wrong identity")
			}
			if _, exists := body.Inputs[0].Properties["firstname"]; exists {
				t.Fatal("upsert could overwrite concurrently created names")
			}
			return response(http.StatusOK, `{}`), nil
		case 3:
			return response(http.StatusOK, `{"id":"new-contact","properties":{"firstname":"Maintained","lastname":"","moto_demo_status":"gestartet"}}`), nil
		case 4:
			var body struct{ Properties map[string]string }
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if len(body.Properties) != 1 || body.Properties["lastname"] != prospect().LastName {
				t.Fatal("must fill only the empty name")
			}
			return response(http.StatusOK, `{}`), nil
		default:
			t.Fatal("unexpected request")
			return nil, errors.New("unexpected request")
		}
	}))
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Sync(context.Background(), prospect()); err != nil {
		t.Fatal(err)
	}
	if calls != 4 {
		t.Fatalf("got %d requests", calls)
	}
}

func TestSyncWithoutConsentDoesNotCallProvider(t *testing.T) {
	t.Parallel()
	client, err := New("test-only", transportFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("provider called without consent")
		return nil, errors.New("unexpected request")
	}))
	if err != nil {
		t.Fatal(err)
	}
	contact := prospect()
	contact.ContactOptIn = false
	if err := client.Sync(context.Background(), contact); err != nil {
		t.Fatal(err)
	}
}

func TestSyncReportsProviderFailuresWithoutLeakingContactData(t *testing.T) {
	t.Parallel()
	for _, status := range []int{http.StatusTooManyRequests, http.StatusServiceUnavailable, http.StatusUnauthorized} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			t.Parallel()
			client, err := New("test-only", transportFunc(func(*http.Request) (*http.Response, error) {
				r := response(status, prospect().Email)
				r.Header.Set("Retry-After", "60")
				return r, nil
			}))
			if err != nil {
				t.Fatal(err)
			}
			err = client.Sync(context.Background(), prospect())
			var apiErr *APIError
			if !errors.As(err, &apiErr) || apiErr.StatusCode != status || apiErr.RetryAfter != "60" {
				t.Fatalf("unexpected error: %v", err)
			}
			if apiErr.Retryable() != (status != http.StatusUnauthorized) {
				t.Fatal("incorrect retry classification")
			}
			if strings.Contains(err.Error(), prospect().Email) {
				t.Fatal("contact data in error")
			}
		})
	}
}

func TestSyncStartCarriesTimestampAndDoesNotClearPhone(t *testing.T) {
	t.Parallel()
	contact := prospect()
	contact.StartedAt = contact.RequestedAt.Add(time.Minute)
	contact.Phone = ""
	properties := contactProperties(contact, map[string]string{})
	if properties["moto_demo_status"] != "gestartet" || properties["moto_demo_started_at"] != "2026-11-20T16:01:00Z" {
		t.Fatal("missing start event")
	}
	if _, exists := properties["phone"]; exists {
		t.Fatal("start event must not clear the phone")
	}
}
