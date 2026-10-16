import type { ServiceInput } from '../config.ts'
import { reachability, site } from './helpers.ts'

export const developer: ServiceInput[] = [
  {
    id: 'github',
    category: 'Developer',
    name: 'GitHub',
    description:
      'Web, API, raw content, source archives, release assets, and the container registry.',
    targets: [
      { id: 'web', name: 'github.com', url: 'https://github.com/' },
      {
        id: 'api',
        name: 'REST API',
        url: 'https://api.github.com/rate_limit',
        note: 'The rate-limit endpoint answers even when the egress IP is rate limited.',
      },
      {
        id: 'raw',
        name: 'Raw content',
        url: 'https://raw.githubusercontent.com/github/gitignore/main/README.md',
      },
      {
        id: 'codeload',
        name: 'Source archives',
        url: 'https://codeload.github.com/github/gitignore/tar.gz/refs/heads/main',
        method: 'HEAD',
      },
      {
        id: 'release-assets',
        name: 'Release asset host',
        url: 'https://release-assets.githubusercontent.com/',
        expectStatus: [404],
        check: 'reachability',
      },
      {
        id: 'objects',
        name: 'Objects host',
        url: 'https://objects.githubusercontent.com/',
        expectStatus: [404],
        check: 'reachability',
      },
      {
        id: 'ghcr',
        name: 'Container registry',
        url: 'https://ghcr.io/v2/',
        expectStatus: [401],
        check: 'reachability',
      },
      {
        id: 'release-download',
        name: 'Release download (gh CLI, ~13 MB)',
        url: 'https://github.com/cli/cli/releases/download/v2.63.0/gh_2.63.0_linux_amd64.tar.gz',
        download: { bytes: 13068169, parallel: 'range' },
        note: 'Redirects to the release asset CDN.',
      },
    ],
  },
  {
    id: 'github-actions',
    category: 'Developer',
    name: 'GitHub Actions',
    description:
      'Runner service, artifact and cache API, and blob storage. Blob account names vary; add the ones your runs use through config.',
    targets: [
      {
        id: 'pipelines',
        name: 'Pipelines service',
        url: 'https://pipelines.actions.githubusercontent.com/',
        expectStatus: [404],
        check: 'reachability',
      },
      {
        id: 'results',
        name: 'Artifact & cache API',
        url: 'https://results-receiver.actions.githubusercontent.com/',
        expectStatus: [404],
        check: 'reachability',
      },
      {
        id: 'blob',
        name: 'Blob storage (sa0)',
        url: 'https://productionresultssa0.blob.core.windows.net/',
        expectStatus: [400],
        check: 'reachability',
        note: 'One of several storage accounts; the account a run uses appears in its artifact URLs.',
      },
    ],
  },
  {
    id: 'registries',
    name: 'Package registries',
    category: 'Developer',
    description: 'Container, Python, Rust, Go, Java, Homebrew, CocoaPods, and CDN-hosted packages.',
    targets: [
      reachability('docker-hub', 'Docker Hub registry', 'https://registry-1.docker.io/v2/', [401]),
      { id: 'docker-auth', name: 'Docker Hub auth', url: 'https://auth.docker.io/token' },
      reachability(
        'docker-blobs',
        'Docker Hub blobs (CDN)',
        'https://production.cloudflare.docker.com/',
        [403],
      ),
      site('pypi', 'PyPI index', 'https://pypi.org/simple/'),
      reachability('pypi-files', 'PyPI files', 'https://files.pythonhosted.org/', [404]),
      { id: 'crates', name: 'crates.io index', url: 'https://index.crates.io/config.json' },
      site('go-proxy', 'Go module proxy', 'https://proxy.golang.org/'),
      site('maven', 'Maven Central', 'https://repo.maven.apache.org/maven2/'),
      {
        id: 'homebrew',
        name: 'Homebrew API',
        url: 'https://formulae.brew.sh/api/formula/wget.json',
      },
      site('cocoapods', 'CocoaPods CDN', 'https://cdn.cocoapods.org/'),
      { id: 'jsdelivr', name: 'jsDelivr', url: 'https://cdn.jsdelivr.net/npm/react/package.json' },
      site('unpkg', 'unpkg', 'https://unpkg.com/react/package.json'),
    ],
  },
  {
    id: 'code-hosting',
    name: 'Code hosting & AI',
    category: 'Developer',
    description:
      'Other forges, model hubs, and AI APIs (unauthenticated, so 401 is the healthy answer).',
    targets: [
      site('gitlab', 'GitLab', 'https://gitlab.com/'),
      site('bitbucket', 'Bitbucket', 'https://bitbucket.org/'),
      site('huggingface', 'Hugging Face', 'https://huggingface.co/'),
      reachability('openai', 'OpenAI API', 'https://api.openai.com/v1/models', [401]),
      reachability('anthropic', 'Anthropic API', 'https://api.anthropic.com/v1/models', [401]),
    ],
  },
  {
    id: 'aws',
    category: 'Cloud',
    name: 'AWS',
    description:
      'S3 and CloudFront. Transfer Acceleration needs a bucket name and is configured per deployment.',
    targets: [
      {
        id: 's3-global',
        name: 'S3 global endpoint',
        url: 'https://s3.amazonaws.com/',
        expectStatus: [307],
        check: 'reachability',
      },
      {
        id: 's3-us-west-2',
        name: 'S3 us-west-2',
        url: 'https://s3.us-west-2.amazonaws.com/',
        expectStatus: [307],
        check: 'reachability',
      },
      { id: 'cloudfront', name: 'CloudFront (AWS static)', url: 'https://d1.awsstatic.com/' },
    ],
  },
  {
    id: 'vercel',
    category: 'Cloud',
    name: 'Vercel',
    description: 'Dashboard and API. Add deployment URLs and static downloads through config.',
    targets: [
      { id: 'web', name: 'vercel.com', url: 'https://vercel.com/' },
      {
        id: 'api',
        name: 'REST API',
        url: 'https://api.vercel.com/',
        expectStatus: [308],
        check: 'reachability',
      },
    ],
  },
  {
    id: 'apple-notary',
    category: 'Developer',
    name: 'Apple notarization',
    description:
      'Network path used by notarytool and codesign. Upload throughput needs a real submission and is out of scope.',
    targets: [
      {
        id: 'notary-api',
        name: 'Notary API',
        url: 'https://appstoreconnect.apple.com/notary/v2/submissions',
        expectStatus: [401],
        check: 'reachability',
      },
      {
        id: 'upload-accelerated',
        name: 'Upload bucket (accelerated)',
        url: 'https://notary-submissions-prod.s3-accelerate.amazonaws.com/',
        expectStatus: [403],
        check: 'reachability',
      },
      {
        id: 'upload-standard',
        name: 'Upload bucket (us-west-2)',
        url: 'https://notary-submissions-prod.s3.us-west-2.amazonaws.com/',
        expectStatus: [403],
        check: 'reachability',
      },
      {
        id: 'timestamp',
        name: 'Code signing timestamp',
        url: 'http://timestamp.apple.com/ts01',
        expectStatus: [302],
        check: 'reachability',
      },
    ],
  },
  {
    id: 'npm',
    category: 'Developer',
    name: 'npm registry',
    description: 'Registry metadata and package tarballs.',
    targets: [
      { id: 'registry', name: 'Registry', url: 'https://registry.npmjs.org/' },
      { id: 'metadata', name: 'Package metadata', url: 'https://registry.npmjs.org/react/latest' },
      {
        id: 'tarball',
        name: 'Tarball (typescript, ~4 MB)',
        url: 'https://registry.npmjs.org/typescript/-/typescript-5.6.3.tgz',
        download: { parallel: 'range' },
      },
    ],
  },
  {
    id: 'reference',
    category: 'Network',
    name: 'Reference',
    description:
      'A neutral baseline to tell a service problem apart from a general egress problem.',
    targets: [
      {
        id: 'cloudflare-25mb',
        name: 'Cloudflare 25 MB',
        url: 'https://speed.cloudflare.com/__down?bytes=25000000',
        download: { bytes: 25000000, parallel: 'none' },
        note: 'Does not support range requests, so there is no multi-connection measurement.',
      },
    ],
  },
]
