/**
 * Public STUN servers, shared by the host's STUN probes and the browser's WebRTC check. Checked
 * from mainland China (direct and through a rule-based proxy) and the US; servers that no longer
 * resolve or never answer were dropped. With split routing, servers in different places can see
 * different public addresses for the same device.
 */
export interface StunServer {
  id: string
  name: string
  host: string
  port: number
}

export const publicStunServers: readonly StunServer[] = [
  { id: 'google', name: 'Google', host: 'stun.l.google.com', port: 19302 },
  { id: 'cloudflare', name: 'Cloudflare', host: 'stun.cloudflare.com', port: 3478 },
  { id: 'twilio', name: 'Twilio', host: 'global.stun.twilio.com', port: 3478 },
  { id: 'telnyx', name: 'Telnyx', host: 'stun.telnyx.com', port: 3478 },
  { id: 'blackberry', name: 'BlackBerry', host: 'stun.voip.blackberry.com', port: 3478 },
  { id: 'siptrunk', name: 'SIPTrunk', host: 'stun.siptrunk.com', port: 3478 },
  { id: 'freeswitch', name: 'FreeSWITCH', host: 'stun.freeswitch.org', port: 3478 },
  { id: 'nextcloud', name: 'Nextcloud', host: 'stun.nextcloud.com', port: 3478 },
  { id: 'antisip', name: 'AntiSIP', host: 'stun.antisip.com', port: 3478 },
  { id: 'linphone', name: 'Linphone', host: 'stun.linphone.org', port: 3478 },
  { id: 'ipfire', name: 'IPFire', host: 'stun.ipfire.org', port: 3478 },
  { id: 'voipgate', name: 'VoIPgate', host: 'stun.voipgate.com', port: 3478 },
  { id: '12connect', name: '12Connect', host: 'stun.12connect.com', port: 3478 },
  { id: 'romaaeterna', name: 'Roma Aeterna', host: 'stun.romaaeterna.nl', port: 3478 },
  { id: 'sonetel', name: 'Sonetel', host: 'stun.sonetel.com', port: 3478 },
  { id: 'sipnet', name: 'Sipnet', host: 'stun.sipnet.ru', port: 3478 },
  { id: 'xiaomi', name: 'Xiaomi', host: 'stun.miwifi.com', port: 3478 },
  { id: 'bilibili', name: 'bilibili', host: 'stun.chat.bilibili.com', port: 3478 },
  { id: 'mangotv', name: 'Mango TV', host: 'stun.hitv.com', port: 3478 },
  { id: 'douyu', name: 'Douyu', host: 'stun.douyucdn.cn', port: 18000 },
]
