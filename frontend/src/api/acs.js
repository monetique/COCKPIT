// src/api/acs.js
import client from './client';

// Proxy backend vers https://3ds2.clictopay.com/acs/metrics
// (évite les problèmes CORS en prod)
export const getAcsMetrics  = (url) => client.get('/acs/metrics', { params: url ? { url } : {} });
export const testAcsUrl     = (url) => client.get('/acs/test',    { params: { url } });
