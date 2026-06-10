// src/api/auth.js
import client from './client';

export const login = (email, password) =>
  client.post('/auth/login', { email, password });

export const logout = (refreshToken) =>
  client.post('/auth/logout', { refreshToken });

export const getMe = () =>
  client.get('/auth/me');

export const changePassword = (currentPassword, newPassword) =>
  client.post('/auth/change-password', { currentPassword, newPassword });

export const getUsers = () =>
  client.get('/auth/users');

export const createUser = (data) =>
  client.post('/auth/users', data);

export const updateUser = (id, data) =>
  client.patch(`/auth/users/${id}`, data);
