import { describe, expect, it } from "vitest";
import identityCatalog from "~/i18n/messages/de/errorCatalog/codes/identity.json";
import { loginTopic } from "~/components/help/articles/login";
import { SCHOOL_SIGN_IN_LABEL } from "./school-sign-in";

// The German error text and the help article tell the reader which button to
// choose; a renamed button must not leave them naming one that is gone (#7214).
describe("SCHOOL_SIGN_IN_LABEL", () => {
  it("is the button the German error text names", () => {
    expect(identityCatalog.mfa_session_required).toContain(
      `„${SCHOOL_SIGN_IN_LABEL}“`,
    );
  });

  it("is the button the help article names", () => {
    expect(
      loginTopic("unknown", "unknown").troubleshootingDetails?.join(" "),
    ).toContain(`\`${SCHOOL_SIGN_IN_LABEL}\``);
  });
});
