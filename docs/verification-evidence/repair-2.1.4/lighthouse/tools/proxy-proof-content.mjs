import { isDeepStrictEqual } from 'node:util';

const canonicalTimestamp = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

/** Only the public site API declares this one per-response timestamp. */
export function comparePublicSiteContent(identityDecoded, gzipDecoded) {
  const result = {
    rawDecodedBytesEqual: identityDecoded.equals(gzipDecoded),
    bothObservedAtValuesValid: false,
    structuralContentEqualExcludingTopLevelObservedAt: false,
  };
  let identity, gzip;
  try {
    identity = JSON.parse(identityDecoded.toString('utf8'));
    gzip = JSON.parse(gzipDecoded.toString('utf8'));
  } catch { return result; }
  if (!identity || !gzip || Array.isArray(identity) || Array.isArray(gzip)
      || typeof identity !== 'object' || typeof gzip !== 'object') return result;
  result.bothObservedAtValuesValid = canonicalTimestamp(identity.observedAt)
    && canonicalTimestamp(gzip.observedAt);
  if (!result.bothObservedAtValuesValid) return result;
  const { observedAt: identityTimestamp, ...identityContent } = identity;
  const { observedAt: gzipTimestamp, ...gzipContent } = gzip;
  result.structuralContentEqualExcludingTopLevelObservedAt = isDeepStrictEqual(identityContent, gzipContent);
  return result;
}
