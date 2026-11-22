import type * as parentMeContract from "./contract/parent-me.generated";

/**
 * The value of the signature field (#4785), shared by every flow that asks
 * for a signature: Einverständnisse, the enrollment (#4786) and the pickup
 * permission (#4780). `imagePngBase64` carries no `data:` prefix.
 */
export interface SignatureValue {
  readonly method: "drawn" | "typed";
  readonly imagePngBase64: string;
  readonly typedName?: string;
}

/**
 * Maps the field value to the request body every signing endpoint accepts;
 * `statement` is the exact server-generated text the signature was made
 * under. The declaration's request type is the widest of those bodies.
 */
export function signatureRequestBody(
  value: SignatureValue,
  statement?: string,
): parentMeContract.declarationSignatureRequest {
  return {
    method: value.method,
    image_png: value.imagePngBase64,
    ...(value.typedName === undefined ? {} : { typed_name: value.typedName }),
    ...(statement === undefined ? {} : { statement }),
  };
}
