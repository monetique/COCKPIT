// src/api/alerts.js
import client from './client';

export const getAlertRules   = ()          => client.get('/alerts');
export const getAlertHistory = (params)    => client.get('/alerts/history', { params });
export const createAlertRule = (data)      => client.post('/alerts', data);
export const updateAlertRule = (id, data)  => client.patch(`/alerts/${id}`, data);
export const deleteAlertRule = (id)        => client.delete(`/alerts/${id}`);
export const testAlertRule   = (id)        => client.post(`/alerts/${id}/test`);
export const triggerAlert    = (data)      => client.post('/alerts/trigger', data);
