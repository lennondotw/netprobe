import { spawn } from 'node:child_process'

import type { IpFamily } from '../shared/types.ts'

/**
 * Write-out fields, tab-separated. `errormsg` goes last because it is free text. The built-in
 * `%{json}` is avoided on purpose: it embeds the full certificate chain on every request.
 */
const fields = [
  'exitcode',
  'http_code',
  'http_version',
  'remote_ip',
  'remote_port',
  'scheme',
  'time_namelookup',
  'time_connect',
  'time_appconnect',
  'time_pretransfer',
  'time_starttransfer',
  'time_total',
  'size_download',
  'url_effective',
  'errormsg',
] as const

const writeOut = fields.map((field) => `%{${field}}`).join('\\t')

/** One curl invocation, normalised. Times are cumulative seconds from the start, as curl reports. */
export interface CurlSample {
  exitCode: number
  httpCode: number
  httpVersion: string
  remoteIp: string
  remotePort: number
  scheme: string
  timeNamelookup: number
  timeConnect: number
  timeAppconnect: number
  timePretransfer: number
  timeStarttransfer: number
  timeTotal: number
  sizeDownload: number
  urlEffective: string
  errorMessage: string
  /** True when the process was stopped by the abort signal rather than finishing on its own. */
  aborted: boolean
}

export interface CurlRequest {
  url: string
  method: 'GET' | 'HEAD'
  connectTimeoutMs: number
  maxTimeMs: number
  ipFamily: IpFamily
  /** Proxy URL, or null to force a direct connection regardless of environment variables. */
  proxy: string | null
  followRedirects: boolean
  /** Byte range to request, inclusive, as `start-end`. */
  range?: string
  /** Abort when the response declares (or reaches) more bytes than this. */
  maxFilesize?: number
  userAgent: string
}

const proxyEnvKeys = /^(https?|all|no|ftp)_proxy$/i

export const buildCurlArgs = (request: CurlRequest): string[] => {
  // `-q` must come first: it stops curl from reading a ~/.curlrc that could change behaviour.
  const args = ['-q', '--silent', '--show-error', '--output', '/dev/null', '--write-out', writeOut]
  args.push('--connect-timeout', String(request.connectTimeoutMs / 1000))
  args.push('--max-time', String(request.maxTimeMs / 1000))
  args.push('--user-agent', request.userAgent)
  if (request.method === 'HEAD') args.push('--head')
  if (request.ipFamily === 'ipv4') args.push('--ipv4')
  if (request.ipFamily === 'ipv6') args.push('--ipv6')
  if (request.proxy) args.push('--proxy', request.proxy)
  else args.push('--noproxy', '*')
  if (request.followRedirects) args.push('--location', '--max-redirs', '5')
  if (request.range) args.push('--range', request.range)
  if (request.maxFilesize) args.push('--max-filesize', String(request.maxFilesize))
  args.push('--', request.url)
  return args
}

export const parseWriteOut = (stdout: string): Omit<CurlSample, 'aborted'> | null => {
  const parts = stdout.split('\t')
  if (parts.length < fields.length) return null
  const value = (field: (typeof fields)[number]) => parts[fields.indexOf(field)] ?? ''
  const number = (field: (typeof fields)[number]) => {
    const parsed = Number(value(field))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return {
    exitCode: number('exitcode'),
    httpCode: number('http_code'),
    httpVersion: value('http_version'),
    remoteIp: value('remote_ip'),
    remotePort: number('remote_port'),
    scheme: value('scheme').toLowerCase(),
    timeNamelookup: number('time_namelookup'),
    timeConnect: number('time_connect'),
    timeAppconnect: number('time_appconnect'),
    timePretransfer: number('time_pretransfer'),
    timeStarttransfer: number('time_starttransfer'),
    timeTotal: number('time_total'),
    sizeDownload: number('size_download'),
    urlEffective: value('url_effective'),
    // Everything after the last fixed field is the message, even if it contains a tab.
    errorMessage: parts
      .slice(fields.length - 1)
      .join('\t')
      .trim(),
  }
}

/** Child env without proxy variables, so the egress choice is always explicit in the arguments. */
const curlEnv = () =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !proxyEnvKeys.test(key)))

export const runCurl = (request: CurlRequest, signal: AbortSignal): Promise<CurlSample> =>
  new Promise((resolve, reject) => {
    const child = spawn('curl', buildCurlArgs(request), {
      env: curlEnv(),
      signal,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    child.on('error', (error) => {
      // An abort surfaces as an error event; report it as a sample so callers can classify it.
      if (signal.aborted) return
      reject(error)
    })
    child.on('close', () => {
      const parsed = parseWriteOut(stdout)
      if (parsed) {
        resolve({ ...parsed, aborted: signal.aborted })
        return
      }
      resolve({
        exitCode: signal.aborted ? -1 : 1,
        httpCode: 0,
        httpVersion: '',
        remoteIp: '',
        remotePort: 0,
        scheme: '',
        timeNamelookup: 0,
        timeConnect: 0,
        timeAppconnect: 0,
        timePretransfer: 0,
        timeStarttransfer: 0,
        timeTotal: 0,
        sizeDownload: 0,
        urlEffective: '',
        errorMessage: signal.aborted ? 'Cancelled' : stderr.trim() || 'curl produced no output',
        aborted: signal.aborted,
      })
    })
  })

/** Run curl and return its body as text. Used for small echo endpoints, never for targets. */
export const fetchText = (
  url: string,
  options: { proxy: string | null; ipFamily: IpFamily; timeoutMs: number; signal: AbortSignal },
): Promise<string> =>
  new Promise((resolve, reject) => {
    const args = [
      '-q',
      '--silent',
      '--show-error',
      '--fail',
      '--max-time',
      String(options.timeoutMs / 1000),
    ]
    if (options.ipFamily === 'ipv4') args.push('--ipv4')
    if (options.ipFamily === 'ipv6') args.push('--ipv6')
    if (options.proxy) args.push('--proxy', options.proxy)
    else args.push('--noproxy', '*')
    args.push('--', url)
    const child = spawn('curl', args, {
      env: curlEnv(),
      signal: options.signal,
      killSignal: 'SIGKILL',
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `curl exited with ${code}`))
    })
  })

export const curlVersion = (): Promise<string> =>
  new Promise((resolve) => {
    const child = spawn('curl', ['--version'])
    let stdout = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.on('error', () => resolve('unavailable'))
    child.on('close', () => resolve(stdout.split('\n')[0]?.trim() || 'unavailable'))
  })
