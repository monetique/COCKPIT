// src/api/validation.js
import client from './client';

export const getValidations    = (params) => client.get('/validations', { params });
export const getValidationById = (id)     => client.get(`/validations/${id}`);
export const saveValidation    = (data)   => client.post('/validations', data);
export const getValidationStats= ()       => client.get('/validations/stats/summary');

export const notifyMerchant = (data) => client.post('/merchants/send-notification', data);
export const notifyBank     = (data) => client.post('/merchants/notify-bank', data);
export const generateProdCredentials = (data) => client.post('/merchants/generate-prod-credentials', data);
export const sendProdEmail  = (data) => client.post('/merchants/send-prod-email', data);

export const markMerchantNotified = (id) => client.patch(`/validations/${id}/notify-merchant`);
export const markBankNotified     = (id, data) => client.patch(`/validations/${id}/notify-bank`, data);
export const markProdEmailSent    = (id) => client.patch(`/validations/${id}/prod-email`);

export const verifyCtp01 = (data) => client.post('/validations/verify-ctp01', data);
