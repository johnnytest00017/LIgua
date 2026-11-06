import * as ort from 'onnxruntime-web';

async function main() {
  const status = document.getElementById('status');
  const details = document.getElementById('details');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = {
    mjs: '/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
    wasm: '/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'
  };

  let enc, dec, cached;
  try {
    const ids = [111,971,30,7,682,1219,57,826,55,0];
    const mask = new BigInt64Array(ids.length).fill(1n);

    status.textContent = 'Running encoder...';
    enc = await ort.InferenceSession.create('./models/ar-en/encoder_model.onnx');
    const encoded = await enc.run({
      input_ids: new ort.Tensor('int64', new BigInt64Array(ids.map(BigInt)), [1,ids.length]),
      attention_mask: new ort.Tensor('int64', mask, [1,ids.length])
    });

    status.textContent = 'Loading decoder...';
    dec = await ort.InferenceSession.create('./models/ar-en/decoder_model.onnx');
    cached = await ort.InferenceSession.create('./models/ar-en/decoder_with_past_model.onnx');

    const first = await dec.run({
      input_ids: new ort.Tensor('int64', new BigInt64Array([62833n]), [1,1]),
      encoder_attention_mask: new ort.Tensor('int64', mask, [1,ids.length]),
      encoder_hidden_states: encoded.last_hidden_state
    });

    const past = {};
    for (let i=0; i<6; i++) {
      for (const part of ['decoder','encoder']) {
        for (const kind of ['key','value']) {
          past[`past_key_values.${i}.${part}.${kind}`] =
            first[`present.${i}.${part}.${kind}`];
        }
      }
    }

    function bestToken(logits) {
      const offset = logits.data.length - 62834;
      let best = 0;
      for (let i=1; i<62834; i++) {
        if (logits.data[offset+i] > logits.data[offset+best]) best = i;
      }
      return best;
    }

    const generated = [];
    let token = bestToken(first.logits);
    generated.push(token);
    status.textContent = 'Generating English tokens...';

    for (let step=1; step<40 && token!==0; step++) {
      const feeds = {
        input_ids: new ort.Tensor('int64', new BigInt64Array([BigInt(token)]), [1,1]),
        encoder_attention_mask: new ort.Tensor('int64', mask, [1,ids.length]),
        ...past
      };
      const out = await cached.run(feeds);
      for (let i=0; i<6; i++) {
        for (const kind of ['key','value']) {
          past[`past_key_values.${i}.decoder.${kind}`] =
            out[`present.${i}.decoder.${kind}`];
        }
      }
      token = bestToken(out.logits);
      generated.push(token);
    }

    const vocab = await (await fetch('./models/ar-en/vocab.json')).json();
    const reverse = Object.fromEntries(Object.entries(vocab).map(([piece, id]) => [id, piece]));
    const translation = generated.filter(id => id !== 0)
      .map(id => reverse[id] ?? '�').join('').replace(/▁/g, ' ').trim();
    details.textContent = 'Generated token IDs:\n' + JSON.stringify(generated) +
      '\n\nTranslation:\n' + translation +
      '\n\nToken count: ' + generated.length;
    status.textContent = 'Generation successful.';
  } catch (e) {
    status.textContent = 'FAILED: ' + (e.stack || e.message);
  } finally {
    if (cached) await cached.release();
    if (dec) await dec.release();
    if (enc) await enc.release();
  }
}
main();
