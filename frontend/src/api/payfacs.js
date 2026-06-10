// src/api/payfacs.js
import client from './client';
export const getPayfacs    = ()          => client.get('/payfacs');
export const createPayfac  = (data)      => client.post('/payfacs', data);
export const updatePayfac  = (id, data)  => client.patch(`/payfacs/${id}`, data);
export const deletePayfac  = (id)        => client.delete(`/payfacs/${id}`);

// Actions tableau marchands
export const resendCahier      = (data) => client.post('/merchants/resend-cahier', data);
export const forceProduction   = (data) => client.post('/merchants/force-production', data);
export const resetProgression  = (data) => client.post('/merchants/reset-progression', data);
