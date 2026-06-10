// src/api/transactions.js
import client from './client';

export const getStates = () =>
  client.get('/transactions/states');

export const getTransactions = (filters) =>
  client.post('/transactions', filters);

export const exportTransactions = (filters) =>
  client.post('/transactions/export', filters);

// KPIs agrégés sur toute la sélection (sans pagination)
export const getStats = (filters) =>
  client.post('/transactions/stats', filters);
