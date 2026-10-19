import type { ServiceInput } from '../config.ts'
import { reachability, site } from './helpers.ts'

/** Operating-system package sources and the mirrors commonly used in mainland China. */
export const mirrors: ServiceInput[] = [
  {
    id: 'linux',
    category: 'Mirrors',
    name: 'Linux software sources',
    description: 'Default package sources of common distributions (release metadata only).',
    targets: [
      site('debian', 'Debian', 'https://deb.debian.org/debian/dists/stable/Release'),
      site(
        'debian-security',
        'Debian security',
        'https://security.debian.org/debian-security/dists/stable-security/Release',
      ),
      site('ubuntu', 'Ubuntu archive', 'http://archive.ubuntu.com/ubuntu/dists/noble/Release'),
      site(
        'ubuntu-security',
        'Ubuntu security',
        'http://security.ubuntu.com/ubuntu/dists/noble-security/Release',
      ),
      site(
        'ubuntu-ports',
        'Ubuntu ports',
        'http://ports.ubuntu.com/ubuntu-ports/dists/noble/Release',
      ),
      site('alpine', 'Alpine', 'https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/'),
      {
        id: 'fedora',
        name: 'Fedora mirror list',
        url: 'https://mirrors.fedoraproject.org/mirrorlist?repo=fedora-42&arch=x86_64',
      },
      site('arch', 'Arch Linux', 'https://geo.mirror.pkgbuild.com/core/os/x86_64/core.db'),
      site('opensuse', 'openSUSE', 'https://download.opensuse.org/'),
      { id: 'nix', name: 'Nix binary cache', url: 'https://cache.nixos.org/nix-cache-info' },
    ],
  },
  {
    id: 'china-mirrors',
    category: 'Mirrors',
    name: 'China mirrors',
    description: 'University and cloud mirrors, and registry proxies used inside mainland China.',
    targets: [
      site('tuna', 'TUNA (Tsinghua)', 'https://mirrors.tuna.tsinghua.edu.cn/'),
      site('ustc', 'USTC', 'https://mirrors.ustc.edu.cn/'),
      site('sjtug', 'SJTUG', 'https://mirrors.sjtug.sjtu.edu.cn/'),
      site('aliyun', 'Alibaba Cloud', 'https://mirrors.aliyun.com/'),
      site('tencent', 'Tencent Cloud', 'https://mirrors.cloud.tencent.com/'),
      site('huawei', 'Huawei Cloud', 'https://repo.huaweicloud.com/'),
      site('tuna-pypi', 'TUNA PyPI', 'https://pypi.tuna.tsinghua.edu.cn/simple/pip/'),
      site('npmmirror', 'npmmirror', 'https://registry.npmmirror.com/'),
      site('goproxy', 'GOPROXY.CN', 'https://goproxy.cn/'),
      site('rsproxy', 'RsProxy (Rust)', 'https://rsproxy.cn/'),
      site('hf-mirror', 'HF-Mirror', 'https://hf-mirror.com/'),
      reachability(
        'daocloud',
        'DaoCloud registry mirror',
        'https://docker.m.daocloud.io/v2/',
        [401],
      ),
    ],
  },
]
