const sensitiveParam =
  /^(x-amz-.*|sig|signature|token|access_token|key|apikey|api_key|secret|credential|auth|jwt|session|password|policy|expires|sk[a-z]*|se|sp|sv|sr|spr|rscd|rsct)$/i

/**
 * Remove credentials from a URL before it is stored, logged, or sent to the browser. Userinfo is
 * dropped and the values of signing/token query parameters are replaced, so presigned URLs stay
 * recognisable without remaining usable.
 */
export const redactUrl = (raw: string): string => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return '[unparseable url]'
  }
  if (url.username || url.password) {
    url.username = url.username ? 'redacted' : ''
    url.password = ''
  }
  for (const key of Array.from(url.searchParams.keys())) {
    if (sensitiveParam.test(key)) url.searchParams.set(key, 'redacted')
  }
  return url.toString()
}

/** Proxy URLs only need scheme, host, and port to be identifiable. */
export const redactProxy = (raw: string): string => {
  try {
    const url = new URL(raw)
    return `${url.protocol}//${url.host}`
  } catch {
    return '[unparseable proxy]'
  }
}

/** Strip anything URL-shaped with userinfo from free-form text such as curl error messages. */
export const redactText = (text: string): string =>
  text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1redacted@')
