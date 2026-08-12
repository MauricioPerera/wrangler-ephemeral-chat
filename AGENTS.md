# Guía para agentes: desplegar este chat con `wrangler --temporary`

Este documento es para un agente de IA (Claude Code, Cursor, etc.) que necesite desplegar este proyecto de forma autónoma, sin login humano, usando cuentas temporales de Cloudflare. Está escrito a partir de comportamiento real observado, no solo de la documentación oficial.

## Requisitos previos

- Node.js instalado.
- Wrangler **4.102.0 o superior**. Verificar con:
  ```bash
  npx wrangler --version
  ```
  Si es menor, instalar la última: `npm install -D wrangler@latest`.

## Paso 1 — Confirmar que NO hay sesión activa

`--temporary` **falla** si Wrangler ya tiene credenciales (OAuth, API token o Global API Key).

```bash
npx wrangler whoami
```

- Si dice "You are logged in..." → correr `npx wrangler logout` antes de continuar. Esto cierra la sesión real del usuario en esta máquina; si el agente no tiene autorización explícita para desloguear al usuario, debe preguntar primero.
- Si dice "You are not authenticated" → seguir directo al paso 2.

## Paso 2 — Instalar dependencias y desplegar

```bash
npm install
npx wrangler deploy --temporary
```

Salida esperada:

```
Temporary account ready:
	Account: <nombre-random> (created)
	Claim within: 1 hour
	Claim URL: https://dash.cloudflare.com/claim-preview?claimToken=...
Deployed <worker-name> triggers
  https://<worker-name>.<account-slug>.workers.dev
```

**Guardar de esta salida:** la URL del Worker (para dar el chat) y la claim URL (para pasarle al usuario humano si quiere quedarse con la cuenta).

## Gotchas encontrados en la práctica

1. **Credenciales cacheadas y muertas.** Wrangler cachea la cuenta temporal en:
   - Windows: `%APPDATA%\xdg.config\.wrangler\wrangler-temporary-account.toml`
   - Linux/Mac: `~/.config/.wrangler/wrangler-temporary-account.toml`

   Si la cuenta expiró (pasó la hora) y volvés a correr `wrangler deploy --temporary`, Wrangler reintenta con el token muerto y falla con `Authentication error [code: 10000]` / `Invalid access token [code: 9109]`, en vez de crear una cuenta nueva automáticamente. **Solución:** borrar ese archivo antes de reintentar:
   ```bash
   rm "$APPDATA/xdg.config/.wrangler/wrangler-temporary-account.toml"
   npx wrangler deploy --temporary
   ```

2. **El timer es fijo, no una ventana deslizante.** Los 60 minutos corren desde la creación de la cuenta, no se resetean con actividad (deploys, comandos, etc.). No hay forma de extenderlo sin reclamar la cuenta (abrir la claim URL y completar el login).

3. **`--temporary` no está soportado por todos los subcomandos.** Confirmado empíricamente:
   - **Funciona:** `deploy`, `kv namespace create`, `kv key put/get` (con `--remote`), `d1 create`, `secret put`, `deployments list`, `versions list`, `tail`, `delete`, `queues create`, `hyperdrive create`.
   - **NO funciona** (`Unknown argument: temporary`): `r2 bucket create`, `vectorize create`.
   - En Windows, el error de un subcomando no soportado a veces viene seguido de un crash secundario (`Assertion failed ... UV_HANDLE_CLOSING`) — es cosmético, no afecta el resultado.

4. **Cuentas temporales solo soportan un subconjunto de productos**, aunque el comando exista: Workers, Static Assets (≤1000 archivos, ≤5MiB c/u), KV, **D1 limitado a 1 base y 100MB**, Durable Objects, Hyperdrive (≤2 configs, ≤10 conexiones), Queues (≤10), certificados mTLS/CA. R2 y Vectorize no están disponibles en absoluto.

5. **`kv key put/get` usa Miniflare local por default.** Sin `--remote`, escribe/lee en un SQLite local, no en la cuenta temporal real — y en algunos entornos ese modo local crashea (`SQLITE_CANTOPEN`). Para probar contra el recurso real de la cuenta temporal, siempre agregar `--remote`.

## Paso 3 — Verificar que el deploy funciona de verdad

No asumir éxito solo por el output de `wrangler deploy`. Verificar con una petición real:

```bash
curl -sS -w "\nHTTP %{http_code}\n" https://<worker-name>.<account-slug>.workers.dev/
```

Para el chat específicamente (WebSocket vía Durable Object), un smoke test rápido con Node:

```js
import WebSocket from "ws"; // npm install ws si hace falta
const ws = new WebSocket("wss://<worker-name>.<account-slug>.workers.dev/room/test?name=probe");
ws.on("message", (data) => { console.log(data.toString()); ws.close(); });
```

Si el WebSocket abre y llega el mensaje de estado inicial (`{"status":true,...}`), el Durable Object está funcionando.

## Paso 4 — Comunicar el resultado al usuario

Siempre entregar, en este orden:
1. La URL del chat (para compartir con quien se quiera invitar).
2. La claim URL, aclarando que vence en ~1 hora y que **abrirla no alcanza** — hay que completar el login dentro de la ventana para quedarse con el Worker; si no, Cloudflare borra todo solo.
3. Si el chat quedó en modo "cerrado" con invitaciones, no compartir la claim URL ni los tokens de admin como si fueran links de invitado — son cosas distintas.

## No hacer

- No reintentar `wrangler deploy --temporary` en loop sin antes revisar `wrangler whoami` — si hay sesión real logueada del usuario, el comando corre igual pero **contra su cuenta real**, no crea una temporal (comportamiento silencioso, no falla con error).
- No asumir que el timer se extiende porque el Worker sigue respondiendo — puede cortarse en cualquier momento pasada la hora.
- No usar `--temporary` con recursos no soportados (R2, Vectorize) esperando que provisione algo — falla antes de tocar la red.
