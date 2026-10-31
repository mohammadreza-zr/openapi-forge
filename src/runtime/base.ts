// The part of the built-in runtime every library shares: the banner and the
// types of `types.ts` that do not name a data-fetching library.
export const BANNER =
  "/* Written once by openapi-forge. Edit freely — it is never overwritten. */";

/** The types every library's `types.ts` shares. */
export const typesBase = (): string => TYPES_BASE;

const TYPES_BASE = `
/** What every answer of the API is wrapped in. */
export type ApiEnvelope<T> = {
  result: boolean;
  code?: number;
  message?: unknown;
  data: T;
};

/** A paged answer: how many there are, and this page of them. */
export type ApiListData<T> = {
  count: number;
  list: T[];
};
`;
