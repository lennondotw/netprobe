import type { ServiceInput } from '../config.ts'

export const cloud: ServiceInput[] = [
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
]
