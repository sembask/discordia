// Ajustes de qualidade no SDP que mandamos pro outro lado.
//
// Os parâmetros do Opus no SDP dizem "como EU quero receber": anunciando
// estéreo e bitrate alto, autorizamos o amigo a mandar áudio de qualidade.
// Quanto ele manda de fato é decidido do lado dele (maxBitrate do sender).

const OPUS_PARAMS: Record<string, string> = {
  stereo: '1',
  'sprop-stereo': '1',
  maxaveragebitrate: '256000',
  maxplaybackrate: '48000',
  useinbandfec: '1', // corrige perda de pacote sem pedir reenvio
  usedtx: '0', // sem "corte" do áudio no silêncio (música soa natural)
  minptime: '10',
};

function parseParams(line: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of line.split(';')) {
    const [k, v] = part.split('=');
    if (k?.trim()) map.set(k.trim(), (v ?? '').trim());
  }
  return map;
}

export function tuneSdp(sdp: string): string {
  const opus = /a=rtpmap:(\d+) opus\/48000\/2/gi;
  const payloads = new Set<string>();
  for (const m of sdp.matchAll(opus)) payloads.add(m[1]);
  if (!payloads.size) return sdp;

  let out = sdp;
  for (const pt of payloads) {
    const fmtp = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`, 'g');
    if (fmtp.test(out)) {
      out = out.replace(fmtp, (_all, params: string) => {
        const map = parseParams(params);
        for (const [k, v] of Object.entries(OPUS_PARAMS)) map.set(k, v);
        return `a=fmtp:${pt} ${[...map].map(([k, v]) => `${k}=${v}`).join(';')}`;
      });
    } else {
      const line = `a=fmtp:${pt} ${Object.entries(OPUS_PARAMS).map(([k, v]) => `${k}=${v}`).join(';')}`;
      out = out.replace(new RegExp(`(a=rtpmap:${pt} opus\\/48000\\/2\\r?\\n)`, 'i'), `$1${line}\r\n`);
    }
  }
  return out;
}
