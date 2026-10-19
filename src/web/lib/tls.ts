import type { TlsOffer } from '../../shared/types.ts'

/** The Node TLS handshake offers, in display order. */
export const tlsOffers: readonly {
  value: TlsOffer
  short: string
  label: string
  detail: string
}[] = [
  {
    value: 'default',
    short: 'PQ',
    label: 'Default (post-quantum)',
    detail: 'Node 24’s offer, ClientHello ~1.6 KB',
  },
  {
    value: 'classic',
    short: 'Classic',
    label: 'Classic groups',
    detail: 'X25519 and P-256 only, ~400 bytes',
  },
  { value: 'tls12', short: '1.2', label: 'TLS 1.2', detail: 'TLS 1.2 only' },
]

export const offerShort = (offer: TlsOffer) =>
  tlsOffers.find((o) => o.value === offer)?.short ?? offer
