// src/api/tracking.js
import client from './client';

export const getTracking    = (params)       => client.get('/tracking',         { params });
export const getTrackingStats = ()           => client.get('/tracking/stats');
export const importTracking = (rows)         => client.post('/tracking/import', { rows });
export const exportTracking = ()             => client.get('/tracking/export');
export const updateStatut   = (pid, data)    => client.patch(`/tracking/${pid}/statut`, data);
export const updateNotes    = (pid, notes)   => client.patch(`/tracking/${pid}/notes`,  { notes });
export const getDetail      = (pid)          => client.get(`/tracking/${pid}`);
