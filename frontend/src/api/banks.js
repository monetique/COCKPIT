// src/api/banks.js
import client from './client';

export const getBanks    = ()        => client.get('/banks');
export const createBank  = (data)    => client.post('/banks', data);
export const updateBank  = (id, data)=> client.patch(`/banks/${id}`, data);
export const deleteBank  = (id)      => client.delete(`/banks/${id}`);
