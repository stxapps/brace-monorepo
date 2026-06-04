import type { z } from 'zod';

// The shared API "contract" primitive. Each endpoint is described once here in
// `shared` (the lowest, platform-agnostic layer); brace-api reads it to validate
// requests + type responses, and every client (brace-web, brace-extension,
// future brace-expo) reads the same descriptor to build a typed fetch. Nobody
// imports brace-api — the dependency arrow only ever points down at `shared` —
// which is why we hand-write this instead of using Hono RPC (its types are
// derived from the app instance, forcing client → app coupling that the Nx
// `type:`/`platform:` boundaries forbid). See docs/architecture.md.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiEndpoint<
  TMethod extends HttpMethod = HttpMethod,
  TPath extends string = string,
  TRequest extends z.ZodType = z.ZodType,
  TResponse extends z.ZodType = z.ZodType,
> {
  method: TMethod;
  path: TPath;
  /** Validates the request: query params for GET/DELETE, JSON body otherwise. */
  request: TRequest;
  /** Validates (and types) the JSON response body. */
  response: TResponse;
}

// Identity helper that preserves the literal method/path and the schema types,
// while constraining the object to the `ApiEndpoint` shape. Prefer this over a
// bare `as const` object so a malformed descriptor fails at the definition site.
export function defineEndpoint<
  TMethod extends HttpMethod,
  TPath extends string,
  TRequest extends z.ZodType,
  TResponse extends z.ZodType,
>(
  endpoint: ApiEndpoint<TMethod, TPath, TRequest, TResponse>,
): ApiEndpoint<TMethod, TPath, TRequest, TResponse> {
  return endpoint;
}
