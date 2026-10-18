// Portão de ruído (roda na thread de áudio, sem engasgar com a interface).
//
// Mede o nível de cada bloco em dBFS e decide:
//   - acima do limite → portão ABERTO (passa tudo);
//   - abaixo do limite por `holdMs` → portão FECHADO (abaixa `rangeDb`).
// O ganho muda suave (abre rápido, fecha devagar) pra não dar "clique".
// Uma antecipação curta (LOOKAHEAD) abre o portão um tico antes da voz
// chegar na saída, pra não comer o começo das palavras.
//
// Modo automático: acompanha o "chão" de ruído do ambiente (o nível mais
// baixo recente) e põe o limite um pouco acima dele.

const LOOKAHEAD_S = 0.005;
const ATTACK_S = 0.002;
const RELEASE_S = 0.08;
const HYSTERESIS_DB = 4;
const REPORT_S = 0.05;
const FLOOR_RISE_DB_PER_S = 2;
const AUTO_MARGIN_DB = 12;
const AUTO_MIN_DB = -72;
const AUTO_MAX_DB = -24;
const SILENCE_DB = -100;

function toDb(rms) {
  return rms > 1e-5 ? 20 * Math.log10(rms) : SILENCE_DB;
}

class NoiseGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.params = { enabled: true, auto: true, thresholdDb: -50, rangeDb: 40, holdMs: 200 };
    this.lookahead = Math.max(1, Math.round(LOOKAHEAD_S * sampleRate));
    this.rings = [];
    this.pos = 0;
    this.gain = 1;
    this.open = true;
    this.belowFor = 0;
    this.floorDb = -60;
    this.levelDb = SILENCE_DB;
    this.peakDb = SILENCE_DB;
    this.sinceReport = 0;
    this.attack = 1 - Math.exp(-1 / (ATTACK_S * sampleRate));
    this.release = 1 - Math.exp(-1 / (RELEASE_S * sampleRate));
    this.port.onmessage = (e) => Object.assign(this.params, e.data);
  }

  threshold() {
    if (!this.params.auto) return this.params.thresholdDb;
    return Math.min(AUTO_MAX_DB, Math.max(AUTO_MIN_DB, this.floorDb + AUTO_MARGIN_DB));
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const n = input[0].length;
    const blockS = n / sampleRate;

    // Nível do bloco (média entre canais).
    let sum = 0;
    for (const ch of input) for (let i = 0; i < n; i++) sum += ch[i] * ch[i];
    const db = toDb(Math.sqrt(sum / (n * input.length)));
    // Envelope: sobe na hora, desce suave (leitura estável pro medidor).
    this.levelDb = db > this.levelDb ? db : this.levelDb + (db - this.levelDb) * 0.15;
    this.peakDb = Math.max(this.peakDb, this.levelDb);

    // Chão de ruído: desce na hora pro mínimo, sobe devagar.
    if (this.levelDb < this.floorDb) this.floorDb = Math.max(this.levelDb, SILENCE_DB);
    else this.floorDb += FLOOR_RISE_DB_PER_S * blockS;

    const threshold = this.threshold();
    if (!this.params.enabled) {
      this.open = true;
    } else if (this.levelDb >= threshold) {
      this.open = true;
      this.belowFor = 0;
    } else if (this.levelDb < threshold - HYSTERESIS_DB || !this.open) {
      this.belowFor += blockS * 1000;
      if (this.belowFor >= this.params.holdMs) this.open = false;
    }

    const closedGain = this.params.rangeDb >= 100 ? 0 : Math.pow(10, -this.params.rangeDb / 20);
    const target = this.open ? 1 : closedGain;

    while (this.rings.length < output.length) this.rings.push(new Float32Array(this.lookahead));
    const L = this.lookahead;
    for (let i = 0; i < n; i++) {
      const coef = target > this.gain ? this.attack : this.release;
      this.gain += (target - this.gain) * coef;
      const idx = (this.pos + i) % L;
      for (let c = 0; c < output.length; c++) {
        const ring = this.rings[c];
        const src = input[Math.min(c, input.length - 1)];
        const delayed = ring[idx];
        ring[idx] = src[i];
        output[c][i] = delayed * this.gain;
      }
    }
    this.pos = (this.pos + n) % L;

    this.sinceReport += blockS;
    if (this.sinceReport >= REPORT_S) {
      this.sinceReport = 0;
      this.port.postMessage({ levelDb: this.peakDb, thresholdDb: threshold, open: this.open, floorDb: this.floorDb });
      this.peakDb = SILENCE_DB;
    }
    return true;
  }
}

registerProcessor('discordia-noise-gate', NoiseGateProcessor);
