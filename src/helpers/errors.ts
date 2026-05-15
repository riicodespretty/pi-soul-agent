import { Cause, Data } from "effect";

export function TaggedMessageError<Tag extends string>(tag: Tag) {
  return Data.TaggedError(tag) as new <A extends Record<string, any> = {}>(
    args: keyof A extends never
      ? void | { readonly message?: string }
      : { readonly [P in keyof A as P extends "_tag" ? never : P]: A[P] } & {
          readonly message?: string;
        },
  ) => Cause.YieldableError & { readonly _tag: Tag } & Readonly<A>;
}
