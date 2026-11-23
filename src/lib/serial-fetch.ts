/**
 * Requests that may create the visitor's profile (heart, "Suche speichern", pushes on) go out one
 * after another in the browser. Otherwise two quick first clicks would each create a profile, and
 * the browser would keep only the cookie of the last one: the other click's save would be lost.
 */
let queue: Promise<unknown> = Promise.resolve();

export function serialFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const result = queue.then(() => fetch(input, init));
  queue = result.catch(() => undefined);
  return result;
}
