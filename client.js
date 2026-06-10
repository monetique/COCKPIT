// src/api/client.js — Axios avec intercepteurs JWT
import axios from 'axios';

const client = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Client dédié aux opérations longues — timeout 0 = jamais
export const clientLong = axios.create({
  baseURL : '/api',
  timeout : 0,
  headers : { 'Content-Type': 'application/json' },
});

// ── Injecter le token JWT sur TOUS les clients ────────────
function injectToken(config) {
  const token = localStorage.getItem('ctp_access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
}
client.interceptors.request.use(injectToken);
clientLong.interceptors.request.use(injectToken);

// ── Gérer l'expiration du token (401) ───────────────────
let isRefreshing = false;
let queue = [];

function processQueue(error, token = null) {
  queue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve(token)
  );
  queue = [];
}

function makeResponseInterceptor(axiosInstance) {
  axiosInstance.interceptors.response.use(
    res => res,
    async err => {
      const original = err.config;
      if (err.response?.status === 401 && !original._retry) {
        if (err.response?.data?.expired) {
          if (isRefreshing) {
            return new Promise((resolve, reject) => {
              queue.push({ resolve, reject });
            }).then(token => {
              original.headers.Authorization = `Bearer ${token}`;
              return axiosInstance(original);
            });
          }
          original._retry = true;
          isRefreshing     = true;
          try {
            const refreshToken = localStorage.getItem('ctp_refresh_token');
            const { data } = await axios.post('/api/auth/refresh', { refreshToken });
            const newToken = data.accessToken;
            localStorage.setItem('ctp_access_token', newToken);
            processQueue(null, newToken);
            original.headers.Authorization = `Bearer ${newToken}`;
            return axiosInstance(original);
          } catch (refreshErr) {
            processQueue(refreshErr, null);
            localStorage.removeItem('ctp_access_token');
            localStorage.removeItem('ctp_refresh_token');
            window.location.href = '/login';
            return Promise.reject(refreshErr);
          } finally {
            isRefreshing = false;
          }
        }
        localStorage.removeItem('ctp_access_token');
        localStorage.removeItem('ctp_refresh_token');
        window.location.href = '/login';
      }
      return Promise.reject(err);
    }
  );
}

makeResponseInterceptor(client);
makeResponseInterceptor(clientLong);

export default client;

