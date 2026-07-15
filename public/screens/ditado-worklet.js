// ditado-worklet.js — captura PCM do microfone p/ o ditado (BISO_DITADO).
// Junta ~4096 amostras (85ms @48kHz) antes de postar: 1 mensagem por quantum
// de 128 seriam ~375/s. Manda junto o RMS p/ o halo de nível do botão.
class DitadoPCM extends AudioWorkletProcessor {
  constructor() { super(); this._buf = new Float32Array(4096); this._n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || !ch.length) return true;
    let i = 0;
    while (i < ch.length) {
      const take = Math.min(ch.length - i, 4096 - this._n);
      this._buf.set(ch.subarray(i, i + take), this._n);
      this._n += take; i += take;
      if (this._n === 4096) {
        const out = this._buf.slice(0);
        let sum = 0;
        for (let j = 0; j < 4096; j++) sum += out[j] * out[j];
        this.port.postMessage({ buf: out.buffer, rms: Math.sqrt(sum / 4096) }, [out.buffer]);
        this._n = 0;
      }
    }
    return true;
  }
}
registerProcessor('ditado-pcm', DitadoPCM);
