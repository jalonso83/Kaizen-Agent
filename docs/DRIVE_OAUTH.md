# Drive · Configurar la escritura (OAuth de usuario)

> **Estado:** pendiente de ejecutar. Hasta que se haga, Kaizen **lee** el Cerebro
> pero **no puede escribir** — ni el resumen semanal, ni los borradores de
> contenido, ni el CSV de adquisición.
>
> **Quién:** el paso 3 lo tiene que hacer **Junior**, o alguien con él delante,
> porque hay que iniciar sesión con `junior.urena15@gmail.com` (la cuenta dueña
> de las carpetas de Drive). Los pasos 1, 2 y 4 los puede hacer cualquiera con
> acceso a Google Cloud Console y a Railway.

---

## Por qué hay que hacer esto

Kaizen se montó con una **service account** (`kaizen-drive@kaizen-agent-502219.iam.gserviceaccount.com`).
Leer le funciona bien. Escribir es **imposible**, y no por permisos.

Cuando alguien crea un archivo en Drive, ese archivo **pertenece a quien lo creó**
y ocupa espacio de la cuenta de su dueño. Una service account **no tiene cuenta de
almacenamiento** — no es una persona, no tiene Drive propio. Así que al intentar
crear un archivo, Google responde:

```
Service Accounts do not have storage quota.
Leverage shared drives, or use OAuth delegation instead.
```

Esto se comprobó el 2026-08-09 contra las tres carpetas reales, con la service
account autenticada de verdad:

```
Cerebro      ✅ LEE  (8 elementos)   ❌ NO ESCRIBE — storage quota
50-kaizen    ✅ LEE  (1 elemento)    ❌ NO ESCRIBE — storage quota
Contenidos   ✅ LEE  (5 elementos)   ❌ NO ESCRIBE — storage quota
```

### Lo que NO lo arregla

- **Dar permiso de Editor.** Ya lo tiene. El problema no es permiso, es espacio.
- **Poner las carpetas con enlace público en modo Editor.** Mismo error exacto, y
  además dejaría el Cerebro visible y editable para cualquiera con la URL.
- **Compartir la carpeta padre.** Igual.

### Lo que sí lo arregla

Google documenta dos salidas, y las dos consisten en que los archivos **no los
tenga que poseer la service account**:

| Salida | ¿Sirve aquí? |
|---|---|
| Unidad compartida | ❌ Requiere Google Workspace |
| Delegación de dominio | ❌ Requiere Google Workspace |
| **OAuth de usuario** | ✅ **Esta** |

`finzenai.com` tiene el correo en GoDaddy (`MX → smtp.secureserver.net`), o sea
que **no hay Workspace**. Queda la tercera: Kaizen se autentica **como Junior**,
y entonces crea los archivos con la cuota de su cuenta, que es además la dueña de
las carpetas. Con eso, lectura y escritura en Cerebro y Contenidos completos.

---

## Paso 1 · Pantalla de consentimiento

**Va primero**: Google no deja crear el cliente OAuth sin ella.

