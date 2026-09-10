-- Cuentas de marketing: los perfiles sociales que Kaizen puede leer, guardados
-- desde el apartado de Marketing.
--
-- Una fila por perfil y no una columna por red en una fila de configuración:
-- la lista crece con competidores de la misma red y con redes nuevas, y con
-- columnas cada una de esas dos cosas pediría una migración.

CREATE TABLE "MarketingAccount" (
    "id" TEXT NOT NULL,
    "red" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "etiqueta" TEXT,
    "esPropia" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "MarketingAccount_pkey" PRIMARY KEY ("id")
);

-- El mismo perfil no se guarda dos veces. Sobre el USUARIO normalizado y no
-- sobre la URL: instagram.com/finzenai y instagram.com/FinZenAI/?hl=es son el
-- mismo perfil escrito de dos formas.
CREATE UNIQUE INDEX "MarketingAccount_red_usuario_key" ON "MarketingAccount"("red", "usuario");

-- La consulta que va a correr siempre: "la cuenta propia de esta red" y "todas
-- las de esta red".
CREATE INDEX "MarketingAccount_red_esPropia_idx" ON "MarketingAccount"("red", "esPropia");
