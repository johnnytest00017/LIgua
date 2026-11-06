// TEST STUB ONLY (not shipped): proves the UI calls the engine and shows its errors.
export const onProgress=()=>{};
export const describeError=e=>'STUB-DESCRIBED: '+e.message;
export const translateArabic=async t=>{ if(window.__failOnnx) throw new Error('boom at stage decode'); return 'stub translation of ['+t+']'; };