En [Google Cloud Console → Credenciales](https://console.cloud.google.com/apis/credentials),
con el proyecto **`kaizen-agent-502219`** seleccionado, darle a
**Configurar pantalla de consentimiento** (el aviso amarillo de arriba).

| Campo | Valor |
|---|---|
| Nombre de la app | `Kaizen Agent` |
| Correo de asistencia | el del socio |
| **Público / Audience** | **Externo** |
| Datos de contacto | el del socio |

**"Externo", no "Interno"** — Interno solo existe con Google Workspace, y no hay.

### Y publicarla

Al terminar el asistente, si el estado dice **"En prueba"**, darle a **PUBLICAR APP**.

⚠️ **Esto no es opcional.** En modo prueba Google **invalida el refresh token a
los 7 días**, y Kaizen dejaría de escribir sin previo aviso — un fallo silencioso
que aparecería un lunes cualquiera cuando no llegue el resumen.

No hace falta verificación de Google: la app la usa una sola persona sobre sus
propios archivos. Al autorizar aparecerá un aviso de "Google no ha verificado
esta aplicación"; hay que entrar en **Configuración avanzada → Ir a (nombre)**.

## Paso 2 · Crear el ID de cliente OAuth

**Credenciales → Crear credenciales → ID de cliente de OAuth 2.0 → Tipo: Aplicación web**

En **URI de redirección autorizados**, agregar exactamente:

```
http://localhost:53682
```

Sin barra final y sin `https`. Ese puerto no es arbitrario: es el que levanta
`npm run drive:auth` para capturar la respuesta de Google. Si no coincide, la
autorización falla con `redirect_uri_mismatch`.

Guardar y copiar el **ID de cliente** y el **secreto de cliente**.

## Paso 3 · Obtener el refresh token · **← lo hace Junior**

En la terminal, desde `Kaizen-Agent/server`:

```powershell
$env:GOOGLE_OAUTH_CLIENT_ID='pega_el_id_del_paso_1'
$env:GOOGLE_OAUTH_CLIENT_SECRET='pega_el_secreto_del_paso_1'
npm run drive:auth
```

El script imprime una URL. Hay que:

1. Abrirla en el navegador
2. **Iniciar sesión con `junior.urena15@gmail.com`** — es la cuenta dueña de las
   carpetas; con otra cuenta el token no serviría
3. Aceptar los permisos

El script captura la respuesta solo (por eso el servidor en el puerto 53682) y
te imprime las tres variables listas para copiar.

## Paso 4 · Variables en Railway

```
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REFRESH_TOKEN=...
```

Las dos primeras salen del paso 1, la tercera del paso 3. **No hace falta nada
más**: los IDs de Cerebro y Contenidos ya están puestos, y la subcarpeta
`50-kaizen/` se resuelve por nombre dentro del Cerebro.

**No borrar las variables de la service account.** Se conservan como respaldo de
lectura: si el OAuth está configurado, tiene prioridad y la service account ni se
usa; si algún día falta, al menos leer sigue funcionando.

## Paso 5 · Verificar

```powershell
npm run check
```

Debe salir algo así:

```
✅ PASS  Google Drive · LECTURA (oauth-usuario): 8 archivos en la carpeta Cerebro
✅ PASS  Google Drive · ESCRITURA (50-kaizen/): creó y borró un archivo de prueba
```

Si en LECTURA dice `(service-account)` en vez de `(oauth-usuario)`, es que falta
alguna de las tres variables OAuth y está cayendo al respaldo.

---

## Si algo falla

| Error | Qué pasó |
|---|---|
| `redirect_uri_mismatch` | El URI del paso 1 no es exactamente `http://localhost:53682` |
| `Google no devolvió refresh token` | Esa cuenta ya había autorizado antes. Revocar en [myaccount.google.com/permissions](https://myaccount.google.com/permissions) y repetir el paso 3 |
| `Service Accounts do not have storage quota` | Sigue usando la service account: falta alguna variable OAuth en Railway |
| `invalid_grant` a los pocos días | La pantalla de consentimiento quedó "En prueba" (paso 2) |
| `No se pudo abrir el puerto 53682` | Algo lo está ocupando; cerrarlo y reintentar |

---

## Qué queda habilitado

Con el OAuth puesto, Kaizen **lee y escribe en el Cerebro completo y en
Contenidos**, sin más configuración de permisos — actúa como Junior, y las
carpetas son suyas.

`save_cerebro_note` escribe por defecto en `50-kaizen/` (que es donde el socio
revisa los lunes), pero acepta un parámetro `subcarpeta` para guardar en
cualquier otra sección del Cerebro. La herramienta `list_cerebro_folders` le
permite consultar qué carpetas existen antes de elegir una.

## Nota de seguridad

El JSON de la service account circuló por un chat el 2026-08-09. Conviene rotar
esa clave en Google Cloud Console (crear una nueva, actualizarla en Railway,
borrar la vieja). No es urgente si nadie más ve ese historial, pero es lo
prudente — y una vez el OAuth esté funcionando, la service account solo sirve
para leer, así que el impacto de rotarla es mínimo.
