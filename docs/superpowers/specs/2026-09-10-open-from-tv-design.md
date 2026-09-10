# "Apri dalla TV" — design e piano

Data: 2026-09-10. Stato: approvato in chat. Fase 0 del percorso TV (fase 1: app Android TV; fase 3: modalità autonoma).

## Obiettivo

Chi usa l'app desktop deve poter aprire Neftlix dal browser della TV (o da tablet e telefono) senza passare da Docker. Modello "la TV si collega al PC": il server dell'app desktop diventa raggiungibile in LAN, la TV apre l'indirizzo, il video lo scarica la TV direttamente dal provider. Il PC fa da cervello (catalogo, EPG, progresso, profili), non da relay.

Fuori scope: cast dal PC alla TV, scoperta automatica (mDNS, arriva con l'app TV), esposizione oltre la LAN, HTTPS.

## Comportamento

**Impostazioni, pannello "Apri dalla TV"** (solo app desktop, dopo "App desktop"):

- Interruttore **Attivo / Non attivo**. Attivandolo il server si riavvia in ascolto su tutte le interfacce (`0.0.0.0`) sulla stessa porta; disattivandolo torna su `127.0.0.1`. La finestra si ricarica da sola (meno di un secondo).
- Con l'interruttore attivo il pannello mostra: gli indirizzi da digitare sulla TV (uno per interfaccia di rete IPv4, es. `http://192.168.1.20:53412`), un **QR** del primo indirizzo per telefono e tablet, e il **PIN** (6 cifre, generato alla prima attivazione) con "Cambia PIN".
- Testo di aiuto: il PC deve restare acceso; Windows chiede una volta il permesso al firewall ("Consenti accesso" su rete privata); il browser della TV deve essere sulla stessa rete Wi-Fi.
- Stato salvato in `<userData>/lan.json` (`enabled`, `pin`, `secret`); all'avvio successivo l'app riparte nello stesso stato.

**Server** (`createApp({ lan })`, valido anche per Docker/CLI ma usato solo dal desktop):

- Le richieste da loopback (`127.0.0.1`, `::1`) non sono toccate: la finestra Electron non vede mai il PIN.
- Le richieste da altri indirizzi devono portare il cookie `neftlix_lan` (HMAC del PIN con il segreto). Senza cookie: le richieste di pagina ricevono una **pagina PIN** minimale (campo numerico, autofocus, navigabile col telecomando), le richieste API/stream ricevono 401 JSON.
- `POST /api/lan/login {pin}`: confronto a tempo costante; 5 tentativi falliti per IP bloccano per 30 s; successo imposta il cookie (1 anno, `HttpOnly`, `SameSite=Lax`). Cambiare PIN invalida tutti i cookie (il token dipende dal PIN).
- Il cookie profilo esistente funziona come oggi, quindi ogni TV sceglie il proprio profilo.
- `NEFTLIX_PASSWORD` (basic auth) resta indipendente e continua a valere per Docker.

**Desktop** (`main.ts`, `lan.ts`, `server.ts`):

- `startServer` accetta l'host; l'URL della finestra resta `http://127.0.0.1:<porta>` anche quando il server ascolta su `0.0.0.0`.
- IPC `lan:get-state`, `lan:set-enabled`, `lan:set-pin`. `set-enabled` riavvia il server e ricarica la finestra; `set-pin` non riavvia (il server legge il PIN da un getter).
- Indirizzi: `os.networkInterfaces()`, IPv4, non interne, ordinati con le reti private prima.

## Piano

1. `server/src/lan.ts` (guard, pagina PIN, login, rate limit) + opzione `lan` in `app.ts`, registrato prima delle route profili. Test con `app.inject({ remoteAddress })`.
2. `desktop/src/lan.ts` (stato, PIN, indirizzi) + test; `server.ts` con host; `main.ts` con IPC e riavvio; `preload.cts`.
3. `web/src/desktop.ts` tipi; `Settings.tsx` pannello; QR con `qrcode`; stili.
4. README "Watch on your TV", CHANGELOG.
5. Verifica: `npm run check`, `npm test`, app desktop in dev (`npm run desktop`): attiva, apri l'indirizzo da un altro dispositivo (o da `http://<ip>:<porta>` nel browser del Mac), pagina PIN, PIN sbagliato, PIN giusto, catalogo e player; disattiva, l'indirizzo non risponde più.
