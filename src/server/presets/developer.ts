import type { ServiceInput } from '../config.ts'
import { reachability, site } from './helpers.ts'

export const developer: ServiceInput[] = [
  {
    id: 'github',
    category: 'Developer',
    name: 'GitHub',
    description:
      'Web, API, raw content, archives, release and LFS storage, Packages, Pages, and assets.',
    targets: [
      { id: 'web', name: 'github.com', url: 'https://github.com/' },
      {
        id: 'api',
        name: 'REST API',
        url: 'https://api.github.com/rate_limit',
        note: 'The rate-limit endpoint answers even when the egress IP is rate limited.',
      },
      reachability('uploads', 'Uploads API', 'https://uploads.github.com/', [302]),
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
      site('gist', 'Gist', 'https://gist.github.com/'),
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
      reachability('lfs', 'LFS storage', 'https://github-cloud.githubusercontent.com/', [403]),
      {
        id: 'ghcr',
        name: 'Container registry',
        url: 'https://ghcr.io/v2/',
        expectStatus: [401],
        check: 'reachability',
      },
      reachability(
        'ghcr-blobs',
        'Container blob storage',
        'https://pkg-containers.githubusercontent.com/',
        [400],
      ),
      reachability('npm-packages', 'npm packages', 'https://npm.pkg.github.com/', [301]),
      site('pages', 'Pages', 'https://pages.github.com/'),
      site('assets', 'Static assets', 'https://github.githubassets.com/favicons/favicon.svg'),
      site('avatars', 'Avatars', 'https://avatars.githubusercontent.com/u/9919?s=40'),
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
    id: 'code-hosting',
    name: 'Code hosting & model hubs',
    category: 'Developer',
    description: 'Other forges and model hubs.',
    targets: [
      site('gitlab', 'GitLab', 'https://gitlab.com/'),
      site('bitbucket', 'Bitbucket', 'https://bitbucket.org/'),
      site('codeberg', 'Codeberg', 'https://codeberg.org/'),
      site('sourcehut', 'SourceHut', 'https://git.sr.ht/'),
      site('gitee', 'Gitee', 'https://gitee.com/'),
      site('huggingface', 'Hugging Face', 'https://huggingface.co/'),
      reachability(
        'huggingface-lfs',
        'Hugging Face file storage',
        'https://cdn-lfs.hf.co/',
        [403],
        {
          method: 'HEAD',
        },
      ),
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
]
