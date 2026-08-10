/**
 * Autorización única de Google Drive para Kaizen: obtiene el REFRESH TOKEN.
 *
 * ¿Por qué hace falta? Una service account no puede CREAR archivos en un Drive
 * personal (no tiene cuota de almacenamiento propia; Google responde "Service
 * Accounts do not have storage quota"). Las salidas oficiales —unidades
 * compartidas y delegación de dominio— exigen Google Workspace, que no tenemos.
 * La vía que sí funciona con una cuenta Gmail normal es que Kaizen se autentique
 * COMO EL USUARIO: entonces escribe con la cuota de esa persona.
 *
 * Este script se corre UNA vez, en local, con navegador:
 *
 *   1. GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... npm run drive:auth
 *   2. Abre la URL que imprime, elige la cuenta dueña del Drive y acepta.
 *   3. Copia el refresh token que sale y ponlo en Railway como
 *      GOOGLE_OAUTH_REFRESH_TOKEN (junto al CLIENT_ID y el CLIENT_SECRET).
 *
 * El token no caduca mientras la app esté PUBLICADA en la pantalla de
 * consentimiento. Si se deja "En prueba", Google lo invalida a los 7 días.
 */
import http from 'http';
import { google } from 'googleapis';

const PORT = 53682; // puerto fijo: tiene que coincidir con el URI de redirección
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPES = ['https://www.googleapis.com/auth/drive'];

function fatal(mensaje: string): never {
  console.error(`\n❌ ${mensaje}\n`);
  process.exit(1);
}

async function main() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    fatal(
      'Faltan GOOGLE_OAUTH_CLIENT_ID y/o GOOGLE_OAUTH_CLIENT_SECRET.\n\n' +
      'Se crean en Google Cloud Console → APIs y servicios → Credenciales →\n' +
      'Crear credenciales → ID de cliente de OAuth 2.0 → Aplicación web.\n' +
      `En "URI de redirección autorizados" hay que agregar EXACTAMENTE: ${REDIRECT_URI}`
    );
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const url = oauth2.generateAuthUrl({
    // offline = pide refresh token. Sin esto solo dan un access token de 1 hora.
    access_type: 'offline',
    scope: SCOPES,
    // Fuerza la pantalla de consentimiento: Google SOLO entrega refresh token la
    // primera vez que el usuario autoriza. Si ya autorizó antes y no se fuerza,
    // devuelve el access token sin refresh token y uno se vuelve loco buscándolo.
    prompt: 'consent',
  });

  console.log('\n────────────────────────────────────────────────────────────');
  console.log('1. Abre esta URL en el navegador:\n');
  console.log(url);
  console.log('\n2. Inicia sesión con la cuenta DUEÑA del Drive (la que tiene');
  console.log('   las carpetas Cerebro y Contenidos) y acepta los permisos.');
  console.log('\nEsperando la respuesta de Google...');
  console.log('────────────────────────────────────────────────────────────\n');

  const code = await esperarCodigo();

  try {
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      fatal(
        'Google no devolvió refresh token.\n\n' +
        'Suele pasar cuando esa cuenta YA autorizó esta app antes. Revoca el acceso en\n' +
        'https://myaccount.google.com/permissions y vuelve a correr este script.'
      );
    }

    console.log('\n✅ Listo. Pon esto en Railway:\n');
    console.log(`GOOGLE_OAUTH_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\nY verifica con: npm run check\n');
  } catch (e) {
    fatal(`No se pudo canjear el código: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Levanta un servidor local, captura el `code` del redirect y se apaga. */
function esperarCodigo(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (code) {
        res.end('<h2>Listo</h2><p>Ya puedes cerrar esta pestaña y volver a la terminal.</p>');
        server.close();
        resolve(code);
      } else {
        res.end(`<h2>Algo falló</h2><p>${error ?? 'no llegó el código'}</p>`);
        server.close();
        reject(new Error(error ?? 'Google no devolvió el código de autorización'));
      }
    });

    server.on('error', (e) => {
      reject(new Error(
        `No se pudo abrir el puerto ${PORT} (${e.message}). ` +
        'Cierra lo que lo esté usando y reintenta.'
      ));
    });

    server.listen(PORT);
  });
}

main().catch((e) => fatal(e instanceof Error ? e.message : String(e)));
