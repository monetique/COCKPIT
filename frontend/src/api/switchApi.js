// src/api/switchApi.js
import client from './client';

export const getDropdowns          = ()  => client.get('/switch/dropdowns');
export const getSwitchTransactions = (f) => client.post('/switch/transactions', f);
export const exportSwitch          = (f) => client.post('/switch/export', f);
