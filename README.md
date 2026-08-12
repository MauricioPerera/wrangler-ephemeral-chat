# 💬 Ephemeral Chat

Un chat en tiempo real que se despliega en segundos sobre una **cuenta temporal de Cloudflare**, sin necesidad de login, y se **autodestruye solo** cuando esa cuenta expira (~1 hora).

Construido sobre [Durable Objects](https://developers.cloudflare.com/durable-objects/) (WebSockets + SQLite) y el flag [`wrangler deploy --temporary`](https://developers.cloudflare.com/workers/platform/claim-deployments/).

## Cómo funciona

- `wrangler deploy --temporary` crea una cuenta de Cloudflare temporal (sin login), despliega el Worker, y te da una URL pública en `workers.dev`.
- Esa cuenta —y todo lo que contiene: el Worker, el chat, los mensajes— vive **~60 minutos**. Si nadie la reclama (abriendo la claim URL que imprime wrangler y completando el login), Cloudflare la borra automáticamente. No hay que limpiar nada.
- El chat en sí corre en un único Durable Object con estado en SQLite: mensajes, configuración de la sala e invitaciones.

## Requisitos

- Node.js
- Wrangler **4.102.0 o superior**
- **No estar logueado** en Wrangler (`wrangler logout` si ya tenés sesión) — `--temporary` solo funciona sin credenciales existentes

## Deploy

```bash
git clone https://github.com/MauricioPerera/wrangler-ephemeral-chat.git
cd wrangler-ephemeral-chat
npm install
npx wrangler deploy --temporary
```

La salida te da la URL del chat y una **claim URL**. Compartí la URL del chat con quien quieras invitar. Si te interesa quedarte con el Worker de forma permanente, abrí la claim URL y completá el login de Cloudflare antes de que venza la hora — si no hacés nada, todo se borra solo.

### Deploy permanente (opcional)

Si preferís que no expire, hacé `wrangler login` y corré `npx wrangler deploy` en vez de `--temporary`.

## Funcionalidades

- **Chat en tiempo real** vía WebSockets (Durable Objects hibernation API)
- **Historial persistente** (últimos 50 mensajes por sala, en SQLite del propio Durable Object)
- **Identidad por mensaje**: nombre + color por usuario
- **Modo abierto / cerrado**: cualquiera con el link (abierto) vs. solo invitados (cerrado)
- **Admin**: quien primero se conecta con `?admin=1` se vuelve admin; recibe un link con token para reconectarse como admin después
- **Invitaciones de un solo uso**: el admin genera links `?invite=<token>` que se consumen al primer uso
- **Banner de cuenta regresiva**: muestra cuánto falta (aproximado) para que la cuenta temporal expire
- **UI mobile-friendly**: pantalla completa en celular, burbujas de chat, escapado de HTML (sin XSS)

## Uso

1. Abrí la URL del deploy → pantalla de login, poné un nombre.
2. Para ser admin de la sala: agregá `?admin=1` a la URL la primera vez que entrás. Guardá el link con tu token de admin que te muestra el panel — lo necesitás para volver a entrar como admin.
3. Desde el panel admin: cambiá entre sala abierta/cerrada, y generá invitaciones (un link por persona, de un solo uso).

## Estructura

```
src/index.js       — Worker + Durable Object (ChatRoom) + UI embebida
wrangler.jsonc      — config del Worker y binding del Durable Object
```

Todo el frontend vive embebido como HTML/CSS/JS dentro del propio Worker — no hay build step ni assets externos.

## Limitaciones (heredadas de las cuentas temporales de Cloudflare)

- Durable Objects, KV, D1, Hyperdrive, Queues y certificados mTLS están soportados en cuentas temporales — **R2 y Vectorize no**.
- El timer de 60 minutos es fijo desde la creación de la cuenta, no se extiende con actividad.
- Los tokens de la cuenta temporal no tienen todos los permisos de una cuenta real.

Más info: [Claim deployments · Cloudflare Workers docs](https://developers.cloudflare.com/workers/platform/claim-deployments/)
