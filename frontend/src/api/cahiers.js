// src/api/cahiers.js
import client from './client';

export const listCahiers    = ()         => client.get('/cahiers');
export const uploadCahier   = (formData) => client.post('/cahiers/upload', formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
});
export const downloadCahier = (filename) =>
  client.get(`/cahiers/download/${encodeURIComponent(filename)}`, { responseType: 'blob' });
export const readCahier     = (filename) =>
  client.get(`/cahiers/read/${encodeURIComponent(filename)}`);
export const deleteCahier   = (filename) =>
  client.delete(`/cahiers/${encodeURIComponent(filename)}`);
