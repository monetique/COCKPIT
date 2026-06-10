// src/api/api-tokens.js
import client from './client';

export const getTokens    = ()          => client.get('/api-tokens');
export const createToken  = (data)      => client.post('/api-tokens', data);
export const updateToken  = (id, data)  => client.patch(`/api-tokens/${id}`, data);
export const revokeToken  = (id)        => client.delete(`/api-tokens/${id}`);
export const getTokenLogs = ()          => client.get('/api-tokens/logs');
