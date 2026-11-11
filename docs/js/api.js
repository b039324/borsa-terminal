// Arayüz eski REST yollarını çağırmaya devam eder; istekler tarayıcıdaki motora (js/engine) gider.
import { dispatch } from './engine/router.js';
import { AuthError } from './engine/data.js';

export const authEvents = new EventTarget();

async function req(method, path, body) {
  try {
    return await dispatch(method, path, body);
  } catch (e) {
    if (e instanceof AuthError) authEvents.dispatchEvent(new Event('auth-required'));
    throw e;
  }
}

export const enc = encodeURIComponent;
export const api = {
  get: (p) => req('GET', p),
  post: (p, b = {}) => req('POST', p, b),
  put: (p, b = {}) => req('PUT', p, b),
  del: (p) => req('DELETE', p),
};
