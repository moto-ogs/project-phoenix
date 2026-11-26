import { careTermValuesOf } from "~/lib/care-facility-term-value";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import de from "./messages/de.generated";
import en from "./messages/en.generated";
import LoginMessages from "~/app/parents/login/layout";
import PreviewMessages from "~/app/[tenant]/(public)/anmeldung/preview/layout";
import { ChildProfileMessages } from "./shared-page-messages";
import { mergeMessages } from "./locale-resolution";

const { getMessages } = vi.hoisted(() => ({ getMessages: vi.fn() }));
vi.mock("next-intl/server", () => ({ getMessages }));
vi.unmock("next-intl");

describe("messages passed to the client", () => {
  it.each([de, en])(
    "keeps just the login notices, without settings or other forms",
    async (catalog) => {
      getMessages.mockResolvedValue(catalog);
      const { props } = await LoginMessages({ children: null });
      expect(props.messages?.errorCatalog).toEqual({
        loginNotice: catalog.errorCatalog.loginNotice,
        codes: {
          identity: {
            logout_not_revoked:
              catalog.errorCatalog.codes.identity.logout_not_revoked,
          },
        },
      });
      expect(props.messages?.parentSignIn).toEqual({
        challenge: catalog.parentSignIn.challenge,
      });
      expect(props.messages).not.toHaveProperty("enrollmentForm");
    },
  );
  it("projects the German fallback before formatting the child's school vocabulary", async () => {
    const partial = { parentChild: { errorObject: "the child's profile" } };
    getMessages.mockResolvedValue(mergeMessages(de, partial));
    const { props } = await ChildProfileMessages({ children: null });
    const t = createTranslator({
      locale: "en",
      messages: props.messages!,
      namespace: "parentChild",
    });
    expect(t("errorObject")).toBe("the child's profile");
    const visibility = createTranslator({
      locale: "en",
      messages: props.messages!,
      namespace: "parentVisibility",
    });
    // The German text declines the school's name with its article (#8136).
    expect(visibility("ogs", careTermValuesOf("Hort", "der"))).toBe(
      "Für den Hort sichtbar",
    );
    expect(props.messages).not.toHaveProperty("enrollmentForm");
  });
  it("provides the preview form and its shared controls without the status page", async () => {
    getMessages.mockResolvedValue(en);
    const { props } = await PreviewMessages({ children: null });
    expect(props.messages?.enrollmentForm).toBe(en.enrollmentForm);
    expect(props.messages?.datePicker).toBe(en.datePicker);
    expect(props.messages).not.toHaveProperty("enrollmentStatus");
  });
});
