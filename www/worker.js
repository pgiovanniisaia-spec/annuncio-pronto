importScripts("enhance.js");

self.onmessage = e => {
  const { job, buf, w, h, whiten } = e.data;
  const d = new Uint8ClampedArray(buf);
  enhancePixels(d, w, h, whiten);
  self.postMessage({ job, buf: d.buffer, w, h }, [d.buffer]);
};
