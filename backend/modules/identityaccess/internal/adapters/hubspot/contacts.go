package hubspot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
)

const contactsURL = "https://api.hubapi.com/crm/v3/objects/contacts"

type Contact = domain.DemoCRMContact

type Client struct {
	token string
	http  *http.Client
}

func NewDefault(token string) (*Client, error) { return New(token, http.DefaultTransport) }

func New(token string, transport http.RoundTripper) (*Client, error) {
	if strings.TrimSpace(token) == "" || transport == nil {
		return nil, errors.New("hubspot: token and transport are required")
	}
	return &Client{token: strings.TrimSpace(token), http: &http.Client{
		Transport: transport, Timeout: 10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

// APIError deliberately excludes response bodies and request URLs: either may
// contain contact data. The durable worker owns retries, not the HTTP client.
type APIError struct {
	StatusCode int
	RetryAfter string
}

func (e *APIError) Error() string { return fmt.Sprintf("hubspot: HTTP %d", e.StatusCode) }

func (e *APIError) Retryable() bool {
	return e.StatusCode == http.StatusTooManyRequests || e.StatusCode >= http.StatusInternalServerError
}

type record struct {
	ID         string            `json:"id"`
	Properties map[string]string `json:"properties"`
}

// Sync preserves maintained names and never downgrades an already started
// demo. Existing contacts use PATCH because email upserts are not partial.
func (c *Client) Sync(ctx context.Context, contact Contact) error {
	if !contact.ContactOptIn {
		return nil
	}
	if strings.TrimSpace(contact.Email) == "" || contact.AccessID == "" || contact.RequestedAt.IsZero() {
		return errors.New("hubspot: incomplete demo contact")
	}
	existing, found, err := c.find(ctx, contact.Email)
	if err != nil {
		return err
	}
	properties := contactProperties(contact, existing.Properties)
	if found {
		return c.write(ctx, http.MethodPatch, contactsURL+"/"+url.PathEscape(existing.ID), struct {
			Properties map[string]string `json:"properties"`
		}{properties})
	}
	// Another request may create this contact after our lookup. The upsert
	// must therefore never contain names, even on the apparent create path.
	delete(properties, "firstname")
	delete(properties, "lastname")
	delete(properties, "moto_demo_status")
	delete(properties, "moto_demo_started_at")
	input := struct {
		ID         string            `json:"id"`
		IDProperty string            `json:"idProperty"`
		Properties map[string]string `json:"properties"`
	}{contact.Email, "email", properties}
	if err := c.write(ctx, http.MethodPost, contactsURL+"/batch/upsert", struct {
		Inputs []any `json:"inputs"`
	}{[]any{input}}); err != nil {
		return err
	}
	return c.completeCreatedContact(ctx, contact)
}

func (c *Client) completeCreatedContact(ctx context.Context, contact Contact) error {
	existing, found, err := c.find(ctx, contact.Email)
	if err != nil {
		return err
	}
	if !found {
		return errors.New("hubspot: upserted contact is not yet readable")
	}
	names := make(map[string]string)
	if strings.TrimSpace(existing.Properties["firstname"]) == "" && contact.FirstName != "" {
		names["firstname"] = contact.FirstName
	}
	if strings.TrimSpace(existing.Properties["lastname"]) == "" && contact.LastName != "" {
		names["lastname"] = contact.LastName
	}
	state := contactProperties(contact, existing.Properties)
	for _, field := range []string{"moto_demo_status", "moto_demo_started_at"} {
		if value, exists := state[field]; exists {
			names[field] = value
		}
	}
	if len(names) == 0 {
		return nil
	}
	return c.write(ctx, http.MethodPatch, contactsURL+"/"+url.PathEscape(existing.ID), struct {
		Properties map[string]string `json:"properties"`
	}{names})
}

func contactProperties(contact Contact, existing map[string]string) map[string]string {
	properties := map[string]string{
		"email": contact.Email, "moto_demo_school_name": contact.SchoolName,
		"moto_demo_source": contact.Source, "moto_demo_access_id": contact.AccessID,
		"moto_demo_contact_opt_in": strconv.FormatBool(contact.ContactOptIn),
		"moto_demo_requested_at":   contact.RequestedAt.UTC().Format(time.RFC3339Nano),
		"moto_demo_status":         "angefordert",
	}
	if strings.TrimSpace(existing["firstname"]) == "" && contact.FirstName != "" {
		properties["firstname"] = contact.FirstName
	}
	if strings.TrimSpace(existing["lastname"]) == "" && contact.LastName != "" {
		properties["lastname"] = contact.LastName
	}
	if contact.Phone != "" {
		properties["phone"] = contact.Phone
	}
	if !contact.StartedAt.IsZero() {
		properties["moto_demo_status"] = "gestartet"
		properties["moto_demo_started_at"] = contact.StartedAt.UTC().Format(time.RFC3339Nano)
	} else if existing["moto_demo_status"] == "gestartet" {
		delete(properties, "moto_demo_status")
	}
	return properties
}

func (c *Client) find(ctx context.Context, email string) (record, bool, error) {
	endpoint := contactsURL + "/" + url.PathEscape(email) + "?idProperty=email&properties=firstname,lastname,moto_demo_status"
	response, err := c.request(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return record{}, false, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusNotFound {
		return record{}, false, nil
	}
	if response.StatusCode != http.StatusOK {
		return record{}, false, responseError(response)
	}
	var result record
	if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result) != nil || result.ID == "" {
		return record{}, false, errors.New("hubspot: invalid contact response")
	}
	return result, true, nil
}

func (c *Client) write(ctx context.Context, method, endpoint string, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return errors.New("hubspot: encode contact failed")
	}
	response, err := c.request(ctx, method, endpoint, encoded)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusCreated {
		return responseError(response)
	}
	return nil
}

func (c *Client) request(ctx context.Context, method, endpoint string, body []byte) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, errors.New("hubspot: construct request failed")
	}
	request.Header.Set("Authorization", "Bearer "+c.token)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, errors.New("hubspot: transport failed")
	}
	return response, nil
}

func responseError(response *http.Response) *APIError {
	return &APIError{StatusCode: response.StatusCode, RetryAfter: response.Header.Get("Retry-After")}
}

func (e *APIError) RetryDelay(now time.Time) time.Duration {
	if seconds, err := strconv.Atoi(e.RetryAfter); err == nil && seconds >= 0 {
		return min(time.Duration(seconds), 24*60*60) * time.Second
	}
	if at, err := http.ParseTime(e.RetryAfter); err == nil {
		return min(max(at.Sub(now), 0), 24*time.Hour)
	}
	return 0
}
