import { captureAWSv3Client, getSegment } from "aws-xray-sdk-core";

/**
 * X-Ray, kept out of the way of anything that is not a live invocation.
 *
 * The handler's `NodejsFunction` turns on active tracing, which is what
 * puts `AWS_XRAY_DAEMON_ADDRESS` and `_X_AMZN_TRACE_ID` in the
 * environment; neither is set locally, in `npm test`, or from the command
 * line. Everything below checks for them before touching the X-Ray SDK,
 * so wrapping a client or a call is a plain no-op outside Lambda and
 * nothing here ever needs a daemon running to pass a test.
 */
function inLambda(): boolean {
  return Boolean(process.env["AWS_XRAY_DAEMON_ADDRESS"] || process.env["_X_AMZN_TRACE_ID"]);
}

/**
 * Wrap an AWS SDK v3 client so a trace shows the time a request spent in
 * DynamoDB, S3 or Secrets Manager, next to the time it spent everywhere
 * else. Untouched outside Lambda: the same client the tests already hand
 * a fake table and bucket to.
 */
export function traced<T extends { middlewareStack: { remove: unknown; use: unknown }; config: unknown }>(client: T): T {
  return inLambda() ? captureAWSv3Client(client) : client;
}

/** Run `fn`, closing `subsegment` whether it returns, throws, or rejects. */
function closing<R>(subsegment: ReturnType<NonNullable<ReturnType<typeof getSegment>>["addNewSubsegment"]> | undefined, fn: () => R): R {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(
        (value) => {
          subsegment?.close();
          return value;
        },
        (error: unknown) => {
          subsegment?.close(error instanceof Error ? error : String(error));
          throw error;
        },
      ) as R;
    }
    subsegment?.close();
    return result;
  } catch (error) {
    subsegment?.close(error instanceof Error ? error : String(error));
    throw error;
  }
}

/**
 * Wrap every method of a Stripe- or WorkOS-shaped client in its own
 * subsegment named `name`. Neither SDK's outbound call is something X-Ray
 * can capture cleanly — both speak through `fetch`, which sits below the
 * `http`/`https` modules X-Ray patches — so the boundary is drawn at the
 * interface these handlers already call through instead of at the
 * transport. A trace still shows the time spent in each service, even
 * though the request inside it is invisible.
 */
export function tracedCalls<T extends object>(name: string, impl: T): T {
  if (!inLambda()) return impl;
  const wrapped = { ...impl };
  for (const key of Object.keys(impl) as Array<keyof T>) {
    const fn = impl[key];
    if (typeof fn !== "function") continue;
    const call = fn as (...args: unknown[]) => unknown;
    wrapped[key] = ((...args: unknown[]) => closing(getSegment()?.addNewSubsegment(name), () => call(...args))) as T[keyof T];
  }
  return wrapped;
}

/**
 * Annotate the current segment with what this invocation was, so a trace
 * can be searched or filtered by it. Only ever the route and the method:
 * never a request body, a token, or an email — those have no business in
 * a trace.
 */
export function annotate(fields: Record<string, string>): void {
  if (!inLambda()) return;
  const segment = getSegment();
  if (!segment) return;
  for (const [key, value] of Object.entries(fields)) segment.addAnnotation(key, value);
}
