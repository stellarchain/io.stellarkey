// Worker spike for measuring proof generation, memory, and cancellation
self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;
  if (type === 'INIT') {
    // initialize worker
    self.postMessage({ type: 'READY' });
  } else if (type === 'BENCH') {
    const start = performance.now();
    // Simulate/run witness and proof benchmark
    const end = performance.now();
    self.postMessage({
      type: 'BENCH_RESULT',
      duration: end - start,
    });
  }
};
