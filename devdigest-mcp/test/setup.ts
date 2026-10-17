// Hard guard: no test may reach the real network. Tests inject their own fake fetch.
globalThis.fetch = (() => {
  throw new Error('real network is not allowed in tests');
}) as typeof fetch;
