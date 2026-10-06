export const TRIAL_DATABASE = Object.freeze({
  databaseURL: 'libsql://tgggg-amanwaraa.aws-ap-northeast-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTA3NTI5MTUsImlkIjoiMDFhMGYxMzAtZTYwMS03NGExLThkOTktMDJkMWUwZjYxODQ4Iiwia2lkIjoiMGZxOHFxN2dNaDhyMGRXNEtuaWRuRzFrZDdUNFBrMXZkZDAxaGZNOVNtUSIsInJpZCI6IjQ0NWFmNzdiLTEwM2ItNGNkNC1hYTNmLWIxNTI3ZDUwZjcxYiJ9.gpLweb2Pwv6dpt7eYhVJOQpiOcf7eqszxDZSoD1N1RjDzrtPEIEJjh6xvveMOcrolHJMRRZ7_8TAGF8zthvQAg',
  table: 'oscar_rtdb',
});

export const TRIAL_LIMITS = Object.freeze({
  products: 10,
  salesInvoices: 50,
  warehouses: 1,
  employees: 0,
  customers: 20,
  categories: 5,
  purchaseInvoices: 10,
  days: 10,
});

export const isTrialAccount = () => {
  try { return window.OscarActivation?.readRuntime?.()?.plan === 'trial'; }
  catch (_) { return false; }
};

export const getTrialRuntime = () => {
  try {
    const rt = window.OscarActivation?.readRuntime?.() || null;
    return rt?.plan === 'trial' ? rt : null;
  } catch (_) { return null; }
};
