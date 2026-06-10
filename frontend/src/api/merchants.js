// src/api/merchants.js
import client from './client';

export const getMerchantsProd = () => client.get('/merchants/prod');
export const getMerchantsTest = () => client.get('/merchants/test');
export const getBanks         = () => client.get('/banks');
export const getBankByCode    = (code) => client.get(`/banks/by-code?code=${code}`);

export const sendWelcome = (data) =>
  client.post('/merchants/send-welcome', data);

export const sendNotification = (data) =>
  client.post('/merchants/send-notification', data);

export const notifyBank = (data) =>
  client.post('/merchants/notify-bank', data);

export const generateProdCredentials = (data) =>
  client.post('/merchants/generate-prod-credentials', data);

export const sendProdEmail = (data) =>
  client.post('/merchants/send-prod-email', data);
