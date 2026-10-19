import type { ServiceInput } from '../config.ts'
import { dot, ping, quic, site, stun, tcp, udpDns } from './helpers.ts'

const category = 'Network'

export const network: ServiceInput[] = [
  {
    id: 'latency',
    name: 'Latency baseline',
    category,
    description:
      'ICMP and TCP round trips to anycast resolvers. ICMP usually bypasses local proxies, so it shows the real path when TCP is intercepted.',
    targets: [
      ping('icmp-cloudflare', 'Cloudflare 1.1.1.1', '1.1.1.1'),
      ping('icmp-google', 'Google 8.8.8.8', '8.8.8.8'),
      ping('icmp-quad9', 'Quad9 9.9.9.9', '9.9.9.9'),
      ping('icmp-alidns', 'AliDNS 223.5.5.5', '223.5.5.5'),
      ping('icmp-dnspod', 'DNSPod 119.29.29.29', '119.29.29.29'),
      tcp('tcp-cloudflare', 'TCP 1.1.1.1:443', '1.1.1.1', 443),
      tcp('tcp-google', 'TCP 8.8.8.8:443', '8.8.8.8', 443),
    ],
  },
  {
    id: 'connectivity',
    name: 'Connectivity checks',
    category,
    description: 'The endpoints operating systems and browsers use to detect captive portals.',
    targets: [
      site('gstatic-204', 'Google generate_204', 'https://www.gstatic.com/generate_204', {
        expectStatus: [204],
      }),
      site(
        'android-204',
        'Android connectivity (HTTP)',
        'http://connectivitycheck.gstatic.com/generate_204',
        { expectStatus: [204] },
      ),
      site(
        'apple-captive',
        'Apple captive portal',
        'https://captive.apple.com/hotspot-detect.html',
        {
          expectStatus: [200],
        },
      ),
      site(
        'microsoft-ncsi',
        'Windows NCSI (HTTP)',
        'http://www.msftconnecttest.com/connecttest.txt',
        {
          expectStatus: [200],
        },
      ),
      site(
        'firefox-portal',
        'Firefox portal (HTTP)',
        'http://detectportal.firefox.com/success.txt',
        {
          expectStatus: [200],
        },
      ),
      {
        id: 'cloudflare-trace',
        name: 'Cloudflare trace',
        url: 'https://www.cloudflare.com/cdn-cgi/trace',
      },
    ],
  },
  {
    id: 'udp',
    name: 'UDP, NAT & QUIC',
    category,
    description:
      'STUN shows the public address UDP traffic leaves from; QUIC probes show whether UDP 443 (HTTP/3) is let through.',
    targets: [
      stun('stun-google', 'STUN Google', 'stun.l.google.com', 19302),
      stun('stun-cloudflare', 'STUN Cloudflare', 'stun.cloudflare.com'),
      stun('stun-twilio', 'STUN Twilio', 'global.stun.twilio.com'),
      quic('quic-cloudflare', 'QUIC Cloudflare (HTTP/3)', 'www.cloudflare.com'),
      quic('quic-google', 'QUIC Google (HTTP/3)', 'www.google.com'),
    ],
  },
  {
    id: 'dns-plain',
    name: 'Plain DNS',
    category: 'DNS',
    description:
      'One UDP query per attempt. Answers in 198.18.0.0/15 or near-zero round trips mean a local proxy is intercepting DNS.',
    targets: [
      udpDns('cloudflare', 'Cloudflare 1.1.1.1', '1.1.1.1'),
      udpDns('google', 'Google 8.8.8.8', '8.8.8.8'),
      udpDns('quad9', 'Quad9 9.9.9.9', '9.9.9.9'),
      udpDns('opendns', 'OpenDNS 208.67.222.222', '208.67.222.222'),
      udpDns('alidns', 'AliDNS 223.5.5.5', '223.5.5.5'),
      udpDns('dnspod', 'DNSPod 119.29.29.29', '119.29.29.29'),
    ],
  },
  {
    id: 'dns-encrypted',
    name: 'Encrypted DNS',
    category: 'DNS',
    description:
      'DNS over TLS and HTTPS with a real query; DoH3 and DoQ check the QUIC path to the resolver.',
    targets: [
      dot('dot-cloudflare', 'DoT Cloudflare', '1.1.1.1', 'cloudflare-dns.com'),
      dot('dot-google', 'DoT Google', 'dns.google'),
      dot('dot-quad9', 'DoT Quad9', 'dns.quad9.net'),
      dot('dot-alidns', 'DoT AliDNS', 'dns.alidns.com'),
      {
        id: 'doh-cloudflare',
        name: 'DoH Cloudflare',
        url: 'https://cloudflare-dns.com/dns-query?name=example.com&type=A',
        headers: { accept: 'application/dns-json' },
      },
      {
        id: 'doh-google',
        name: 'DoH Google',
        url: 'https://dns.google/resolve?name=example.com&type=A',
      },
      {
        id: 'doh-alidns',
        name: 'DoH AliDNS',
        url: 'https://dns.alidns.com/resolve?name=example.com&type=1',
      },
      quic(
        'doh3-cloudflare',
        'DoH3 Cloudflare (QUIC 443)',
        'cloudflare-dns.com',
        443,
        'Version negotiation only: proves HTTP/3 to the resolver is reachable over UDP.',
      ),
      quic('doq-adguard', 'DoQ AdGuard', 'dns.adguard-dns.com', 853),
      quic('doq-nextdns', 'DoQ NextDNS', 'dns.nextdns.io', 853),
      quic('doq-alidns', 'DoQ AliDNS', 'dns.alidns.com', 853),
    ],
  },
  {
    id: 'speed',
    category: 'Network',
    name: 'Speed test nodes',
    description:
      'Small files on hosts meant for speed tests, so a download run costs about 50 MB in total.',
    targets: [
      {
        id: 'cloudflare-10mb',
        name: 'Cloudflare 10 MB',
        url: 'https://speed.cloudflare.com/__down?bytes=10000000',
        download: { bytes: 10000000, parallel: 'none' },
        note: 'Does not support range requests, so there is no multi-connection measurement.',
      },
      {
        id: 'cachefly-10mb',
        name: 'CacheFly 10 MB',
        url: 'https://cachefly.cachefly.net/10mb.test',
        download: { bytes: 10485760, parallel: 'range' },
      },
      {
        id: 'ovh-10mb',
        name: 'OVH 10 MB (France)',
        url: 'https://proof.ovh.net/files/10Mb.dat',
        download: { bytes: 10485760, parallel: 'range' },
      },
    ],
  },
]
