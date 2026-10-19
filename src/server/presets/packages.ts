import type { ServiceInput } from '../config.ts'
import { reachability, site } from './helpers.ts'

/** Package registries, container registries, CDNs, and toolchain downloads. Metadata only. */
export const packages: ServiceInput[] = [
  {
    id: 'npm',
    category: 'Packages',
    name: 'npm',
    description: 'The npm registry, its Yarn mirror, and JSR.',
    targets: [
      { id: 'registry', name: 'Registry', url: 'https://registry.npmjs.org/' },
      { id: 'metadata', name: 'Package metadata', url: 'https://registry.npmjs.org/react/latest' },
      { id: 'yarn', name: 'Yarn registry', url: 'https://registry.yarnpkg.com/' },
      site('jsr', 'JSR', 'https://jsr.io/'),
    ],
  },
  {
    id: 'registries',
    category: 'Packages',
    name: 'Language registries',
    description:
      'Python, Rust, Go, JVM, Ruby, PHP, .NET, Dart, Elixir, R, conda, Homebrew, and CocoaPods.',
    targets: [
      site('pypi', 'PyPI index', 'https://pypi.org/simple/'),
      reachability('pypi-files', 'PyPI files', 'https://files.pythonhosted.org/', [404]),
      { id: 'crates', name: 'crates.io index', url: 'https://index.crates.io/config.json' },
      reachability('crates-static', 'crates.io downloads', 'https://static.crates.io/', [403]),
      site('go-proxy', 'Go module proxy', 'https://proxy.golang.org/'),
      { id: 'go-sum', name: 'Go checksum database', url: 'https://sum.golang.org/latest' },
      site('maven', 'Maven Central', 'https://repo.maven.apache.org/maven2/'),
      site('maven-repo1', 'Maven Central (repo1)', 'https://repo1.maven.org/maven2/'),
      site('gradle-plugins', 'Gradle Plugin Portal', 'https://plugins.gradle.org/m2/'),
      site('gradle', 'Gradle distributions', 'https://services.gradle.org/distributions/'),
      {
        id: 'rubygems',
        name: 'RubyGems',
        url: 'https://rubygems.org/api/v1/versions/rails/latest.json',
      },
      { id: 'packagist', name: 'Packagist', url: 'https://repo.packagist.org/packages.json' },
      { id: 'nuget', name: 'NuGet', url: 'https://api.nuget.org/v3/index.json' },
      site('pub', 'pub.dev', 'https://pub.dev/api/packages/http'),
      { id: 'hex', name: 'Hex', url: 'https://repo.hex.pm/' },
      site('cran', 'CRAN', 'https://cloud.r-project.org/'),
      site('conda', 'conda-forge', 'https://conda.anaconda.org/conda-forge/'),
      {
        id: 'homebrew',
        name: 'Homebrew API',
        url: 'https://formulae.brew.sh/api/formula/wget.json',
      },
      site('cocoapods', 'CocoaPods CDN', 'https://cdn.cocoapods.org/'),
    ],
  },
  {
    id: 'containers',
    category: 'Packages',
    name: 'Container registries',
    description:
      'Registry endpoints answer 401 until a client fetches a token; GitHub’s registry is under GitHub.',
    targets: [
      reachability('docker-hub', 'Docker Hub registry', 'https://registry-1.docker.io/v2/', [401]),
      { id: 'docker-auth', name: 'Docker Hub auth', url: 'https://auth.docker.io/token' },
      reachability(
        'docker-blobs',
        'Docker Hub blobs (CDN)',
        'https://production.cloudflare.docker.com/',
        [403],
      ),
      site('docker-web', 'Docker Hub', 'https://hub.docker.com/'),
      reachability('quay', 'Quay', 'https://quay.io/v2/', [401]),
      reachability('gcr', 'Google Container Registry', 'https://gcr.io/v2/', [401]),
      reachability(
        'artifact-registry',
        'Artifact Registry (us)',
        'https://us-docker.pkg.dev/v2/',
        [401],
      ),
      reachability('k8s', 'Kubernetes registry', 'https://registry.k8s.io/v2/', [401]),
      reachability('ecr-public', 'Amazon ECR Public', 'https://public.ecr.aws/v2/', [401]),
      { id: 'mcr', name: 'Microsoft Artifact Registry', url: 'https://mcr.microsoft.com/v2/' },
      reachability('gitlab', 'GitLab registry', 'https://registry.gitlab.com/v2/', [401]),
    ],
  },
  {
    id: 'cdn',
    category: 'Packages',
    name: 'Package CDNs',
    description: 'CDNs that serve npm packages and libraries to browsers.',
    targets: [
      { id: 'jsdelivr', name: 'jsDelivr', url: 'https://cdn.jsdelivr.net/npm/react/package.json' },
      site('unpkg', 'unpkg', 'https://unpkg.com/react/package.json'),
      site('cdnjs', 'cdnjs', 'https://cdnjs.cloudflare.com/'),
      site('esm', 'esm.sh', 'https://esm.sh/'),
    ],
  },
  {
    id: 'toolchains',
    category: 'Packages',
    name: 'Toolchains & SDKs',
    description: 'Where installers and version managers fetch runtimes, compilers, and SDKs.',
    targets: [
      site('node', 'Node.js releases', 'https://nodejs.org/dist/index.json'),
      { id: 'go', name: 'Go releases', url: 'https://go.dev/dl/?mode=json' },
      {
        id: 'rustup',
        name: 'Rust (rustup)',
        url: 'https://static.rust-lang.org/rustup/release-stable.toml',
      },
      site('python', 'Python releases', 'https://www.python.org/ftp/python/'),
      {
        id: 'adoptium',
        name: 'Eclipse Temurin (Adoptium)',
        url: 'https://api.adoptium.net/v3/info/available_releases',
      },
      site(
        'android',
        'Android SDK repository',
        'https://dl.google.com/android/repository/repository2-3.xml',
      ),
      site('docker', 'Docker packages', 'https://download.docker.com/linux/'),
      site('microsoft', 'Microsoft packages', 'https://packages.microsoft.com/'),
    ],
  },
]
